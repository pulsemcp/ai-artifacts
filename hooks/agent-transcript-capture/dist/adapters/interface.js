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
 *   2. Cowork path heuristic: transcripts under macOS Application Support's
 *      `local-agent-mode-sessions/` are Cowork (Claude Code running inside
 *      the desktop app's VM sandbox — same JSONL format, different home dir)
 *   3. Default to `claude_code` (covers the `~/.claude/projects/` host CLI
 *      case and anything else we don't recognize — Claude Code is the only
 *      surface we ship for today)
 */
function resolveAgentName(hookInput) {
    const envName = process.env[exports.AGENT_NAME_ENV_VAR];
    if (typeof envName === "string" && envName.length > 0) {
        return envName;
    }
    // The Cowork giveaway: macOS path
    // `~/Library/Application Support/Claude/local-agent-mode-sessions/...`.
    // Both Cowork and Claude Code paths contain `/.claude/projects/`, so we
    // only need to special-case the Cowork-specific segment.
    if (hookInput.transcript_path.includes("/local-agent-mode-sessions/")) {
        return "claude_cowork";
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
