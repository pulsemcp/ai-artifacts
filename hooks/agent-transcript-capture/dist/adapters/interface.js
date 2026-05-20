"use strict";
/**
 * Agent adapter interface.
 *
 * Each coding agent (Claude Code, Cursor, etc.) stores session transcripts
 * differently. Adapters encapsulate the agent-specific logic for discovering
 * and collecting all files that belong to a session.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_NAME_ENV_VAR = void 0;
exports.resolveAgentName = resolveAgentName;
exports.detectAgent = detectAgent;
// ---------------------------------------------------------------------------
// Auto-detection + factory
// ---------------------------------------------------------------------------
const claude_1 = require("./claude");
exports.AGENT_NAME_ENV_VAR = "AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME";
/**
 * Resolve the manifest `agent` identifier from the available signals, in
 * priority order. Exposed for testing; production callers should use
 * `detectAgent` below.
 *
 * Resolution order:
 *   1. `AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME` env var — runtime escape hatch
 *   2. Path heuristic: transcripts under macOS Application Support's
 *      `local-agent-mode-sessions/` are Cowork (Claude Code running inside
 *      the desktop app's VM sandbox — same JSONL format, different home dir)
 *   3. Path heuristic: transcripts under `~/.claude/projects/` are Claude
 *      Code (the CLI on the host)
 *   4. Default to `claude_code`
 */
function resolveAgentName(hookInput) {
    const envName = process.env[exports.AGENT_NAME_ENV_VAR];
    if (typeof envName === "string" && envName.length > 0) {
        return envName;
    }
    // The Cowork giveaway: macOS path
    // `~/Library/Application Support/Claude/local-agent-mode-sessions/...`.
    // Both Cowork and Claude Code paths contain `/.claude/projects/`, so we
    // have to check the Cowork-specific segment FIRST.
    if (hookInput.transcript_path.includes("/local-agent-mode-sessions/")) {
        return "claude_cowork";
    }
    if (hookInput.transcript_path.includes("/.claude/") ||
        process.env.CLAUDE_PROJECT_DIR) {
        return "claude_code";
    }
    return "claude_code";
}
/**
 * Detect the agent adapter from the hook input.
 *
 * Today both Claude Code (host CLI) and Claude Cowork (same CLI inside the
 * desktop app's VM) write the same JSONL layout, so they share `ClaudeAdapter`
 * — the only difference is the `name` it reports. When a genuinely different
 * agent surface (Cursor, etc.) grows hook support, branch here on a new
 * adapter class.
 */
function detectAgent(hookInput) {
    return new claude_1.ClaudeAdapter(resolveAgentName(hookInput));
}
