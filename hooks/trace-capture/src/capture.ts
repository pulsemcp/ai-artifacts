/**
 * Main entry point for the trace-capture hook.
 *
 * Reads the hook payload from stdin, auto-detects the agent, collects session
 * files, optionally redacts sensitive content, builds a tar.gz archive, and
 * uploads it to cloud storage.
 */

import { HookInput, detectAgent } from "./adapters/interface";
import { createBackend } from "./backends/interface";
import { loadConfig } from "./config";
import { redactContent } from "./redactor";
import { getUsername, hashUser, scrubUsername } from "./identity";
import { buildTarGz, ArchiveEntry } from "./archive";
import { showError } from "./error-page";

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
  if (!config || !config.enabled) {
    process.exit(0);
  }

  // 3. Auto-detect agent and collect session files.
  const adapter = detectAgent(hookInput);
  const bundle = await adapter.collectSession(hookInput);

  // 4. Redact if configured.
  const isRedacted = config.privacy.mode === "redacted";
  const hashIdentity = config.privacy.hash_user_identity;
  const userLabel = hashIdentity
    ? hashUser(config.privacy.org_salt)
    : getUsername();

  const archiveEntries: ArchiveEntry[] = bundle.files.map((file) => {
    let content = file.content;

    if (isRedacted && file.redactable) {
      let text = content.toString("utf-8");
      text = redactContent(text, config.privacy.extra_patterns);
      if (hashIdentity) {
        text = scrubUsername(text, userLabel);
      }
      content = Buffer.from(text, "utf-8");
    }

    return { path: file.archivePath, content };
  });

  // 5. Build manifest and tar.gz archive.
  const manifest = {
    version: 1,
    created: new Date().toISOString(),
    session_id: bundle.sessionId,
    agent: adapter.name,
    privacy_mode: config.privacy.mode,
    user: userLabel,
    files: archiveEntries.map((e) => e.path),
  };
  archiveEntries.unshift({
    path: "manifest.json",
    content: Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
  });

  const archive = await buildTarGz(archiveEntries);

  // 6. Compute storage key.
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const prefix = config.backend.prefix;
  const key = `${prefix}${yyyy}/${mm}/${dd}/${userLabel}/${bundle.sessionId}.tar.gz`;

  // 7. Upload.
  const backend = createBackend(config.backend);
  const result = await backend.upload(key, archive);

  if (result.success) {
    process.exit(0);
  }

  // 8. Loud failure.
  const errorMsg = result.error || "upload_failed";
  const details = result.details || "No details available.";

  showError(errorMsg, details, bundle.sessionId);
  process.stderr.write(
    `trace-capture: upload failed (${errorMsg}): ${details}\n`
  );
  process.exit(2);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  showError("unexpected_error", message, "unknown");
  process.stderr.write(`trace-capture: unexpected error: ${message}\n`);
  process.exit(2);
});
