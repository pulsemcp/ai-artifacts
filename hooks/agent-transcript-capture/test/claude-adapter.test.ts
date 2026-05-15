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

  describe("formatUploadSuccess", () => {
    const cliPath = "/abs/path/to/dist/cli.js";

    it("returns a single line of valid JSON terminated with a newline", () => {
      const output = adapter.formatUploadSuccess({
        sessionId: "578d166c-aaaa-bbbb-cccc-dddddddddddd",
        objectUrl: "gs://bucket/2026/05/15/578d166c.tar.gz",
        cliPath,
      });
      expect(output.endsWith("\n")).toBe(true);
      // Should be a single line of JSON — no embedded newlines outside the
      // string value, since Claude Code requires "stdout must contain only
      // the JSON object".
      const trimmed = output.trimEnd();
      expect(trimmed.split("\n")).toHaveLength(1);
      // Parses cleanly.
      expect(() => JSON.parse(trimmed)).not.toThrow();
    });

    it("emits the JSON envelope Claude Code surfaces inline (systemMessage)", () => {
      const output = adapter.formatUploadSuccess({
        sessionId: "578d166c-aaaa-bbbb-cccc-dddddddddddd",
        objectUrl: "gs://bucket/2026/05/15/578d166c.tar.gz",
        cliPath,
      });
      const parsed = JSON.parse(output);
      // The envelope MUST carry a systemMessage with the upload details. It
      // MAY carry other documented universal fields in the future (continue,
      // suppressOutput, etc.) — don't lock the exact key set.
      expect(typeof parsed.systemMessage).toBe("string");
      expect(parsed.systemMessage.length).toBeGreaterThan(0);
    });

    it("includes both the list AND delete commands with the session id pre-filled", () => {
      const output = adapter.formatUploadSuccess({
        sessionId: "578d166c-aaaa-bbbb-cccc-dddddddddddd",
        objectUrl: "gs://bucket/2026/05/15/578d166c.tar.gz",
        cliPath,
      });
      const msg = (JSON.parse(output) as { systemMessage: string })
        .systemMessage;

      expect(msg).toContain(`node ${cliPath} list`);
      expect(msg).toContain(`node ${cliPath} delete 578d166c`);
      expect(msg).toContain("578d166c");
      expect(msg).toContain("gs://bucket/2026/05/15/578d166c.tar.gz");
    });

    it("shortens long session ids to an 8-char prefix in the delete command", () => {
      const fullId = "578d166c-aaaa-bbbb-cccc-dddddddddddd";
      const output = adapter.formatUploadSuccess({
        sessionId: fullId,
        objectUrl: "gs://bucket/x.tar.gz",
        cliPath,
      });
      const msg = (JSON.parse(output) as { systemMessage: string })
        .systemMessage;

      expect(msg).toContain("delete 578d166c");
      // The full id should NOT appear unshortened in the delete command line.
      expect(msg).not.toContain(`delete ${fullId}`);
    });

    it("passes short session ids through unchanged", () => {
      const output = adapter.formatUploadSuccess({
        sessionId: "abc123",
        objectUrl: "gs://bucket/x.tar.gz",
        cliPath,
      });
      const msg = (JSON.parse(output) as { systemMessage: string })
        .systemMessage;
      expect(msg).toContain("delete abc123");
    });
  });
});
