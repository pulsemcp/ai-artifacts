#!/usr/bin/env node
/**
 * End-to-end test: Claude Code -> Stop hook -> capture -> GCS upload -> manifest -> CLI.
 *
 * Spins up a mock Anthropic API server, runs Claude Code in --print mode with
 * the trace-capture hook configured, and verifies the full pipeline including
 * a real GCS upload.
 *
 * Usage:
 *   node test/e2e/hook-fires.mjs
 *
 * Environment (one of):
 *   GOOGLE_APPLICATION_CREDENTIALS — path to GCS service account key JSON
 *   GCS_SA_KEY                     — raw JSON string of the service account key
 *   GCS_PULSEMCP_SERVICE_ACCOUNT_KEY_JSON — same, shell-escaped
 *
 * Optional:
 *   CLAUDE_BIN — override path to claude binary
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import {
  execFile,
  execFileSync,
  spawn as nodeSpawn,
} from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOOK_ROOT = resolve(__dirname, "..", "..");
const CAPTURE_JS = join(HOOK_ROOT, "dist", "capture.js");
const CLI_JS = join(HOOK_ROOT, "dist", "cli.js");
const CONFIG_PATH = join(HOOK_ROOT, "trace-capture.json");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "/home/rails/.local/bin/claude";
const E2E_BUCKET = "pulsemcp-trace-capture-e2e";

// ---------------------------------------------------------------------------
// GCS credential setup
// ---------------------------------------------------------------------------

/**
 * Set up GCS credentials for gsutil. Returns env vars to pass to child
 * processes, or null if no credentials are available.
 */
