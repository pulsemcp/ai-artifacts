import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ClaudeAdapter } from "../src/adapters/claude";
import { HookInput } from "../src/adapters/interface";

const tmpBase = path.join(os.tmpdir(), "trace-capture-test-" + process.pid);

function setup(files: Record<string, string>): string {
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const projectDir = path.join(tmpBase, ".claude", "projects", "test-project");

  // Create parent transcript
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(transcriptPath, files["transcript.jsonl"] ?? '{"type":"message"}\n');

  // Create session directory structure
  const sessionDir = path.join(projectDir, sessionId);

  for (const [filePath, content] of Object.entries(files)) {
    if (filePath === "transcript.jsonl") continue;
    const fullPath = path.join(sessionDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return transcriptPath;
}

beforeEach(() => {
  fs.mkdirSync(tmpBase, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  it("has name 'claude'", () => {
    expect(adapter.name).toBe("claude");
  });

  it("collects the parent transcript", async () => {
    const transcriptPath = setup({
      "transcript.jsonl": '{"type":"msg","content":"hello"}\n',
    });
    const input: HookInput = {
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      transcript_path: transcriptPath,
      cwd: "/tmp",
    };

    const bundle = await adapter.collectSession(input);
    expect(bundle.sessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    const transcript = bundle.files.find(
      (f) => f.archivePath === "transcript.jsonl"
    );
    expect(transcript).toBeDefined();
    expect(transcript!.redactable).toBe(true);
    expect(transcript!.content.toString()).toContain("hello");
  });

  it("collects subagent transcripts and metadata", async () => {
    const transcriptPath = setup({
      "transcript.jsonl": "{}",
      "subagents/agent-abc123.jsonl": '{"sub":"agent"}\n',
      "subagents/agent-abc123.meta.json": '{"type":"explore"}',
      "subagents/agent-def456.jsonl": '{"sub":"agent2"}\n',
    });
    const input: HookInput = {
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      transcript_path: transcriptPath,
      cwd: "/tmp",
    };

    const bundle = await adapter.collectSession(input);

    const subJsonl = bundle.files.filter((f) =>
      f.archivePath.startsWith("subagents/") && f.archivePath.endsWith(".jsonl")
    );
    expect(subJsonl).toHaveLength(2);
    expect(subJsonl.every((f) => f.redactable)).toBe(true);

    const meta = bundle.files.find((f) =>
      f.archivePath.endsWith(".meta.json")
    );
    expect(meta).toBeDefined();
    expect(meta!.redactable).toBe(false);
  });

  it("collects tool result files", async () => {
    const transcriptPath = setup({
      "transcript.jsonl": "{}",
      "tool-results/toolu_abc.txt": "command output here",
      "tool-results/toolu_def.txt": "another output",
    });
    const input: HookInput = {
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      transcript_path: transcriptPath,
      cwd: "/tmp",
    };

    const bundle = await adapter.collectSession(input);

    const toolResults = bundle.files.filter((f) =>
      f.archivePath.startsWith("tool-results/")
    );
    expect(toolResults).toHaveLength(2);
    expect(toolResults.every((f) => f.redactable)).toBe(true);
  });

  it("handles sessions with no subagents or tool results", async () => {
    const transcriptPath = setup({
      "transcript.jsonl": '{"only":"parent"}\n',
    });
    const input: HookInput = {
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      transcript_path: transcriptPath,
      cwd: "/tmp",
    };

    const bundle = await adapter.collectSession(input);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0].archivePath).toBe("transcript.jsonl");
  });

  it("throws when parent transcript does not exist", async () => {
    const input: HookInput = {
      session_id: "missing",
      transcript_path: path.join(tmpBase, "nonexistent.jsonl"),
      cwd: "/tmp",
    };

    await expect(adapter.collectSession(input)).rejects.toThrow(
      "Parent transcript not found"
    );
  });
});
