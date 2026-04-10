#!/usr/bin/env node
/**
 * End-to-end test: capture.js -> real GCS upload -> CLI list -> CLI delete -> verify gone.
 *
 * This test does NOT spawn Claude Code. It pipes a hook payload directly to
 * dist/capture.js with a fake transcript, verifying the full GCS roundtrip.
 *
 * Usage:
 *   node test/e2e/gcs-roundtrip.mjs
 *
 * Environment (one of):
 *   GOOGLE_APPLICATION_CREDENTIALS — path to GCS service account key JSON
 *   GCS_SA_KEY                     — raw JSON string of the service account key
 *   GCS_PULSEMCP_SERVICE_ACCOUNT_KEY_JSON — same, shell-escaped
 */

import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOOK_ROOT = resolve(__dirname, "..", "..");
const CAPTURE_JS = join(HOOK_ROOT, "dist", "capture.js");
const CLI_JS = join(HOOK_ROOT, "dist", "cli.js");
const CONFIG_PATH = join(HOOK_ROOT, "trace-capture.json");
const E2E_BUCKET = "pulsemcp-trace-capture-e2e";

// ---------------------------------------------------------------------------
// GCS credential setup (shared logic with hook-fires.mjs)
// ---------------------------------------------------------------------------

function setupGcsCredentials(tmpDir) {
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

  const rawKey =
    process.env.GCS_SA_KEY ||
    process.env.GCS_PULSEMCP_SERVICE_ACCOUNT_KEY_JSON;
  if (!rawKey) return null;

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
  if (!existsSync(CAPTURE_JS)) {
    console.error(
      "FAIL: dist/capture.js not found -- run npm run build first"
    );
    process.exit(1);
  }
  if (!gcsEnv) {
    console.log("SKIP: No GCS credentials available, skipping GCS roundtrip");
    process.exit(0);
  }
  try {
    execFileSync("gsutil", ["version"], {
      stdio: "pipe",
      env: { ...process.env, ...gcsEnv },
    });
  } catch {
    console.log("SKIP: gsutil not installed, skipping GCS roundtrip");
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnCapture(hookPayload, env) {
  return new Promise((resolve) => {
    const child = execFile(
      "node",
      [CAPTURE_JS],
      { cwd: HOOK_ROOT, timeout: 30_000, env },
      (err, stdout, stderr) => {
        resolve({
          code: err ? err.code ?? 1 : 0,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      }
    );
    child.stdin.write(hookPayload);
    child.stdin.end();
  });
}

function spawn(bin, args, opts) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: 30_000, ...opts },
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
  const tmp = mkdtempSync(join(tmpdir(), "trace-gcs-e2e-"));
  const gcsEnv = setupGcsCredentials(tmp);

  preflight(gcsEnv);

  const traceHome = join(tmp, "trace-capture-home");
  mkdirSync(traceHome, { recursive: true });

  const childEnv = { ...process.env, ...gcsEnv };

  // Create a fake Claude transcript structure.
  const sessionId = `e2e-gcs-${Date.now()}`;
  const projectDir = join(tmp, ".claude", "projects", "test-project");
  mkdirSync(projectDir, { recursive: true });

  const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
  const transcriptContent =
    [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Say hello" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello!" }],
        },
      }),
    ].join("\n") + "\n";
  writeFileSync(transcriptPath, transcriptContent, "utf-8");

  // Create a subagent to test multi-file collection.
  const subagentsDir = join(projectDir, sessionId, "subagents");
  mkdirSync(subagentsDir, { recursive: true });
  writeFileSync(
    join(subagentsDir, "agent-test1.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub response" }],
      },
    }) + "\n",
    "utf-8"
  );
  writeFileSync(
    join(subagentsDir, "agent-test1.meta.json"),
    JSON.stringify({ type: "explore", description: "Test subagent" }),
    "utf-8"
  );

  // Save original config.
  const origConfig = readFileSync(CONFIG_PATH, "utf-8");

  // Write test config.
  const testPrefix = `e2e-gcs-roundtrip/${Date.now()}/`;
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        backend: { type: "gcs", bucket: E2E_BUCKET, prefix: testPrefix },
        privacy: {
          mode: "redacted",
          hash_user_identity: false,
          org_salt: "",
        },
      },
      null,
      2
    )
  );

  const hookPayload = JSON.stringify({
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd: tmp,
    hook_event_name: "Stop",
  });

  try {
    // -----------------------------------------------------------------------
    // 1. Run capture.js
    // -----------------------------------------------------------------------
    console.log("  Running capture.js with hook payload...");
    const captureResult = await spawnCapture(hookPayload, {
      ...childEnv,
      TRACE_CAPTURE_HOME: traceHome,
    });

    console.log(`  capture.js exited with code ${captureResult.code}`);
    if (captureResult.stderr) {
      console.log(`  stderr: ${captureResult.stderr.slice(0, 500)}`);
    }
    assert.equal(
      captureResult.code,
      0,
      `capture.js failed.\nstderr: ${captureResult.stderr}`
    );

    // Verify stderr message.
    assert(
      captureResult.stderr.includes("trace-capture: uploaded session"),
      `stderr should contain upload confirmation.\nstderr: ${captureResult.stderr}`
    );

    // -----------------------------------------------------------------------
    // 2. Verify manifest
    // -----------------------------------------------------------------------
    const manifestFile = join(traceHome, "uploads.jsonl");
    assert(existsSync(manifestFile), "uploads.jsonl was not created");

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
    assert.equal(record.session_id, sessionId);
    assert(record.gcs_key.startsWith(testPrefix));
    console.log(`  Manifest entry OK -- session ${sessionId}`);

    // -----------------------------------------------------------------------
    // 3. Verify archive exists in GCS
    // -----------------------------------------------------------------------
    const gcsUri = record.gcs_uri;
    try {
      execFileSync("gsutil", ["stat", gcsUri], {
        stdio: "pipe",
        env: childEnv,
      });
      console.log(`  GCS object verified: ${gcsUri}`);
    } catch {
      assert.fail(`Archive not found in GCS at ${gcsUri}`);
    }

    // -----------------------------------------------------------------------
    // 4. CLI list
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
    // 5. CLI delete
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
    // 6. Verify delete in manifest
    // -----------------------------------------------------------------------
    const linesAfter = readFileSync(manifestFile, "utf-8")
      .trim()
      .split("\n");
    assert.equal(linesAfter.length, 2);
    const deletedRecord = JSON.parse(linesAfter[1]);
    assert.equal(deletedRecord.status, "deleted");
    assert(deletedRecord.deleted_at);
    console.log("  Manifest delete entry OK");

    // -----------------------------------------------------------------------
    // 7. Verify object gone from GCS
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

    console.log("\nPASS: gcs-roundtrip e2e test");
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
      // May already be cleaned up.
    }

    // Clean up temp dir.
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nFAIL: ${err.message}`);
  if (err.code === "ERR_ASSERTION") {
    console.error(err);
  }
  process.exit(1);
});