function setupGcsCredentials(tmpDir) {
  // Case 1: GOOGLE_APPLICATION_CREDENTIALS already points to a key file.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      return null;
    }
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const botoPath = join(tmpDir, "boto-config");
    writeFileSync(
      botoPath,
      `[Credentials]\ngs_service_key_file = ${keyPath}\n`
    );
    return { BOTO_CONFIG: botoPath, GOOGLE_APPLICATION_CREDENTIALS: keyPath };
  }

  // Case 2: GCS_SA_KEY or GCS_PULSEMCP_SERVICE_ACCOUNT_KEY_JSON env var.
  const rawKey =
    process.env.GCS_SA_KEY ||
    process.env.GCS_PULSEMCP_SERVICE_ACCOUNT_KEY_JSON;
  if (!rawKey) return null;

  // Parse the key JSON (may have shell-escaped quotes).
  let parsed;
  try {
    parsed = JSON.parse(rawKey);
  } catch {
    try {
      parsed = JSON.parse(rawKey.replace(/\\"/g, '"'));
    } catch {
      return null;
    }
  }
  // Ensure private_key has real newlines.
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  const keyPath = join(tmpDir, "gcs-sa-key.json");
  writeFileSync(keyPath, JSON.stringify(parsed, null, 2));

  const botoPath = join(tmpDir, "boto-config");
  writeFileSync(
    botoPath,
    `[Credentials]\ngs_service_key_file = ${keyPath}\n`
  );

  return { BOTO_CONFIG: botoPath, GOOGLE_APPLICATION_CREDENTIALS: keyPath };
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

function preflight(gcsEnv) {
  if (!existsSync(CLAUDE_BIN)) {
    console.log(`SKIP: Claude binary not found at ${CLAUDE_BIN}`);
    process.exit(0);
  }
  if (!existsSync(CAPTURE_JS)) {
    console.error(
      "FAIL: dist/capture.js not found -- run npm run build first"
    );
    process.exit(1);
  }
  if (!gcsEnv) {
    console.log("SKIP: No GCS credentials available, skipping e2e test");
    process.exit(0);
  }
  try {
    execFileSync("gsutil", ["version"], {
      stdio: "pipe",
      env: { ...process.env, ...gcsEnv },
    });
  } catch {
    console.log("SKIP: gsutil not installed, skipping e2e test");
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Mock Anthropic API server
// ---------------------------------------------------------------------------

const SSE_RESPONSE = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg_mock_001","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":1}}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  "event: ping",
  'data: {"type":"ping"}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello! I received your message."}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":8}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

function createMockAnthropicServer() {
  const requests = [];

  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });

    // Strip query parameters for routing.
    const pathname = (req.url || "").split("?")[0];

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "POST" && pathname === "/v1/messages") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.end(SSE_RESPONSE);
        return;
      }
      if (
        req.method === "POST" &&
        pathname === "/v1/messages/count_tokens"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"input_tokens":100}');
        return;
      }
      // Handle model listing / retrieval.
      if (pathname?.startsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "claude-sonnet-4-20250514", object: "model" }],
          })
        );
        return;
      }
      // Accept any other request to avoid failures.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawn(bin, args, opts) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: 60_000, ...opts },
      (err, stdout, stderr) => {
        resolve({
          code: err ? err.code ?? 1 : 0,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "trace-e2e-"));
  const gcsEnv = setupGcsCredentials(tmp);

  preflight(gcsEnv);

  const mock = await createMockAnthropicServer();
  const traceHome = join(tmp, "trace-capture-home");
  const workDir = join(tmp, "workdir");
  mkdirSync(traceHome, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  // Env for child processes: merge GCS creds + test overrides.
  const childEnv = { ...process.env, ...gcsEnv };

  // Save original config.
  const origConfig = readFileSync(CONFIG_PATH, "utf-8");

  // Write test config pointing to real GCS bucket.
  const testPrefix = `e2e-hook-fires/${Date.now()}/`;
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        backend: { type: "gcs", bucket: E2E_BUCKET, prefix: testPrefix },
        privacy: {
          mode: "full",
          hash_user_identity: false,
          org_salt: "",
        },
      },
      null,
      2
    )
  );

  // Write settings.json for Claude Code with our hook.
  const settingsPath = join(tmp, "settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              { type: "command", command: `node ${CAPTURE_JS}` },
            ],
          },
        ],
      },
    })
  );

  let sessionId;

  try {
    // -----------------------------------------------------------------------
    // 1. Run Claude Code
    // -----------------------------------------------------------------------
    console.log("  Starting mock Anthropic API server...");
    console.log(`  Mock URL: ${mock.url}`);
    console.log("  Spawning Claude Code...");

    const claude = await new Promise((resolve) => {
      const child = nodeSpawn(
        CLAUDE_BIN,
        [
          "--print",
          "--dangerously-skip-permissions",
          "--model",
          "claude-sonnet-4-20250514",
          "--settings",
          settingsPath,
          "Say hello",
        ],
        {
          cwd: workDir,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...childEnv,
            ANTHROPIC_BASE_URL: mock.url,
            ANTHROPIC_API_KEY: "test-key-for-e2e",
            TRACE_CAPTURE_HOME: traceHome,
          },
        }
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, 60_000);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });

    console.log(`  Claude Code exited with code ${claude.code}`);
    if (claude.stdout) {
      console.log(`  stdout: ${claude.stdout.slice(0, 500)}`);
    }
    if (claude.stderr) {
      console.log(`  stderr: ${claude.stderr.slice(0, 500)}`);
    }

    assert.equal(
      claude.code,
      0,
      `Claude Code exited with ${claude.code}.\nstderr: ${claude.stderr}`
    );

    // -----------------------------------------------------------------------
    // 2. Verify mock server received requests
    // -----------------------------------------------------------------------
    const messageRequests = mock.requests.filter((r) =>
      (r.url || "").split("?")[0] === "/v1/messages"
    );
    assert(
      messageRequests.length >= 1,
      `Mock should have received >= 1 /v1/messages request, got ${messageRequests.length}. All requests: ${JSON.stringify(mock.requests.map((r) => r.url))}`
    );
    console.log(
      `  Mock received ${messageRequests.length} /v1/messages request(s)`
    );

    // -----------------------------------------------------------------------
    // 3. Verify manifest was written
    // -----------------------------------------------------------------------
    const manifestFile = join(traceHome, "uploads.jsonl");
    assert(
      existsSync(manifestFile),
      "uploads.jsonl was not created -- hook may not have fired"
    );

    const lines = readFileSync(manifestFile, "utf-8").trim().split("\n");
    assert.equal(
      lines.length,
      1,
      `Expected 1 manifest entry, got ${lines.length}`
    );

    const record = JSON.parse(lines[0]);
    assert.equal(record.status, "uploaded");
    assert.equal(record.agent, "claude");
    assert.equal(record.bucket, E2E_BUCKET);
    assert(
      record.gcs_key.startsWith(testPrefix),
      `gcs_key should start with ${testPrefix}, got: ${record.gcs_key}`
    );
    assert(record.session_id.length > 0, "session_id should be non-empty");
    sessionId = record.session_id;
    console.log(`  Manifest entry OK -- session ${sessionId}`);

    // -----------------------------------------------------------------------
    // 4. Verify the archive exists in GCS
    // -----------------------------------------------------------------------
    const gcsUri = record.gcs_uri;
    try {
      execFileSync("gsutil", ["stat", gcsUri], {
        stdio: "pipe",
        env: childEnv,
      });
      console.log(`  GCS object verified: ${gcsUri}`);
    } catch (e) {
      assert.fail(`Archive not found in GCS at ${gcsUri}`);
    }

    // -----------------------------------------------------------------------
    // 5. CLI list
    // -----------------------------------------------------------------------
    const listResult = await spawn("node", [CLI_JS, "list"], {
      env: { ...childEnv, TRACE_CAPTURE_HOME: traceHome },
    });
    assert.equal(listResult.code, 0, `CLI list failed: ${listResult.stderr}`);
    assert(
      listResult.stdout.includes(sessionId.slice(0, 12)),
      `CLI list should contain session ID prefix.\nOutput: ${listResult.stdout}`
    );
    console.log("  CLI list OK");

    // -----------------------------------------------------------------------
    // 6. CLI delete
    // -----------------------------------------------------------------------
    const deleteResult = await spawn(
      "node",
      [CLI_JS, "delete", sessionId],
      {
        env: { ...childEnv, TRACE_CAPTURE_HOME: traceHome },
      }
    );
    assert.equal(
      deleteResult.code,
      0,
      `CLI delete failed: ${deleteResult.stderr}\n${deleteResult.stdout}`
    );
    console.log("  CLI delete OK");

    // -----------------------------------------------------------------------
    // 7. Verify delete in manifest
    // -----------------------------------------------------------------------
    const linesAfter = readFileSync(manifestFile, "utf-8")
      .trim()
      .split("\n");
    assert.equal(
      linesAfter.length,
      2,
      `Should have 2 manifest entries after delete, got ${linesAfter.length}`
    );
    const deletedRecord = JSON.parse(linesAfter[1]);
    assert.equal(deletedRecord.status, "deleted");
    assert(deletedRecord.deleted_at, "deleted_at should be set");
    console.log("  Manifest delete entry OK");

    // -----------------------------------------------------------------------
    // 8. Verify object gone from GCS
    // -----------------------------------------------------------------------
    try {
      execFileSync("gsutil", ["stat", gcsUri], {
        stdio: "pipe",
        env: childEnv,
      });
      assert.fail(`Archive should have been deleted from GCS: ${gcsUri}`);
    } catch {
      console.log("  GCS object deleted OK");
    }

    console.log("\nPASS: hook-fires e2e test");
  } finally {
    // Restore config.
    writeFileSync(CONFIG_PATH, origConfig, "utf-8");

    // Clean up GCS prefix (best-effort).
    try {
      execFileSync(
        "gsutil",
        ["-m", "rm", "-r", `gs://${E2E_BUCKET}/${testPrefix}`],
        { stdio: "pipe", timeout: 15_000, env: childEnv }
      );
    } catch {
      // May already be cleaned up by delete test.
    }

    // Clean up temp dir.
    rmSync(tmp, { recursive: true, force: true });

    // Close mock server.
    await mock.close();
  }
}

main().catch((err) => {
  console.error(`\nFAIL: ${err.message}`);
  if (err.code === "ERR_ASSERTION") {
    console.error(err);
  }
  process.exit(1);
});
