/**
 * Agent adapter interface.
 *
 * Each coding agent (Claude Code, Cursor, etc.) stores session transcripts
 * differently. Adapters encapsulate the agent-specific logic for discovering
 * and collecting all files that belong to a session.
 */

/** Hook payload received via stdin from Claude Code (or equivalent). */
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
  /**
   * Discover and collect all session files given the hook input.
   * Returns a bundle ready for redaction and archiving.
   */
  collectSession(hookInput: HookInput): Promise<SessionBundle>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAdapter(agent: string): AgentAdapter {
  switch (agent) {
    case "claude": {
      // Lazy require to avoid circular deps and keep the factory lightweight.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ClaudeAdapter } = require("./claude");
      return new ClaudeAdapter();
    }
    default:
      throw new Error(
        `Unknown agent adapter: "${agent}". Supported: claude`
      );
  }
}
