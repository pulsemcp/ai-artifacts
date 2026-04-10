# trace-capture

A hook that archives complete coding agent session transcripts to cloud storage whenever a task completes. Designed for organizations that want to audit, analyze, or learn from agent sessions across their team.

## What it captures

On every task completion, the hook bundles the full session into a `.tar.gz` archive:

```
manifest.json                  # Session metadata (id, timestamp, agent, privacy mode, file list)
transcript.jsonl               # Parent session transcript
subagents/
  agent-{id}.jsonl             # Subagent transcripts (all of them)
  agent-{id}.meta.json         # Subagent metadata (type, description)
tool-results/
  toolu_{id}.txt               # Externalized large tool outputs
```

The hook fires on the `Stop` event — each time the agent finishes a task. A single interactive session may produce multiple Stops (one per completed task). Each Stop overwrites the previous archive for that session, so the stored version always reflects the latest transcript state.

## How it works

```
Stop event → read stdin → auto-detect agent → collect files → redact → tar.gz → upload
```

1. The agent's hook system sends a JSON payload via stdin with `session_id`, `transcript_path`, and `cwd`
2. The hook auto-detects which agent is running (currently Claude Code; extensible to Cursor and others)
3. The agent adapter discovers all session files from the transcript path — parent transcript, subagent transcripts, tool results
4. If privacy mode is `redacted`, sensitive content is scrubbed and the username is hashed
5. Everything is bundled into a tar.gz with a manifest
6. The archive is uploaded to cloud storage

## Setup

### 1. Install dependencies (build only)

```bash
cd hooks/trace-capture
npm install
```

The only dependencies are `typescript` and `@types/node` (dev-only). The compiled hook has **zero runtime dependencies** — it uses only Node.js built-ins.

### 2. Configure

Copy the example config and edit it:

```bash
cp trace-capture.example.json trace-capture.json
```

Then edit `trace-capture.json`:

```json
{
  "enabled": true,
  "backend": {
    "type": "gcs",
    "bucket": "my-org-claude-traces",
    "prefix": "traces/"
  },
  "privacy": {
    "mode": "redacted",
    "org_salt": "your-org-specific-random-string"
  }
}
```

### 3. Ensure `gsutil` is available

The GCS backend shells out to `gsutil`. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and authenticate:

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT
```

### 4. Build (if modifying source)

```bash
npm run build
```

The compiled `dist/` directory is checked into the repo, so you only need to rebuild if you change the TypeScript source.

## Configuration reference

The config file is `trace-capture.json` in the hook's root directory (next to `HOOK.json`).

### `enabled`

**Type:** `boolean` — **Required**

Set to `false` to disable the hook without removing it. When disabled, the hook exits immediately with no side effects.

### `backend`

**Type:** `object` — **Required**

#### `backend.type`

**Type:** `string` — **Required**

Storage backend to use. Currently supported: `"gcs"`.

#### `backend.bucket`

**Type:** `string` — **Required**

Bucket name (just the name, not a `gs://` URI).

#### `backend.prefix`

**Type:** `string` — **Default:** `""`

Key prefix for all uploaded archives. Include a trailing slash if you want a directory-like structure (e.g., `"traces/"`).

### `privacy`

**Type:** `object` — **Required**

#### `privacy.mode`

**Type:** `"full" | "redacted"` — **Required**

- **`"redacted"`** (recommended): Scrubs secrets from all transcript and tool-result content before upload. Hashes the system username in file paths. This is the safe default for org-wide deployment.
- **`"full"`**: Uploads transcripts as-is with no modifications. Use only in trusted environments where transcript content is not sensitive.

#### `privacy.org_salt`

**Type:** `string` — **Required when mode is `"redacted"`**

A random string used to hash the system username. Same salt across an organization means the same developer gets the same hash (useful for usage analytics). Different salt across orgs means hashes are unlinkable.

Generate one with: `openssl rand -hex 32`

#### `privacy.extra_patterns`

**Type:** `array` — **Default:** `[]`

Additional redaction patterns beyond the built-in set. Each entry:

```json
{
  "name": "internal_customer_id",
  "pattern": "CUST-[0-9]{6}",
  "replacement": "[REDACTED:internal_customer_id]"
}
```

