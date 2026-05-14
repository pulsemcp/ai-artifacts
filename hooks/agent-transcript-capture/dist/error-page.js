"use strict";
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
exports.showError = showError;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
// ---------------------------------------------------------------------------
// Remediation messages keyed by error category
// ---------------------------------------------------------------------------
const REMEDIATION = {
    permission_denied: `
    <ol>
      <li>Confirm the bucket policy (S3) or IAM Condition (GCS) grants <code>PutObject</code>+<code>DeleteObject</code> to the public principal, scoped to <code>{namespace_key}/*</code></li>
      <li>For S3: confirm Block Public Access is disabled at both account and bucket levels (<code>BlockPublicPolicy</code> + <code>RestrictPublicBuckets</code>)</li>
      <li>Verify the <code>namespace_key</code> in your config matches the one the bucket grants access to</li>
    </ol>`,
    not_found: `
    <ol>
      <li>Verify the bucket name in <code>HOOK.json</code></li>
      <li>Ensure the bucket exists and the region (for S3) is correct</li>
    </ol>`,
    payload_too_large: `
    <ol>
      <li>The bucket rejected this archive as too large. Reduce <code>no_auth.max_archive_bytes</code> in HOOK.json or shorten the session</li>
    </ol>`,
    archive_too_large: `
    <ol>
      <li>This archive exceeded the configured client-side cap (<code>no_auth.max_archive_bytes</code>, default 50 MB)</li>
      <li>Raise the cap, exclude large files from the bundle, or shorten the session</li>
    </ol>`,
    network_error: `
    <ol>
      <li>Check your network connection</li>
      <li>If you're behind a proxy, ensure HTTPS access to <code>storage.googleapis.com</code> (GCS) or <code>*.amazonaws.com</code> (S3) is permitted</li>
    </ol>`,
    http_error: `
    <ol>
      <li>Inspect the HTTP status and response body below</li>
      <li>If 4xx: the bucket or namespace_key configuration is off — see permission_denied remediation</li>
      <li>If 5xx: cloud-provider transient error, the next session will retry</li>
    </ol>`,
};
// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------
function generateErrorHTML(error, details, sessionId) {
    const remediation = REMEDIATION[error] ||
        `<p>Check the error details below and verify your <code>HOOK.json</code> configuration.</p>`;
    const escapedDetails = details
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Agent Transcript Capture Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; background: #fafafa; }
    h1 { color: #c0392b; font-size: 1.4em; }
    .error-box { background: #fff; border: 2px solid #e74c3c; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .details { background: #2d2d2d; color: #f0f0f0; padding: 16px; border-radius: 6px; overflow-x: auto; font-family: "SF Mono", Monaco, monospace; font-size: 0.85em; white-space: pre-wrap; word-break: break-word; }
    .remediation { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 20px; }
    .remediation ol { padding-left: 20px; }
    .remediation li { margin-bottom: 8px; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    .meta { color: #888; font-size: 0.85em; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>Agent Transcript Capture Failed</h1>
  <div class="error-box">
    <strong>Error:</strong> ${error.replace(/_/g, " ")}
  </div>

  <h2>How to fix</h2>
  <div class="remediation">
    ${remediation}
  </div>

  ${details ? `<h2>Details</h2><div class="details">${escapedDetails}</div>` : ""}

  <div class="meta">
    Session: ${sessionId}<br>
    Time: ${new Date().toISOString()}
  </div>
</body>
</html>`;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Whether to actually launch a browser. CI and other non-TTY environments
 * just write the HTML and leave it on disk; opening a browser is awful in
 * those contexts. Override with AGENT_TRANSCRIPT_CAPTURE_OPEN_BROWSER=1.
 */
function shouldOpenBrowser() {
    if (process.env.AGENT_TRANSCRIPT_CAPTURE_OPEN_BROWSER === "1")
        return true;
    if (process.env.AGENT_TRANSCRIPT_CAPTURE_OPEN_BROWSER === "0")
        return false;
    return Boolean(process.stdout.isTTY);
}
/**
 * Write an HTML error page to /tmp. If running interactively, open it in
 * the default browser. Returns the path to the HTML file.
 */
function showError(error, details, sessionId) {
    const html = generateErrorHTML(error, details, sessionId);
    const filename = `agent-transcript-capture-error-${Date.now()}.html`;
    const filePath = path.join(os.tmpdir(), filename);
    fs.writeFileSync(filePath, html, "utf-8");
    if (shouldOpenBrowser()) {
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        try {
            const child = (0, child_process_1.spawn)(opener, [filePath], {
                detached: true,
                stdio: "ignore",
            });
            child.unref();
        }
        catch {
            // If opening fails, the HTML file path is still returned for diagnostics.
        }
    }
    return filePath;
}
