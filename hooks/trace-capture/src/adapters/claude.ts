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
 * All Claude-specific knowledge lives in this file.
 */

import * as fs from "fs";
import * as path from "path";
import {
  AgentAdapter,
  HookInput,
  SessionBundle,
  SessionFile,
} from "./interface";

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
  readonly name = "claude";

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
}