- `name`: Identifier for the pattern (used in replacement if `replacement` is omitted)
- `pattern`: JavaScript regex string (applied with the `g` flag)
- `replacement`: Optional custom replacement text. Defaults to `[REDACTED:{name}]`

## Built-in redaction patterns

When `privacy.mode` is `"redacted"`, these patterns are applied (in order):

| Pattern | What it catches |
|---------|-----------------|
| `private_key` | PEM-encoded private keys (`-----BEGIN ... PRIVATE KEY-----`) |
| `jwt` | JWT tokens (`eyJ...`) |
| `aws_key` | AWS access key IDs (`AKIA...` / `ASIA...`) |
| `aws_secret` | AWS secret keys (after `aws_secret_access_key=`) |
| `github_pat` | GitHub fine-grained PATs (`github_pat_...`) |
| `github_token` | GitHub classic tokens (`ghp_...`, `gho_...`, etc.) |
| `anthropic_key` | Anthropic API keys (`sk-ant-...`) |
| `stripe_key` | Stripe keys (`sk_live_...` / `sk_test_...`) |
| `openai_key` | OpenAI API keys (`sk-...`) |
| `bearer_token` | Bearer auth tokens (`Bearer xyz...`) |
| `generic_api_key` | Generic `api_key=...` / `api_secret=...` assignments |
| `connection_string` | Database connection strings (`mongodb://...`, `postgres://...`, etc.) |
| `password_assignment` | `password=...` / `passwd=...` assignments |
| `env_secret` | Env vars with SECRET/KEY/TOKEN/PASS/CREDENTIAL in the name |
| `email` | Email addresses |

Patterns are ordered so that longer, more specific prefixes match before shorter ones (e.g., `sk-ant-` before `sk-`). The `env_secret` pattern includes a negative lookahead for `${` to avoid redacting template variable references.

In addition, the system username is replaced with a hashed placeholder (`[USER:a1b2c3d4e5f6]`) throughout all redactable content, including file paths like `/home/username/...`.

## Storage layout

Archives are stored at:

```
{prefix}{YYYY}/{MM}/{DD}/{user_hash}/{session_id}.tar.gz
```

For example: `traces/2026/04/10/a1b2c3d4e5f6/5f1a4e51-5354-4a2d-99bf-4a7fb40594a5.tar.gz`

The user hash is always used in the storage path (even in `full` mode) to organize files by developer without exposing usernames in the bucket.

## Agent support

The hook auto-detects the agent from the hook input. Currently supported:

- **Claude Code** — Detects via `/.claude/` in the transcript path or the `CLAUDE_PROJECT_DIR` environment variable. Discovers subagent transcripts at `{session_id}/subagents/` and externalized tool results at `{session_id}/tool-results/`.

Adding support for another agent (e.g., Cursor) means implementing the `AgentAdapter` interface in `src/adapters/` — everything downstream (redaction, archiving, upload) stays the same.

## Error handling

When an upload fails, the hook:

1. Writes an HTML error page to `/tmp/` with specific remediation instructions
2. Opens it in the default browser (on supported platforms)
3. Writes the error to stderr
4. Exits with code 2 so the agent surfaces the error

Common errors and their remediation:

| Error | Fix |
|-------|-----|
| `gsutil not found` | Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) |
| `auth failure` | Run `gcloud auth login` |
| `bucket not found` | Check the bucket name in `trace-capture.json` |
| `permission denied` | Grant `roles/storage.objectCreator` on the bucket |

If the config file is missing or `enabled` is `false`, the hook exits silently (code 0) with no side effects.

## Development

```bash
# Install dev dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Clean rebuild
npm run rebuild
```

### Adding a storage backend

1. Create `src/backends/yourbackend.ts` implementing the `StorageBackend` interface
2. Add a case to the factory in `src/backends/interface.ts`
3. Document the new `backend.type` value and any backend-specific config

### Adding an agent adapter

1. Create `src/adapters/youragent.ts` implementing the `AgentAdapter` interface
2. Add detection logic to `detectAgent()` in `src/adapters/interface.ts`

## License

MIT — see [LICENSE](../../LICENSE).
