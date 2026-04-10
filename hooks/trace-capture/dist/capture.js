"use strict";
/**
 * Main entry point for the trace-capture hook.
 *
 * Reads the hook payload from stdin, collects session files via the agent
 * adapter, optionally redacts sensitive content, builds a tar.gz archive,
 * and uploads it to cloud storage.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const interface_1 = require("./adapters/interface");
const interface_2 = require("./backends/interface");
const config_1 = require("./config");
const redactor_1 = require("./redactor");
const identity_1 = require("./identity");
const archive_1 = require("./archive");
const error_page_1 = require("./error-page");
// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------
function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        process.stdin.on("error", reject);
    });
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    // 1. Read hook payload from stdin.
    const raw = await readStdin();
    if (!raw.trim()) {
        process.exit(0);
    }
    let hookInput;
    try {
        hookInput = JSON.parse(raw);
    }
    catch {
        // Malformed stdin — not our problem, exit silently.
        process.exit(0);
    }
    if (!hookInput.session_id || !hookInput.transcript_path) {
        process.exit(0);
    }
    // 2. Load config.
    const config = (0, config_1.loadConfig)(hookInput.cwd);
    if (!config || !config.enabled) {
        process.exit(0);
    }
    // 3. Create agent adapter and collect session files.
    const adapter = (0, interface_1.createAdapter)(config.agent);
    const bundle = await adapter.collectSession(hookInput);
    // 4. Redact if configured.
    const isRedacted = config.privacy.mode === "redacted";
    const hashedUser = (0, identity_1.hashUser)(isRedacted ? config.privacy.org_salt : "default");
    const archiveEntries = bundle.files.map((file) => {
        let content = file.content;
        if (isRedacted && file.redactable) {
            let text = content.toString("utf-8");
            text = (0, redactor_1.redactContent)(text, config.privacy.extra_patterns);
            text = (0, identity_1.scrubUsername)(text, hashedUser);
            content = Buffer.from(text, "utf-8");
        }
        return { path: file.archivePath, content };
    });
    // 5. Build tar.gz archive.
    const archive = await (0, archive_1.buildTarGz)(archiveEntries);
    // 6. Compute storage key.
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const prefix = config.backend.prefix;
    const key = `${prefix}${yyyy}/${mm}/${dd}/${hashedUser}/${bundle.sessionId}.tar.gz`;
    // 7. Upload.
    const backend = (0, interface_2.createBackend)(config.backend);
    const result = await backend.upload(key, archive);
    if (result.success) {
        process.exit(0);
    }
    // 8. Loud failure.
    const errorMsg = result.error || "upload_failed";
    const details = result.details || "No details available.";
    (0, error_page_1.showError)(errorMsg, details, bundle.sessionId);
    process.stderr.write(`trace-capture: upload failed (${errorMsg}): ${details}\n`);
    process.exit(2);
}
main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    (0, error_page_1.showError)("unexpected_error", message, "unknown");
    process.stderr.write(`trace-capture: unexpected error: ${message}\n`);
    process.exit(2);
});
