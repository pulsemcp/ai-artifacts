/**
 * Claude Code agent adapter.
 *
 * Claude Code stores session data in a predictable filesystem layout:
 *
 *   ~/.claude/projects/{project}/
 *     {session-uuid}.jsonl                    # Parent transcript
 *     {session-uuid}/
 *       subagents/
 *         agent-{id}.jsonl                    # Subagent transcripts
 *         agent-{id}.meta.json               # Subagent metadata (type, description)
 *       tool-results/
 *         toolu_{id}.txt                      # Externalized large tool outputs (>~20KB)
 *
 * Claude Cowork (the same binary inside the desktop app's VM) reuses this exact
 * inner layout, just rooted under the app's Application Support sandbox instead
 * of `~/.claude/`. Since everything here is derived relative to the incoming
 * `transcript_path`, this adapter serves both — see the `ClaudeAdapter`
 * constructor doc for the full path comparison.
 *
 * All Claude-specific knowledge lives in this file.
 */

import * as fs from "fs";
import * as path from "path";
import {
  AgentAdapter,
  AgentModels,
  HookInput,
  SessionBundle,
  SessionFile,
  UploadSuccessNotice,
} from "./interface";

/**
 * Pseudo-model markers Claude Code stamps onto synthetic assistant turns
 * (e.g. local-only "API error" placeholders and other client-generated
 * messages). They show up in `message.model` but are not real models, so they
 * must never pollute the manifest's model list.
 */
const NON_MODEL_MARKERS = new Set(["<synthetic>"]);

/**
 * Parse a Claude Code transcript (JSONL) and return the distinct models used,
 * in order of first appearance, plus the current (last) model.
 *
 * Claude Code records the model on every assistant message at
 * `message.model`. Because that's emitted per-message, a mid-session model
 * switch (user changes model, or a fallback kicks in) is captured as a second
 * entry in the list — the transcript is the source of truth, not a single
 * hook-time guess.
 *
 * Defensive by design: any line that isn't valid JSON, or that carries no
 * usable `message.model`, is skipped. A transcript that isn't Claude JSONL at
 * all therefore yields `{ models: [], current: null }` rather than throwing or
 * inventing model names — which is what keeps a mis-wired non-Claude transcript
 * from being labeled with fabricated Claude models.
 */
export function extractClaudeModels(transcriptText: string): AgentModels {
  const models: string[] = [];
  const seen = new Set<string>();
  let current: string | null = null;

  for (const line of transcriptText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const model = (obj as { message?: { model?: unknown } })?.message?.model;
    if (typeof model !== "string" || model.length === 0) continue;
    if (NON_MODEL_MARKERS.has(model)) continue;

    current = model;
    if (!seen.has(model)) {
      seen.add(model);
      models.push(model);
    }
  }

  return { models, current };
}

