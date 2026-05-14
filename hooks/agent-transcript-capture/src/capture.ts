/**
 * Main entry point for the agent-transcript-capture hook.
 *
 * Reads the hook payload from stdin, auto-detects the agent, collects session
 * files, optionally redacts sensitive content, builds a tar.gz archive, and
 * uploads it to cloud storage via an unauthenticated PUT.
 */

import { HookInput, detectAgent } from "./adapters/interface";
import { createBackend } from "./backends/interface";
import { loadConfig, toBackendConfig } from "./config";
import { redactContent } from "./redactor";
import { getUsername, sanitizeUserId } from "./identity";
import { buildTarGz, ArchiveEntry } from "./archive";
import { showError } from "./error-page";
import { appendRecord } from "./manifest";

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf-8"))
    );
    process.stdin.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Read hook payload from stdin.
  const raw = await readStdin();
  if (!raw.trim()) {
    process.exit(0);
  }

  let hookInput: HookInput;
  try {
    hookInput = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!hookInput.session_id || !hookInput.transcript_path) {
    process.exit(0);
  }

  // 2. Load config (lives alongside the hook, not in the project).
  const config = loadConfig();
  if (!config) {
    process.exit(0);
  }

  // 3. Auto-detect agent and collect session files.
  const adapter = detectAgent(hookInput);
  const bundle = await adapter.collectSession(hookInput);

  // 4. Redact if configured.
  const isRedacted = config.privacy.mode === "redacted";
  const userId = sanitizeUserId(getUsername());

  const archiveEntries: ArchiveEntry[] = bundle.files.map((file) => {
    let content = file.content;

    if (isRedacted && file.redactable) {
      const text = content.toString("utf-8");
      const redacted = redactContent(text, config.privacy.extra_patterns);
      content = Buffer.from(redacted, "utf-8");
    }

    return { path: file.archivePath, content };
  });

  // 5. Build manifest and tar.gz archive.
  const now = new Date();
  const manifest = {
    version: 1,
    created: now.toISOString(),
    session_id: bundle.sessionId,
    agent: adapter.name,
    privacy_mode: config.privacy.mode,
    user_id: userId,
    files: archiveEntries.map((e) => e.path),
  };
  archiveEntries.unshift({
    path: "manifest.json",
    content: Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
  });

  const archive = await buildTarGz(archiveEntries);

  // 6. Client-side max archive size enforcement. Defense-in-depth against
  //    accidental oversized uploads; doesn't help against a malicious actor
  //    holding the namespace_key, which is the issue's documented hole.
  const maxBytes =
    config.no_auth.max_archive_bytes || 50 * 1024 * 1024;
  if (archive.length > maxBytes) {
    const details =
      `Built archive is ${archive.length} bytes; the configured limit is ${maxBytes} bytes ` +
      `(no_auth.max_archive_bytes in HOOK.json).`;
    showError("archive_too_large", details, bundle.sessionId);
    process.stderr.write(
      `agent-transcript-capture: archive too large (${archive.length} > ${maxBytes})\n`
    );
    process.exit(2);
  }

  // 7. Compose the object key. The backend decides whether to prepend the
  //    namespace_key (S3 needs it for bucket-policy scoping; GCS doesn't,
  //    because the secret is already in the bucket name).
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const suffix = `${userId}/${yyyy}/${mm}/${dd}/${bundle.sessionId}.tar.gz`;
  const backend = createBackend(toBackendConfig(config.no_auth));
  const key = backend.buildObjectKey(suffix);

  // 8. Upload.
  const result = await backend.upload(key, archive);

  if (result.success) {
    // Record the upload locally so the CLI can list/delete it.
    try {
      appendRecord({
        session_id: bundle.sessionId,
        timestamp: now.toISOString(),
        provider: backend.provider,
        bucket: backend.bucket,
        object_key: key,
        object_uri: backend.objectUrl(key),
        agent: adapter.name,
        status: "uploaded",
      });
    } catch {
      // Manifest failure must not fail the hook.
    }

    // Claude Code shows stdout (not stderr) to the user for exit-0 hooks.
    process.stdout.write(
      `agent-transcript-capture: uploaded session ${bundle.sessionId} (${backend.objectUrl(key)})\n` +
        `  Run: node hooks/agent-transcript-capture/dist/cli.js list\n`
    );
    process.exit(0);
  }

  // 9. Loud failure.
  const errorMsg = result.error || "upload_failed";
  const details = result.details || "No details available.";

  showError(errorMsg, details, bundle.sessionId);
  process.stderr.write(
    `agent-transcript-capture: upload failed (${errorMsg}): ${details}\n`
  );
  process.exit(2);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  showError("unexpected_error", message, "unknown");
  process.stderr.write(`agent-transcript-capture: unexpected error: ${message}\n`);
  process.exit(2);
});
