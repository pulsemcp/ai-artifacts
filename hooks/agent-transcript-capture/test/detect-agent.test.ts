import { describe, it, expect, afterEach } from "vitest";
import {
  AGENT_NAME_ENV_VAR,
  detectAgent,
  HookInput,
  resolveAgentName,
} from "../src/adapters/interface";

describe("detectAgent", () => {
  afterEach(() => {
    delete process.env[AGENT_NAME_ENV_VAR];
  });

  it("tags Claude Code's typical ~/.claude/projects/ path as claude_code", () => {
    const input: HookInput = {
      session_id: "abc",
      transcript_path: "/home/user/.claude/projects/test/abc.jsonl",
      cwd: "/tmp",
    };
    const adapter = detectAgent(input);
    expect(adapter.name).toBe("claude_code");
  });

  it("defaults to claude_code when no Cowork signal is present", () => {
    // Anything that's not a Cowork path lands on the default — including
    // arbitrary paths and the explicit `~/.claude/projects/` case above.
    const input: HookInput = {
      session_id: "abc",
      transcript_path: "/random/path/abc.jsonl",
      cwd: "/tmp",
    };
    const adapter = detectAgent(input);
    expect(adapter.name).toBe("claude_code");
  });

  it("detects Claude Cowork from /local-agent-mode-sessions/ in the transcript path", () => {
    const input: HookInput = {
      session_id: "abc",
      transcript_path:
        "/Users/alice/Library/Application Support/Claude/local-agent-mode-sessions/s1/s2/local_s3/.claude/projects/-Users-alice-code/abc.jsonl",
      cwd: "/Users/alice/code",
    };
    const adapter = detectAgent(input);
    expect(adapter.name).toBe("claude_cowork");
  });

  it("Cowork path heuristic wins over the more general /.claude/ heuristic", () => {
    // The Cowork path contains BOTH `/local-agent-mode-sessions/` AND
    // `/.claude/projects/`. The Cowork-specific check has to be ordered first
    // or we'd misclassify Cowork sessions as Claude Code.
    const input: HookInput = {
      session_id: "abc",
      transcript_path:
        "/some/local-agent-mode-sessions/foo/.claude/projects/bar/abc.jsonl",
      cwd: "/tmp",
    };
    expect(resolveAgentName(input)).toBe("claude_cowork");
  });

  describe("AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME env var override", () => {
    it("wins over the path heuristic", () => {
      process.env[AGENT_NAME_ENV_VAR] = "custom-agent";
      const input: HookInput = {
        session_id: "abc",
        transcript_path: "/home/user/.claude/projects/test/abc.jsonl",
        cwd: "/tmp",
      };
      expect(detectAgent(input).name).toBe("custom-agent");
    });

    it("is ignored when set to empty string (falls through to path heuristic)", () => {
      process.env[AGENT_NAME_ENV_VAR] = "";
      const input: HookInput = {
        session_id: "abc",
        transcript_path:
          "/Users/alice/Library/Application Support/Claude/local-agent-mode-sessions/x/.claude/projects/y/abc.jsonl",
        cwd: "/tmp",
      };
      expect(detectAgent(input).name).toBe("claude_cowork");
    });
  });
});
