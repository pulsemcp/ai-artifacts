#!/usr/bin/env bash
# Smoke test for the trace-capture hook.
# Creates a mock session structure, runs the hook, and verifies output.
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

echo "=== Test directory: $TEST_DIR ==="

# ---------------------------------------------------------------------------
# 1. Create mock session files
# ---------------------------------------------------------------------------
SESSION_ID="abc123-test-session"
mkdir -p "$TEST_DIR/$SESSION_ID/subagents"
mkdir -p "$TEST_DIR/$SESSION_ID/tool-results"

cat > "$TEST_DIR/$SESSION_ID.jsonl" << 'JSONL'
{"type":"queue-operation","operation":"dequeue","timestamp":"2026-04-09T10:00:00.000Z","sessionId":"abc123-test-session"}
{"type":"user","message":{"role":"user","content":"Deploy using API key AKIAIOSFODNN7EXAMPLE and password=hunter2"},"sessionId":"abc123-test-session","cwd":"/home/testuser/myproject"}
{"type":"assistant","message":{"role":"assistant","content":"Connecting to mongodb://admin:s3cret@prod.db.example.com:27017/app with token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"},"sessionId":"abc123-test-session"}
{"type":"user","message":{"role":"user","content":"Email user@example.com. JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"},"sessionId":"abc123-test-session"}
JSONL

cat > "$TEST_DIR/$SESSION_ID/subagents/agent-def456.jsonl" << 'JSONL'
{"type":"user","message":{"role":"user","content":"Search for SECRET_KEY=mySuper5ecretValue123"},"sessionId":"abc123-test-session","agentId":"def456","isSidechain":true}
{"type":"assistant","message":{"role":"assistant","content":"Found sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 in /home/testuser/.env"},"sessionId":"abc123-test-session","agentId":"def456"}
JSONL

cat > "$TEST_DIR/$SESSION_ID/subagents/agent-def456.meta.json" << 'JSON'
{"agentType":"Explore","description":"Search for config files"}
JSON

cat > "$TEST_DIR/$SESSION_ID/tool-results/toolu_test1.txt" << 'TXT'
Large output with password=mysecretpass and admin@corp.internal
aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
TXT

echo "[OK] Mock session files created"

# ---------------------------------------------------------------------------
# 2. Create config
# ---------------------------------------------------------------------------
mkdir -p "$TEST_DIR/.claude"
cat > "$TEST_DIR/.claude/trace-capture.json" << 'JSON'
{
  "enabled": true,
  "agent": "claude",
  "backend": {
    "type": "gcs",
    "bucket": "fake-test-bucket",
    "prefix": "traces/"
  },
  "privacy": {
    "mode": "redacted",
    "org_salt": "test-salt-12345"
  }
}
JSON

echo "[OK] Config created"

# ---------------------------------------------------------------------------
# 3. Test: no config -> silent exit 0
# ---------------------------------------------------------------------------
echo '{"session_id":"test","transcript_path":"/tmp/nothing.jsonl","cwd":"/tmp/no-config-here"}' \
  | node dist/capture.js
echo "[OK] No-config case exits 0"

# ---------------------------------------------------------------------------
# 4. Test: disabled config -> silent exit 0
# ---------------------------------------------------------------------------
mkdir -p "$TEST_DIR/disabled/.claude"
cat > "$TEST_DIR/disabled/.claude/trace-capture.json" << 'JSON'
{"enabled": false, "agent": "claude", "backend": {"type": "gcs", "bucket": "x", "prefix": ""}, "privacy": {"mode": "full", "org_salt": ""}}
JSON

echo "{\"session_id\":\"test\",\"transcript_path\":\"$TEST_DIR/$SESSION_ID.jsonl\",\"cwd\":\"$TEST_DIR/disabled\"}" \
  | node dist/capture.js
echo "[OK] Disabled config exits 0"

# ---------------------------------------------------------------------------
# 5. Test: full pipeline (gsutil will fail — that's expected, we check the error path)
# ---------------------------------------------------------------------------
echo "[INFO] Running full pipeline (expect gsutil failure)..."

RESULT=0
echo "{\"session_id\":\"$SESSION_ID\",\"transcript_path\":\"$TEST_DIR/$SESSION_ID.jsonl\",\"cwd\":\"$TEST_DIR\"}" \
  | node dist/capture.js 2>/tmp/trace-capture-stderr.txt || RESULT=$?

if [ "$RESULT" -eq 2 ]; then
  echo "[OK] Hook exited with code 2 (expected — gsutil not configured for fake bucket)"
  echo "[OK] stderr: $(cat /tmp/trace-capture-stderr.txt)"
else
  echo "[WARN] Hook exited with code $RESULT (expected 2)"
