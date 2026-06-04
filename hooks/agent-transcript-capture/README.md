# agent-transcript-capture

A hook that archives complete coding agent session transcripts to cloud storage whenever a task completes. Designed for organizations that want to audit, analyze, or learn from agent sessions across their team — with **zero per-user cloud credentials**.

## How it works

```
Stop event → read stdin → auto-detect agent → collect files → redact → tar.gz → unauthenticated PUT to bucket
```

The hook fires on the `Stop` event (each time the agent finishes a task), bundles the full session into a `.tar.gz`, optionally redacts secrets, and uploads via a single unauthenticated HTTP `PUT` to either Google Cloud Storage or Amazon S3.

### No-authentication mode

There is no per-user authentication. The bucket is configured to accept unauthenticated PUT/DELETE, gated by a shared secret of the form `secret-do-not-share-<12+ hex chars>`. The secret is wired in differently on each provider, and so is its config name:

- **S3** — the bucket policy scopes unauthenticated PUT/DELETE to a single Resource ARN prefix (`bucket/{namespace_key}/*`). The bucket name is plain; the secret lives in the policy and in `no_auth.namespace_key`.
- **GCS** — GCP refuses IAM Conditions on `allUsers` (the `PublicResourceAllowConditionCheck` lint, which can't be bypassed). So instead, the secret is embedded into the **bucket name** itself (e.g., `agent-transcripts-secret-do-not-share-...`), and the bucket gets a permissive bucket-wide binding for unauthenticated writes. There is no separate `namespace_key` field for GCS — the bucket name carries the secret end-to-end, and config validation rejects a `namespace_key` field (or `STORAGE_NAMESPACE_KEY` env var) under `provider: "gcs"` so the secret isn't encoded twice. Because the bucket is dedicated to transcripts, the blast radius is the same as the S3 prefix-scoped variant.

Object layout:
```
S3:  s3://{bucket}/{namespace_key}/{user_id}/{YYYY}/{MM}/{DD}/{session_uuid}.tar.gz
GCS: gs://{bucket-ending-in-secret-do-not-share-<hex>}/{user_id}/{YYYY}/{MM}/{DD}/{session_uuid}.tar.gz
```

On S3 the `{namespace_key}/` prefix is load-bearing — the bucket policy's Resource ARN scope requires it. On GCS the `secret-do-not-share-<hex>` suffix in the bucket name is the secret, so the object path skips the redundant prefix.

- The shared secret is a high-entropy random string of the form `secret-do-not-share-<12+ hex chars>` (default generator produces 32 hex chars). The `secret-do-not-share-` prefix in the name is self-documenting — anyone who sees it in logs or a screenshot knows immediately that it's a secret.
- Unauthenticated **reads and listings are NOT granted** on either provider. Without the secret, nobody can write to your bucket; with the secret, you can only write — not enumerate, not download.
- Rotating the secret:
  - **S3:** generate a new value, update the bucket policy Resource ARN, update `no_auth.namespace_key` in `HOOK.json` (or the `STORAGE_NAMESPACE_KEY` env var).
  - **GCS:** create a new bucket with the new `secret-do-not-share-...` suffix, bind allUsers to the custom write-only role on it, update `no_auth.bucket` in `HOOK.json`, drop the old bucket when you're ready.

### What it captures

```
manifest.json                  # Session metadata — see fields below
transcript.jsonl               # Parent session transcript
subagents/
  agent-{id}.jsonl             # Subagent transcripts (all of them)
  agent-{id}.meta.json         # Subagent metadata (type, description)
tool-results/
  toolu_{id}.txt               # Externalized large tool outputs
```

`manifest.json` fields:

| Field           | Type                | Notes                                                                                                                              |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | `number`            | Manifest schema version (currently `3`). See [Schema versions](#schema-versions).                                                  |
| `created`       | `string` (ISO 8601) | When the archive was built.                                                                                                        |
| `session_id`    | `string`            | The agent's session UUID.                                                                                                          |
| `agent`         | `string`            | MCP-client-specific identifier. Auto-detected from the transcript path (`/local-agent-mode-sessions/` → `"claude_cowork"`, otherwise `"claude_code"`). Override with `AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME`. |
| `agent_version` | `string \| null`    | Best-effort CLI version (Claude Code: payload `version` → `CLAUDE_CODE_VERSION` env var → `null`). Always present for shape stability. |
| `models`        | `string[]`          | Distinct models used across the session, **in order of first appearance**, parsed from the transcript. Captures mid-session switches (see [Models](#models-manifestmodels--manifestmodel)). Empty `[]` when none could be inferred. |
| `model`         | `string \| null`    | Convenience: the current/most-recent model (the last assistant message's model). `null` when none could be inferred. |
| `privacy_mode`  | `"full" \| "redacted"` | Mirrors the configured privacy mode.                                                                                            |
| `user_id`       | `string`            | Sanitized upload identity used in the object key. For Claude Code this is the Claude auth email when available, then the local OS username. For Claude Cowork this is resolved from Cowork sidecars, never from the host Claude Code CLI identity. |
| `identity`      | `object`            | Best-effort identity source metadata and diagnostics. For Cowork this records sidecar/source status, resolved email/name fields, UUID cross-checks, and non-fatal diagnostics such as CLI session ID mismatches. |
| `files`         | `string[]`          | All file paths inside the archive (excluding the manifest itself).                                                                 |
| `extra`         | any (optional)      | Opaque user-supplied metadata; **omitted entirely when `AGENT_TRANSCRIPT_CAPTURE_EXTRA_METADATA` is unset** (see below).           |

A single interactive session may produce multiple Stops (one per completed task). Each Stop overwrites the previous archive for that session, so the stored version always reflects the latest state.

#### Schema versions

- **v1** — original field set (`version`, `created`, `session_id`, `agent`, `agent_version`, `privacy_mode`, `user_id`, `files`, optional `extra`).
- **v2** — adds `models` and `model`.
- **v3** — adds `identity`. The v2 and v3 changes are **purely additive**: every v1 field keeps the same name, type, and meaning. Consumers that read fields by name keep working unchanged. Consumers that strictly validate the exact field set should branch on `version` (`>= 2` ⇒ expect `models`/`model`; `>= 3` ⇒ expect `identity`).

### Agent identifier (`manifest.agent`)

The `agent` field in `manifest.json` tells downstream consumers which MCP client produced the transcript. It is resolved in this order:

1. `AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME` env var — runtime escape hatch (e.g., for users running a fork of Claude Code or a future MCP client).
2. Path heuristic — transcripts under macOS Application Support's `local-agent-mode-sessions/` are tagged `"claude_cowork"` (the Claude Code binary running inside the desktop app's VM sandbox).
3. Default: `"claude_code"` — covers the standard `~/.claude/projects/` host CLI install and anything else we don't recognize.

An empty `AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME` is treated as unset and falls through to the path heuristic.

### Upload identity (`manifest.user_id` / `manifest.identity`)

`user_id` is the sanitized identity segment used in the upload object key. It is organizational routing metadata, not an authentication boundary.

For standard Claude Code sessions, the hook preserves the existing fallback chain:

1. `claude auth status` email, when available.
2. Local OS username.
3. `unknown`.

For Claude Cowork / desktop local-agent-mode sessions, the host Claude Code CLI identity is intentionally ignored. Cowork runs under macOS `~/Library/Application Support/Claude/local-agent-mode-sessions`, but the transcript JSONL does not contain the logged-in Cowork user. The hook resolves Cowork identity from sidecars in this order:

1. Session metadata sidecar beside the session directory: `<organizationUuid>/local_<coworkSessionUuid>.json`. `emailAddress` is primary, with `accountName` recorded when present. `cliSessionId` is used only as a bridge diagnostic against the Stop-hook `session_id`; mismatches are recorded and do not fail capture.
2. Session `.claude/.claude.json` sidecar: `oauthAccount` fills gaps and records richer metadata when available, including `emailAddress`, `accountUuid`, `organizationUuid`, `displayName`, `organizationName`, `organizationType`, `seatTier`, and `billingType`.
3. Stable non-PII Cowork fallback: `cowork-<accountUuid-prefix>` from the OAuth account or Cowork path account UUID. If that is unavailable, `unknown`.

Path account and organization UUIDs are recorded as cross-checks only; the hook does not infer an email address from directory names. Missing or malformed sidecars never stop transcript capture. Diagnostics are emitted under `manifest.identity.diagnostics`.

`identity` is organizational routing/diagnostic metadata and is **not** subject to `redacted` privacy mode — like the rest of `manifest.json` (e.g. `user_id`, `session_id`), it is written verbatim. Privacy redaction only applies to the captured transcript / tool-result file contents, not to the manifest. Treat any resolved email, display name, or organization fields as present in every manifest regardless of `privacy_mode`.

#### Codex and other non-Claude runtimes

This hook is wired into **Claude Code's `Stop` event**, so in normal operation it only ever fires for Claude Code / Cowork sessions. Codex uses its own, unrelated notification mechanism and a **different transcript format** (where the model and version are recorded differs), so Codex transcripts do not flow through this hook unless someone deliberately wires this binary into a Codex-style runner.

To keep a non-Claude session from being **silently mislabeled** as `claude_code`, set `AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME` (e.g. `codex`) — the manifest `agent` field is then tagged correctly. Note that file collection (`collectSession`) and the model/version extraction still assume Claude's JSONL layout, so a first-class Codex integration needs a dedicated `CodexAdapter` (a documented TODO in `src/adapters/interface.ts`). The model extractor is written defensively: a transcript it can't parse as Claude JSONL yields `models: []` / `model: null` rather than fabricated Claude model names.

### Models (`manifest.models` / `manifest.model`)

The model in use can change partway through a session — the user switches models, or the runtime falls back — and **every switch is recorded in the transcript** (Claude Code stamps `message.model` on each assistant message). So the model fields are derived from the transcript itself, not a single hook-time guess:

- `models` is the **distinct list of models, in order of first appearance** across the whole session. A session that ran entirely on one model has a single-element list; a mid-session switch produces two (or more) entries.
- `model` is the **current/most-recent** model — the model on the last assistant message — for convenience.
- Synthetic client-generated turns (Claude Code's `<synthetic>` marker) are filtered out.
- When no model can be inferred, the fields are present-but-empty (`models: []`, `model: null`), matching the `agent_version: null` convention.

Example manifest from a session that started on Opus, switched to Sonnet, then switched back to Opus:

```json
{
  "version": 3,
  "agent": "claude_code",
  "agent_version": "2.1.138",
  "models": ["claude-opus-4-8", "claude-sonnet-4-6"],
  "model": "claude-opus-4-8"
}
```

`models` records both models (first-appearance order, deduped), while `model` reflects the model in use at capture time.

### Optional extra metadata

Set `AGENT_TRANSCRIPT_CAPTURE_EXTRA_METADATA` to attach arbitrary user-supplied metadata to every uploaded manifest under the top-level `extra` key. Useful for recording, for example, the CLI flags enabled on the current Claude Code invocation.

- **JSON wins.** If the value parses as JSON, the parsed structure is embedded.
- **Falls back to raw string** when the value is not valid JSON — no error, no upload failure.
- **Omitted when unset** (or empty) so the common-case manifest stays clean.

```bash
export AGENT_TRANSCRIPT_CAPTURE_EXTRA_METADATA='{"cli_flags":["--no-color","-v"],"machine":"laptop-7"}'
# or
export AGENT_TRANSCRIPT_CAPTURE_EXTRA_METADATA='--dangerously-skip-permissions enabled'
```

## Setup

### 1. Generate a shared secret

```bash
echo "secret-do-not-share-$(openssl rand -hex 16)"
# example output: secret-do-not-share-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

You'll plug this into:
- **GCS:** the bucket name (as a suffix, e.g., `agent-transcripts-secret-do-not-share-...`).
- **S3:** the bucket policy Resource ARN, and `no_auth.namespace_key` in `HOOK.json`.

Keep it out of public commits.

### 2A. Google Cloud Storage

GCP rejects IAM Conditions on `allUsers` (the `PublicResourceAllowConditionCheck` lint, which can't be disabled). So instead of scoping unauthenticated access by object-key prefix, we embed the `namespace_key` into the **bucket name** itself and grant unauthenticated writes bucket-wide. The blast radius is the same as long as the bucket is dedicated to transcripts.

```bash
export PROJECT=your-gcp-project
export NS=secret-do-not-share-...                # from step 1
export GCS_BUCKET=agent-transcripts-$NS          # secret-suffixed name

# 1. Create the bucket (uniform bucket-level access required).
gcloud storage buckets create gs://$GCS_BUCKET \
  --project=$PROJECT \
  --uniform-bucket-level-access

# 2. Create a custom IAM role with ONLY create + delete (no read, no list).
#    No predefined GCS role gives just these two perms on a UBLA bucket,
#    so we define our own.
cat > /tmp/transcript-writer.yaml <<EOF
title: "Transcript Writer"
description: "Create and delete objects only; no read or list."
stage: GA
includedPermissions:
  - storage.objects.create
  - storage.objects.delete
EOF
gcloud iam roles create transcriptWriter \
  --project=$PROJECT \
  --file=/tmp/transcript-writer.yaml

# 3. Bind allUsers to the custom role on the bucket. No IAM Condition needed —
#    the bucket name itself is the secret.
gcloud storage buckets add-iam-policy-binding gs://$GCS_BUCKET \
  --member=allUsers \
  --role=projects/$PROJECT/roles/transcriptWriter

# 4. (Optional) Lifecycle: auto-delete after 90 days so a leaked key has
#    bounded blast radius. Skip this only if you have other rotation hygiene.
cat > /tmp/lifecycle.json <<EOF
{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}}
EOF
gcloud storage buckets update gs://$GCS_BUCKET --lifecycle-file=/tmp/lifecycle.json

# 5. (Optional) If your project has Public Access Prevention enforced, the
#    allUsers binding will be rejected. Disable it on this bucket only:
# gcloud storage buckets update gs://$GCS_BUCKET --no-public-access-prevention
```

**In `HOOK.json`**, set `no_auth.bucket` to the full secret-suffixed bucket name (`agent-transcripts-secret-do-not-share-...`). Do NOT set `no_auth.namespace_key` for GCS — the validator rejects it, because the bucket name already carries the scoping secret. The bucket name must end with `secret-do-not-share-<12+ hex chars>` or the validator will refuse to load the config.

**Recommended bucket hardening:**
- Set up a billing alert on the project so a runaway upload spree gets noticed.
- Leave bucket reads private — only project admins can list/download.
- Don't reuse the bucket for anything else. The whole bucket is gated by a single secret.

### 2B. Amazon S3

On S3, IAM doesn't have GCP's lint problem — the bucket policy can scope unauthenticated PUT/DELETE to a Resource ARN with the `namespace_key` as a prefix. The bucket name stays plain.

```bash
export S3_BUCKET=your-org-transcripts
export S3_REGION=us-east-1
export NS=secret-do-not-share-...  # from step 1

aws s3api create-bucket --bucket $S3_BUCKET --region $S3_REGION

# You MUST disable Block Public Access to allow unauthenticated PUT.
# This is the documented trade-off — reads remain private, writes are scoped by Resource ARN.
aws s3api put-public-access-block --bucket $S3_BUCKET --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Bucket policy: unauthenticated PUT and DELETE, scoped to the namespace_key prefix.
cat <<EOF > /tmp/policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "NoAuthWriteScopedToNamespace",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::$S3_BUCKET/$NS/*"
    }
  ]
}
EOF
aws s3api put-bucket-policy --bucket $S3_BUCKET --policy file:///tmp/policy.json

# (Optional) Lifecycle: auto-delete after 90 days.
cat <<EOF > /tmp/lifecycle.json
{
  "Rules": [{
    "ID": "expire-90-days",
    "Status": "Enabled",
    "Filter": {"Prefix": "$NS/"},
    "Expiration": {"Days": 90}
  }]
}
EOF
aws s3api put-bucket-lifecycle-configuration --bucket $S3_BUCKET --lifecycle-configuration file:///tmp/lifecycle.json
```

**Recommended bucket hardening:**
- Set a CloudWatch billing alarm.
- Consider an Object Size lifecycle rule that aborts oversized uploads (defense in depth alongside the client-side `max_archive_bytes` limit).

### 3. Install the hook

```bash
# From your project root
cp -r path/to/ai-artifacts/hooks/agent-transcript-capture .claude/hooks/agent-transcript-capture
```

Edit `.claude/hooks/agent-transcript-capture/HOOK.json` and set the `x-config.no_auth` block.

GCS:
```json
{
  "x-config": {
    "mode": "no-auth",
    "no_auth": {
      "provider": "gcs",
      "bucket": "agent-transcripts-secret-do-not-share-...",
      "max_archive_bytes": 52428800
    },
    "privacy": { "mode": "redacted", "extra_patterns": [] }
  }
}
```

> Note: for GCS, do **not** add a `namespace_key` field — the secret is in the bucket name. The validator rejects `namespace_key` (and the `STORAGE_NAMESPACE_KEY` env var) when `provider` is `"gcs"`.

S3:
```json
{
  "x-config": {
    "mode": "no-auth",
    "no_auth": {
      "provider": "s3",
      "bucket": "your-org-transcripts",
      "region": "us-east-1",
      "namespace_key": "secret-do-not-share-...",
      "max_archive_bytes": 52428800
    },
    "privacy": { "mode": "redacted", "extra_patterns": [] }
  }
}
```

**S3 only:** if you'd rather keep the `namespace_key` out of the file, leave a placeholder there and set `STORAGE_NAMESPACE_KEY` in your shell. The env var wins. (For GCS the secret is in the bucket name, so neither field nor env var applies.)

### 4. Register the hook with Claude Code

Add to `~/.claude/settings.json` (global) or `.claude/settings.json` (per-project):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node .claude/hooks/agent-transcript-capture/dist/capture.js" }
        ]
      }
    ]
  }
}
```

**Prerequisites:** Node.js 18+ (for built-in `fetch`). No `npm install` needed at runtime — there are zero runtime dependencies. The compiled `dist/` directory is checked in.

## Configuration reference

All config lives under the `x-config` key in `HOOK.json`.

### `no_auth.provider` — `"gcs" | "s3"`, required
### `no_auth.bucket` — string, required. Bare bucket name (no `gs://` / `s3://`). For `gcs`, the name must end with `secret-do-not-share-<12+ hex chars>`.
### `no_auth.namespace_key` — string. **Required when `provider` is `"s3"`** (overridden by env `STORAGE_NAMESPACE_KEY`). **Prohibited when `provider` is `"gcs"`** — the secret lives in the bucket name; setting this field (or `STORAGE_NAMESPACE_KEY`) throws a validation error. Format `^secret-do-not-share-[a-f0-9]{12,}$`.
### `no_auth.region` — string, required when provider is `"s3"`. AWS region (e.g., `us-east-1`).
### `no_auth.max_archive_bytes` — number, default `52428800` (50 MB). Hard client-side cap. Uploads larger than this fail loudly with `archive_too_large` rather than silently bloating the bucket.

### `privacy.mode` — `"full" | "redacted"`, required
- `"redacted"` (recommended): scrubs API keys, JWTs, connection strings, email addresses, etc. from transcripts before upload.
- `"full"`: uploads verbatim.

### `privacy.extra_patterns` — array, default `[]`. Additional regex redaction patterns:

```json
{
  "name": "internal_customer_id",
  "pattern": "CUST-[0-9]{6}",
  "replacement": "[REDACTED:internal_customer_id]"
}
```

## CLI

The hook records every upload to a local JSONL manifest at `~/.agent-transcript-capture/uploads.jsonl` (override with `AGENT_TRANSCRIPT_CAPTURE_HOME`).

```bash
node hooks/agent-transcript-capture/dist/cli.js list          # most recent 25
node hooks/agent-transcript-capture/dist/cli.js list -n 50
node hooks/agent-transcript-capture/dist/cli.js list --all    # include deleted

node hooks/agent-transcript-capture/dist/cli.js delete 5f1a4e51
```

`delete` issues an unauthenticated DELETE against the bucket (scoped by `namespace_key`), then appends a `status: "deleted"` record to the manifest. Session IDs can be prefixes as long as they're unambiguous.

## Built-in redaction patterns

When `privacy.mode` is `"redacted"`, these patterns are applied in order (most-specific first):

`private_key`, `jwt`, `aws_key`, `aws_secret`, `github_pat`, `github_token`, `anthropic_key`, `stripe_key`, `openai_key`, `bearer_token`, `generic_api_key`, `connection_string`, `password_assignment`, `env_secret`, `email`.

## Security model — the trade-off

This is "no-authentication + scoped secret" mode. The honest read:

- **Pro:** Zero per-user credentials. No service accounts, no key distribution, no auth library, no SDK, no CLI. The hook is one `node` invocation that writes a tar.gz.
- **Pro:** Reads stay private. Even if the `namespace_key` leaks, the leaker can write garbage into your bucket but cannot enumerate or download anyone else's transcripts.
- **Con:** Anyone with the `namespace_key` can upload arbitrary objects to your bucket. Mitigations:
  - **Lifecycle expiry** (optional, recommended) caps long-term blast radius.
  - **Client-side `max_archive_bytes`** caps per-object size.
  - **Billing alarms** catch a write-flood early.
  - **Rotate the key** if you suspect a leak:
    - S3: generate a new `namespace_key`, update the bucket policy `Resource` ARN, update `HOOK.json` (or `STORAGE_NAMESPACE_KEY`).
    - GCS: create a new bucket whose name ends with a fresh `secret-do-not-share-<hex>` suffix, bind allUsers to the custom write-only role on it, update `no_auth.bucket` in `HOOK.json`, retire the old bucket.
- **Con (S3 only):** You must disable Block Public Access on the bucket. The policy still restricts unauthenticated access to PUT/DELETE under the `namespace_key` prefix, but the bucket will show as "public" in AWS Console warnings. This is the documented cost of the architecture.
- **Con (GCS only):** GCP rejects IAM Conditions on `allUsers`, so the secret is embedded into the **bucket name** rather than the object-key prefix. This means the whole bucket must be dedicated to transcripts — don't reuse it for anything else. Rotation requires a new bucket rather than a policy edit.

## Error handling

When an upload fails, the hook:

1. Writes an HTML error page to `/tmp/` with remediation instructions
2. Opens it in the default browser (TTY sessions only — overridable via `AGENT_TRANSCRIPT_CAPTURE_OPEN_BROWSER=0/1`)
3. Writes the error to stderr
4. Exits with code 2

Common error categories: `permission_denied`, `not_found`, `payload_too_large`, `archive_too_large`, `network_error`, `http_error`.

## Development

```bash
npm install
npm run build
npm test       # 119 tests, all in-process — no real network or buckets
```

### Adding a storage backend

1. Create `src/backends/yourbackend.ts` implementing the `StorageBackend` interface
2. Add a case to `createBackend()` in `src/backends/interface.ts`
3. Document the new provider value and any provider-specific config

### Adding an agent adapter

1. Create `src/adapters/youragent.ts` implementing the `AgentAdapter` interface
2. Add detection logic to `detectAgent()` in `src/adapters/interface.ts`

## License

MIT — see [LICENSE](../../LICENSE).
