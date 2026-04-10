import { describe, it, expect, afterEach, vi } from "vitest";
import { detectAgent, HookInput } from "../src/adapters/interface";

describe("detectAgent", () => {
  afterEach(() => {
    delete process.env.CLAUDE_PROJECT_DIR;
  });

  it("detects Claude Code from transcript path containing /.claude/", () => {
    const input: HookInput = {
      session_id: "abc",
      transcript_path: "/home/user/.claude/projects/test/abc.jsonl",
      cwd: "/tmp",
    };
    const adapter = detectAgent(input);
    expect(adapter.name).toBe("claude");
  });

  it("detects Claude Code from CLAUDE_PROJECT_DIR env var", () => {
    process.env.CLAUDE_PROJECT_DIR = "/some/path";
    const input: HookInput = {
      session_id: "abc",
      transcript_path: "/some/other/path/abc.jsonl",
      cwd: "/tmp",
    };
    const adapter = detectAgent(input);
    expect(adapter.name).toBe("claude");
  });

  it("defaults to Claude Code when no heuristic matches", () => {
    const input: HookInput = {
      session_id: "abc",
      transcript_path: "/random/path/abc.jsonl",
      cwd: "/tmp",
    };
    const adapter = detectAgent(input);
    expect(adapter.name).toBe("claude");
  });
});