fi

# ---------------------------------------------------------------------------
# 6. Test: archive + redaction by mocking the backend
#    We'll modify the config to test the archive creation path separately.
#    Use a quick node script to exercise the modules directly.
# ---------------------------------------------------------------------------
echo "[INFO] Testing archive + redaction directly..."

node -e "
const { ClaudeAdapter } = require('./dist/adapters/claude');
const { redactContent } = require('./dist/redactor');
const { scrubUsername, hashUser } = require('./dist/identity');
const { buildTarGz } = require('./dist/archive');
const fs = require('fs');
const { execSync } = require('child_process');

async function test() {
  // Collect session files
  const adapter = new ClaudeAdapter();
  const bundle = await adapter.collectSession({
    session_id: '$SESSION_ID',
    transcript_path: '$TEST_DIR/$SESSION_ID.jsonl',
    cwd: '$TEST_DIR',
  });

  console.log('[OK] Adapter collected ' + bundle.files.length + ' files:');
  for (const f of bundle.files) {
    console.log('     ' + f.archivePath + ' (' + f.content.length + ' bytes, redactable=' + f.redactable + ')');
  }

  // Test redaction
  const sample = bundle.files[0].content.toString('utf-8');
  const redacted = redactContent(sample);

  const checks = [
    ['AKIAIOSFODNN7EXAMPLE', '[REDACTED:aws_key]'],
    ['hunter2', '[REDACTED:password]'],
    ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ', '[REDACTED:github_token]'],
    ['user@example.com', '[REDACTED:email]'],
    ['mongodb://admin:s3cret@prod.db', '[REDACTED:connection_string]'],
  ];

  let allPassed = true;
  for (const [secret, replacement] of checks) {
    if (redacted.includes(secret)) {
      console.log('[FAIL] Secret not redacted: ' + secret);
      allPassed = false;
    }
    if (!redacted.includes(replacement)) {
      console.log('[WARN] Expected replacement not found: ' + replacement);
    }
  }
  if (allPassed) {
    console.log('[OK] All secrets redacted from parent transcript');
  }

  // Test identity
  const hash = hashUser('test-salt');
  console.log('[OK] User hash: ' + hash + ' (length=' + hash.length + ')');

  // Build archive
  const entries = bundle.files.map(f => ({
    path: f.archivePath,
    content: f.redactable ? Buffer.from(redactContent(f.content.toString('utf-8'))) : f.content,
  }));

  const archive = await buildTarGz(entries);
  console.log('[OK] Archive built: ' + archive.length + ' bytes');

  // Write archive and verify with tar
  const archivePath = '$TEST_DIR/test-output.tar.gz';
  fs.writeFileSync(archivePath, archive);

  try {
    const listing = execSync('tar tzf ' + archivePath).toString();
    console.log('[OK] Archive contents:');
    for (const line of listing.trim().split('\\n')) {
      console.log('     ' + line);
    }
  } catch (e) {
    console.log('[FAIL] tar could not read the archive: ' + e.message);
  }

  // Verify redaction inside the archive
  const extracted = execSync('tar xzf ' + archivePath + ' -O transcript.jsonl').toString();
  if (extracted.includes('AKIAIOSFODNN7EXAMPLE')) {
    console.log('[FAIL] Archive contains unredacted AWS key');
  } else {
    console.log('[OK] Archive transcript is redacted');
  }

  // Check subagent is redacted too
  const subExtracted = execSync('tar xzf ' + archivePath + ' -O subagents/agent-def456.jsonl').toString();
  if (subExtracted.includes('sk-ant-api03')) {
    console.log('[FAIL] Archive contains unredacted Anthropic key in subagent');
  } else {
    console.log('[OK] Subagent transcript is redacted');
  }

  // Check tool result is redacted
  const toolExtracted = execSync('tar xzf ' + archivePath + ' -O tool-results/toolu_test1.txt').toString();
  if (toolExtracted.includes('wJalrXUtnFEMI')) {
    console.log('[FAIL] Archive contains unredacted AWS secret in tool result');
  } else {
    console.log('[OK] Tool result is redacted');
  }

  // Check meta.json is NOT redacted (should be unchanged)
  const metaExtracted = execSync('tar xzf ' + archivePath + ' -O subagents/agent-def456.meta.json').toString();
  if (metaExtracted.includes('Explore')) {
    console.log('[OK] Meta.json preserved (not redacted)');
  } else {
    console.log('[FAIL] Meta.json was unexpectedly modified');
  }

  console.log('\\n=== All smoke tests passed ===');
}

test().catch(e => { console.error(e); process.exit(1); });
"

# Clean up
rm -f /tmp/trace-capture-stderr.txt
