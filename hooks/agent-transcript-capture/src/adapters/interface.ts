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
  /**
   * Claude Code began including the CLI version in Stop-hook payloads in
   * recent releases. Field is optional — older versions don't send it, and
   * other agents that one day grow hook support won't have it either.
   */
  version?: string;
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

/** Information the upload step hands back to the adapter for user-facing surfacing. */
export interface UploadSuccessNotice {
  sessionId: string;
  /** Provider-canonical URI of the uploaded archive (gs://... / s3://...). */
  objectUrl: string;
  /** Absolute path to the CLI script (for the list / delete commands). */
  cliPath: string;
}

/** Adapter for a specific coding agent's transcript format. */
export interface AgentAdapter {
  /**
   * MCP-client-specific identifier emitted in `manifest.agent` (e.g.,
   * `"claude_code"`, `"claude_cowork"`). Don't use the model family — this
   * field tells downstream consumers which client produced the transcript.
   */
  readonly name: string;

  /**
   * Discover and collect all session files given the hook input.
   * Returns a bundle ready for redaction and archiving.
   */
  collectSession(hookInput: HookInput): Promise<SessionBundle>;

  /**
   * Best-effort agent CLI version emitted in `manifest.agent_version`.
   * Returns `null` when no reliable source is available — the manifest field
   * is present-but-null rather than omitted, so consumers can rely on its
   * shape across uploads.
   */
  agentVersion(hookInput: HookInput): string | null;

  /**
   * Format a successful-upload notice for this harness in whatever shape will
   * surface inline to the user. The returned string is what `capture.ts`
   * writes verbatim to stdout.
   */
  formatUploadSuccess(notice: UploadSuccessNotice): string;
}

// ---------------------------------------------------------------------------
// Auto-detection + factory
// ---------------------------------------------------------------------------

import { ClaudeAdapter } from "./claude";

export const AGENT_NAME_ENV_VAR = "AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME";

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
export function resolveAgentName(hookInput: HookInput): string {
  const envName = process.env[AGENT_NAME_ENV_VAR];
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
export function detectAgent(hookInput: HookInput): AgentAdapter {
  return new ClaudeAdapter(resolveAgentName(hookInput));
}
