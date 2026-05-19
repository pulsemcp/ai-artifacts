"use strict";
/**
 * Main entry point for the agent-transcript-capture hook.
 *
 * Reads the hook payload from stdin, auto-detects the agent, collects session
 * files, optionally redacts sensitive content, builds a tar.gz archive, and
 * uploads it to cloud storage via an unauthenticated PUT.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTRA_METADATA_ENV_VAR = void 0;
exports.resolveExtraMetadata = resolveExtraMetadata;
const path = __importStar(require("path"));
const interface_1 = require("./adapters/interface");
const interface_2 = require("./backends/interface");
const config_1 = require("./config");
const redactor_1 = require("./redactor");
const identity_1 = require("./identity");
const archive_1 = require("./archive");
const error_page_1 = require("./error-page");
const manifest_1 = require("./manifest");
// ---------------------------------------------------------------------------
// Extra metadata env var
// ---------------------------------------------------------------------------
exports.EXTRA_METADATA_ENV_VAR = "AGENT_TRANSCRIPT_CAPTURE_EXTRA_METADATA";
/**
 * Resolve the optional `extra` manifest field from
 * `AGENT_TRANSCRIPT_CAPTURE_EXTRA_METADATA`. The value is opaque to the hook:
 * users stuff anything they want into it (e.g., the flags currently enabled
 * on the Claude Code CLI) and it lands in the manifest verbatim.
 *
 * Returns `undefined` when the env var is unset or empty (caller omits the
 * field), the parsed JSON when the value is valid JSON, otherwise the raw
 * string. A bad JSON value is never an error — manifest-writer issues must
 * not fail the hook.
 */
function resolveExtraMetadata(raw) {
    if (raw === undefined)
        return undefined;
    if (raw.length === 0)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
}
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
        process.exit(0);
    }
    if (!hookInput.session_id || !hookInput.transcript_path) {
        process.exit(0);
    }
    // 2. Load config (lives alongside the hook, not in the project).
    const config = (0, config_1.loadConfig)();
    if (!config) {
        process.exit(0);
    }
    // 3. Auto-detect agent and collect session files.
    const adapter = (0, interface_1.detectAgent)(hookInput);
    const bundle = await adapter.collectSession(hookInput);
    // 4. Redact if configured.
    const isRedacted = config.privacy.mode === "redacted";
    const userId = (0, identity_1.sanitizeUserId)((0, identity_1.getUsername)());
    const archiveEntries = bundle.files.map((file) => {
        let content = file.content;
        if (isRedacted && file.redactable) {
            const text = content.toString("utf-8");
            const redacted = (0, redactor_1.redactContent)(text, config.privacy.extra_patterns);
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
        agent_version: adapter.agentVersion(hookInput),
        privacy_mode: config.privacy.mode,
        user_id: userId,
        files: archiveEntries.map((e) => e.path),
    };
    const extra = resolveExtraMetadata(process.env[exports.EXTRA_METADATA_ENV_VAR]);
    if (extra !== undefined) {
        manifest.extra = extra;
    }
    archiveEntries.unshift({
        path: "manifest.json",
        content: Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
    });
    const archive = await (0, archive_1.buildTarGz)(archiveEntries);
    // 6. Client-side max archive size enforcement. Defense-in-depth against
    //    accidental oversized uploads; doesn't help against a malicious actor
    //    holding the namespace_key, which is the issue's documented hole.
    const maxBytes = config.no_auth.max_archive_bytes || 50 * 1024 * 1024;
    if (archive.length > maxBytes) {
        const details = `Built archive is ${archive.length} bytes; the configured limit is ${maxBytes} bytes ` +
            `(no_auth.max_archive_bytes in HOOK.json).`;
        (0, error_page_1.showError)("archive_too_large", details, bundle.sessionId);
        process.stderr.write(`agent-transcript-capture: archive too large (${archive.length} > ${maxBytes})\n`);
        process.exit(2);
    }
    // 7. Compose the object key. The backend decides whether to prepend the
    //    namespace_key (S3 needs it for bucket-policy scoping; GCS doesn't,
    //    because the secret is already in the bucket name).
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const suffix = `${userId}/${yyyy}/${mm}/${dd}/${bundle.sessionId}.tar.gz`;
    const backend = (0, interface_2.createBackend)((0, config_1.toBackendConfig)(config.no_auth));
    const key = backend.buildObjectKey(suffix);
    // 8. Upload.
    const result = await backend.upload(key, archive);
    if (result.success) {
        // Record the upload locally so the CLI can list/delete it.
        try {
            (0, manifest_1.appendRecord)({
                session_id: bundle.sessionId,
                timestamp: now.toISOString(),
                provider: backend.provider,
                bucket: backend.bucket,
                object_key: key,
                object_uri: backend.objectUrl(key),
                agent: adapter.name,
                status: "uploaded",
            });
        }
        catch {
            // Manifest failure must not fail the hook.
        }
        // Surface the upload via the adapter so each harness can use its own
        // inline-message mechanism. For Claude Code a plain stdout line from a
        // Stop hook is only visible in transcript view (Ctrl-R); the Claude
        // adapter emits a JSON envelope with a `systemMessage` field, which is
        // the documented way for a Stop hook to surface a line inline in the
        // chat.
        const cliPath = path.resolve(__dirname, "cli.js");
        process.stdout.write(adapter.formatUploadSuccess({
            sessionId: bundle.sessionId,
            objectUrl: backend.objectUrl(key),
            cliPath,
        }));
        process.exit(0);
    }
    // 9. Loud failure.
    const errorMsg = result.error || "upload_failed";
    const details = result.details || "No details available.";
    (0, error_page_1.showError)(errorMsg, details, bundle.sessionId);
    process.stderr.write(`agent-transcript-capture: upload failed (${errorMsg}): ${details}\n`);
    process.exit(2);
}
// Only run main() when invoked as the entry script, so other modules (and
// tests) can import the helpers above without triggering an stdin read +
// process.exit.
if (require.main === module) {
    main().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        (0, error_page_1.showError)("unexpected_error", message, "unknown");
        process.stderr.write(`agent-transcript-capture: unexpected error: ${message}\n`);
        process.exit(2);
    });
}
