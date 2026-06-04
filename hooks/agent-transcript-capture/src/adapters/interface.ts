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

/**
 * Model(s) used over the course of a session, derived from the transcript.
 *
 * The model can change partway through a session (the user switches models, or
 * the runtime falls back), and every switch is recorded in the transcript — so
 * the transcript, not a single hook-time guess, is the source of truth.
 */
export interface AgentModels {
  /**
   * Distinct models used across the whole session, in order of first
   * appearance. Empty when none could be inferred (present-but-empty for shape
   * stability, mirroring the `agent_version: null` convention).
   */
  models: string[];
  /**
   * The most-recent / current model at capture time (the last assistant
   * message's model), for convenience. `null` when none could be inferred.
   */
  current: string | null;
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
   * Best-effort list of model(s) used over the session, emitted in
   * `manifest.models` (and the convenience `manifest.model`). Derived from the
   * session transcript rather than a single hook-time guess, because the model
   * can change mid-session and each switch is recorded in the transcript.
   *
   * Where the model is recorded is runtime-specific (Claude Code stamps it on
   * every assistant message as `message.model`; other runtimes differ), which
   * is why this lives on the adapter alongside `agentVersion`. Takes the
   * already-collected bundle so it parses the in-memory transcript rather than
   * re-reading from disk. Returns an empty list / `null` current when nothing
   * can be inferred, so the manifest fields are present-but-empty.
   */
  agentModels(bundle: SessionBundle): AgentModels;

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
 * agent surface grows hook support, branch here on a new adapter class.
 *
 * Codex (and other non-Claude runtimes) — NOT auto-detected, by design:
 *   - This hook is wired into *Claude Code's* `Stop` event, so in normal use it
 *     only ever fires for Claude Code / Cowork sessions. Codex uses its own,
 *     unrelated notification mechanism and a different on-disk transcript
 *     format (where the model and version are recorded differs), so its
 *     transcripts do not flow through here unless someone deliberately wires
 *     this binary into a Codex-style runner.
 *   - To avoid *silently mislabeling* such a session as `claude_code`, the
 *     `AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME` env var (see `resolveAgentName`) is
 *     the supported escape hatch: set it to e.g. `codex` and the manifest
 *     `agent` field is tagged correctly. Note that `collectSession` and the
 *     model/version extraction below still assume Claude's JSONL layout, so a
 *     real Codex integration needs a dedicated `CodexAdapter` (TODO) that knows
 *     Codex's transcript shape. The model extractor is written defensively —
 *     it returns an empty list for any transcript it can't parse as Claude
 *     JSONL — so a mis-wired Codex transcript yields empty `models` rather than
 *     fabricated Claude model names.
 */
export function detectAgent(hookInput: HookInput): AgentAdapter {
  return new ClaudeAdapter(resolveAgentName(hookInput));
}