/** Glob-like helper: list files in a directory matching a test function. */
function listFiles(
  dir: string,
  test: (name: string) => boolean
): string[] {
  if (!fs.existsSync(dir)) return [];

  try {
    return fs
      .readdirSync(dir)
      .filter((name) => {
        const full = path.join(dir, name);
        return fs.statSync(full).isFile() && test(name);
      })
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name: string;

  /**
   * Both Claude Code (CLI on the host) and Claude Cowork (the same CLI binary
   * inside the desktop app's VM sandbox) emit the same transcript format and
   * the same companion layout *within* a project dir (`{session}.jsonl` beside
   * a `{session}/subagents/` + `tool-results/` tree). The ROOT differs, though:
   *   - Claude Code:  ~/.claude/projects/{project}/...
   *   - Claude Cowork: ~/Library/Application Support/Claude/
   *                      local-agent-mode-sessions/<s1>/<s2>/local_<s3>/
   *                      .claude/projects/{project}/...
   * `collectSession` derives everything relative to the incoming
   * `transcript_path`, so the differing root doesn't matter — one adapter
   * handles both surfaces and we just vary the `name` that lands in the
   * manifest. The `local-agent-mode-sessions/` segment is exactly what
   * `detectAgent` keys off to tell the two apart; see `./interface.ts`.
   */
  constructor(name: string = "claude_code") {
    this.name = name;
  }

  /**
   * Resolve the Claude Code CLI version, in order:
   *   1. Stop-hook payload `version` field (most accurate when present)
   *   2. `CLAUDE_CODE_VERSION` env var (set by some Claude Code releases)
   *   3. `null` (don't shell out — hooks must be fast and side-effect-free)
   *
   * Same source for Cowork: it runs the same Claude Code binary, and the
   * sample transcript events in a Cowork session carry the same `version`
   * field (e.g., "2.1.138") that Claude Code emits in 2.1+.
   */
  agentVersion(hookInput: HookInput): string | null {
    if (typeof hookInput.version === "string" && hookInput.version.length > 0) {
      return hookInput.version;
    }
    const envVersion = process.env.CLAUDE_CODE_VERSION;
    if (typeof envVersion === "string" && envVersion.length > 0) {
      return envVersion;
    }
    return null;
  }

  /**
   * Distinct models used over the session, parsed from the already-collected
   * parent transcript (`transcript.jsonl`). Reads the in-memory bundle rather
   * than re-reading from disk. Returns `{ models: [], current: null }` when the
   * parent transcript is absent or carries no recognizable model — see
   * `extractClaudeModels` for the per-line parsing rules.
   */
  agentModels(bundle: SessionBundle): AgentModels {
    const transcript = bundle.files.find(
      (f) => f.archivePath === "transcript.jsonl"
    );
    if (!transcript) return { models: [], current: null };
    return extractClaudeModels(transcript.content.toString("utf-8"));
  }

  async collectSession(hookInput: HookInput): Promise<SessionBundle> {
    const transcriptPath = hookInput.transcript_path;
    const sessionId = hookInput.session_id;

    const files: SessionFile[] = [];

    // -----------------------------------------------------------------------
    // 1. Parent transcript
    // -----------------------------------------------------------------------
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(
        `Parent transcript not found: ${transcriptPath}`
      );
    }
    files.push({
      archivePath: "transcript.jsonl",
      content: fs.readFileSync(transcriptPath),
      redactable: true,
    });

    // -----------------------------------------------------------------------
    // 2. Session directory (strip .jsonl to get the companion dir)
    // -----------------------------------------------------------------------
    const sessionDir = transcriptPath.replace(/\.jsonl$/, "");

    // -----------------------------------------------------------------------
    // 3. Subagent transcripts + metadata
    // -----------------------------------------------------------------------
    const subagentsDir = path.join(sessionDir, "subagents");

    for (const filePath of listFiles(subagentsDir, (n) =>
      n.endsWith(".jsonl")
    )) {
      files.push({
        archivePath: `subagents/${path.basename(filePath)}`,
        content: fs.readFileSync(filePath),
        redactable: true,
      });
    }

    for (const filePath of listFiles(subagentsDir, (n) =>
      n.endsWith(".meta.json")
    )) {
      files.push({
        archivePath: `subagents/${path.basename(filePath)}`,
        content: fs.readFileSync(filePath),
        redactable: false, // metadata only contains agent type + description
      });
    }

    // -----------------------------------------------------------------------
    // 4. Externalized tool results
    // -----------------------------------------------------------------------
    const toolResultsDir = path.join(sessionDir, "tool-results");

    for (const filePath of listFiles(toolResultsDir, (n) =>
      n.endsWith(".txt")
    )) {
      files.push({
        archivePath: `tool-results/${path.basename(filePath)}`,
        content: fs.readFileSync(filePath),
        redactable: true,
      });
    }

    return { sessionId, files };
  }

  /**
   * Format the upload-success notice as a Claude Code Stop-hook JSON envelope
   * with a `systemMessage` field. Plain stdout from a Stop hook is buried in
   * transcript view (Ctrl-R); the JSON envelope is the documented way to make
   * a Stop hook surface a line inline in the chat the human sees during
   * normal scrolling. (Whether the model also reads `systemMessage` into its
   * next-turn context depends on the Claude Code version — Stop hooks do not
   * support the `additionalContext` field that explicitly injects context,
   * so we rely on `systemMessage` being part of the chat transcript.)
   *
   * The `systemMessage` body shows both the `list` and `delete` commands, with
   * a short session-id prefix already filled into `delete` so the agent can
   * run it immediately when the user follows up with "delete that transcript".
   */
  formatUploadSuccess(notice: UploadSuccessNotice): string {
    const shortId =
      notice.sessionId.length > 8
        ? notice.sessionId.slice(0, 8)
        : notice.sessionId;
    const systemMessage =
      `Uploaded session ${shortId} → ${notice.objectUrl}\n` +
      `  List uploads:  node ${notice.cliPath} list\n` +
      `  Delete this:   node ${notice.cliPath} delete ${shortId}`;
    return JSON.stringify({ systemMessage }) + "\n";
  }
}
