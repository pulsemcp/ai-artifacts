"use strict";
/**
 * Agent adapter interface.
 *
 * Each coding agent (Claude Code, Cursor, etc.) stores session transcripts
 * differently. Adapters encapsulate the agent-specific logic for discovering
 * and collecting all files that belong to a session.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAgent = detectAgent;
// ---------------------------------------------------------------------------
// Auto-detection + factory
// ---------------------------------------------------------------------------
const claude_1 = require("./claude");
/**
 * Detect the agent type from the hook input and environment.
 *
 * Current heuristics:
 * - transcript_path contains "/.claude/" → Claude Code
 * - CLAUDE_PROJECT_DIR env var is set   → Claude Code
 *
 * Falls back to Claude Code as the default (it's the only agent with a
 * hook system today).  When Cursor or other agents gain hook support,
 * add detection heuristics here.
 */
function detectAgent(hookInput) {
    // Claude Code: transcripts live under ~/.claude/projects/
    if (hookInput.transcript_path.includes("/.claude/") ||
        process.env.CLAUDE_PROJECT_DIR) {
        return new claude_1.ClaudeAdapter();
    }
    // Default: assume Claude Code for now.
    return new claude_1.ClaudeAdapter();
}
