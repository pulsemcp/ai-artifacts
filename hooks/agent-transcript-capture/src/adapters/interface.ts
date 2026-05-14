/**
 * Agent adapter interface.
 *
 * Each coding agent (Claude Code, Cursor, etc.) stores session transcripts
 * differently. Adapters encapsulate the agent-specific logic for discovering
 * and collecting all files that belong to a session.
 */

/** Hook payload received via stdin. */
export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name?: string;
}

/** A single file to include in the session archive. */
export interface SessionFile {
  /** Path within the archive (e.g., "subagents/agent-a8c713c.jsonl"). */
  archivePath: string;
  /** Raw file content. */
  content: Buffer;
  /** Whether this file's content should be run through the redactor. */
  redactable: boolean;
}

/** All files collected for a single session. */
export interface SessionBundle {
  sessionId: string;
  files: SessionFile[];
}

/** Adapter for a specific coding agent's transcript format. */
export interface AgentAdapter {
  /** Human-readable name for manifests and logs. */
  readonly name: string;

  /**
   * Discover and collect all session files given the hook input.
   * Returns a bundle ready for redaction and archiving.
   */
  collectSession(hookInput: HookInput): Promise<SessionBundle>;
}

// ---------------------------------------------------------------------------
// Auto-detection + factory
// ---------------------------------------------------------------------------

import { ClaudeAdapter } from "./claude";

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
export function detectAgent(hookInput: HookInput): AgentAdapter {
  // Claude Code: transcripts live under ~/.claude/projects/
  if (
    hookInput.transcript_path.includes("/.claude/") ||
    process.env.CLAUDE_PROJECT_DIR
  ) {
    return new ClaudeAdapter();
  }

  // Default: assume Claude Code for now.
  return new ClaudeAdapter();
}
