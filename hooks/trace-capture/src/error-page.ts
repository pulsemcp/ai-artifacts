import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

// ---------------------------------------------------------------------------
// Remediation messages keyed by error category
// ---------------------------------------------------------------------------

const REMEDIATION: Record<string, string> = {
  gsutil_not_found: `
    <ol>
      <li>Install the Google Cloud SDK: <a href="https://cloud.google.com/sdk/docs/install">https://cloud.google.com/sdk/docs/install</a></li>
      <li>Run <code>gcloud auth login</code></li>
      <li>Run <code>gcloud config set project YOUR_PROJECT</code></li>
      <li>Restart your Claude Code session</li>
    </ol>`,
  auth_failure: `
    <ol>
      <li>Run <code>gcloud auth login</code> to refresh your credentials</li>
      <li>If using a service account, ensure <code>GOOGLE_APPLICATION_CREDENTIALS</code> is set</li>
      <li>Restart your Claude Code session</li>
    </ol>`,
  bucket_not_found: `
    <ol>
      <li>Verify the bucket name in <code>HOOK.json</code></li>
      <li>Ensure the bucket exists: <code>gsutil ls gs://YOUR_BUCKET</code></li>
      <li>Check your GCP project: <code>gcloud config get-value project</code></li>
    </ol>`,
  permission_denied: `
    <ol>
      <li>Ensure your account has <code>roles/storage.objectCreator</code> on the bucket</li>
      <li>Check bucket IAM: <code>gsutil iam get gs://YOUR_BUCKET</code></li>
      <li>If using a service account, verify its permissions in the GCP console</li>
    </ol>`,
};

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function generateErrorHTML(
  error: string,
  details: string,
  sessionId: string
): string {
  const remediation =
    REMEDIATION[error] ||
    `<p>Check the error details below and verify your <code>HOOK.json</code> configuration.</p>`;

  const escapedDetails = details
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Trace Capture Error</title>
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
  <h1>Trace Capture Failed</h1>
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
 * Write an HTML error page to /tmp and open it in the default browser.
 */
export function showError(
  error: string,
  details: string,
  sessionId: string
): void {
  const html = generateErrorHTML(error, details, sessionId);
  const filename = `trace-capture-error-${Date.now()}.html`;
  const filePath = path.join(os.tmpdir(), filename);

  fs.writeFileSync(filePath, html, "utf-8");

  // Open in default browser (best-effort, non-blocking).
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(opener, [filePath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // If opening fails (e.g., headless server), the user still gets the
    // stderr message from the main flow. The HTML file remains in /tmp.
  }
}
