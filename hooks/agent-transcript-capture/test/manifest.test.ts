import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  UploadRecord,
  manifestPath,
  appendRecord,
  readRecords,
  findBySessionId,
} from "../src/manifest";
import { resolveExtraMetadata } from "../src/capture";

let tmpDir: string;
const origEnv = process.env.AGENT_TRANSCRIPT_CAPTURE_HOME;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  process.env.AGENT_TRANSCRIPT_CAPTURE_HOME = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origEnv !== undefined) {
    process.env.AGENT_TRANSCRIPT_CAPTURE_HOME = origEnv;
  } else {
    delete process.env.AGENT_TRANSCRIPT_CAPTURE_HOME;
  }
});

function makeRecord(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    session_id: "aaaa-bbbb-cccc",
    timestamp: "2026-04-10T12:00:00.000Z",
    provider: "gcs",
    bucket: "bucket",
    object_key:
      "secret-do-not-share-deadbeef/alice/2026/04/10/aaaa-bbbb-cccc.tar.gz",
    object_uri:
      "gs://bucket/secret-do-not-share-deadbeef/alice/2026/04/10/aaaa-bbbb-cccc.tar.gz",
    agent: "claude_code",
    status: "uploaded",
    ...overrides,
  };
}

describe("manifestPath", () => {
  it("uses AGENT_TRANSCRIPT_CAPTURE_HOME when set", () => {
    expect(manifestPath()).toBe(path.join(tmpDir, "uploads.jsonl"));
  });

  it("falls back to ~/.agent-transcript-capture", () => {
    delete process.env.AGENT_TRANSCRIPT_CAPTURE_HOME;
    expect(manifestPath()).toBe(
      path.join(os.homedir(), ".agent-transcript-capture", "uploads.jsonl")
    );
  });
});

describe("appendRecord", () => {
  it("creates the directory and file if they don't exist", () => {
    const subDir = path.join(tmpDir, "nested");
    process.env.AGENT_TRANSCRIPT_CAPTURE_HOME = subDir;
    appendRecord(makeRecord());
    expect(fs.existsSync(path.join(subDir, "uploads.jsonl"))).toBe(true);
  });

  it("appends records as JSONL", () => {
    appendRecord(makeRecord({ session_id: "s1" }));
    appendRecord(makeRecord({ session_id: "s2" }));
    const lines = fs
      .readFileSync(manifestPath(), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).session_id).toBe("s1");
    expect(JSON.parse(lines[1]).session_id).toBe("s2");
  });
});

describe("readRecords", () => {
  it("returns empty array when file does not exist", () => {
    expect(readRecords()).toEqual([]);
  });

  it("parses records and sorts by timestamp desc", () => {
    appendRecord(
      makeRecord({ session_id: "old", timestamp: "2026-04-09T00:00:00Z" })
    );
    appendRecord(
      makeRecord({ session_id: "new", timestamp: "2026-04-10T00:00:00Z" })
    );
    const records = readRecords();
    expect(records).toHaveLength(2);
    expect(records[0].session_id).toBe("new");
    expect(records[1].session_id).toBe("old");
  });

  it("deduplicates by session_id (last entry wins)", () => {
    appendRecord(makeRecord({ session_id: "s1", status: "uploaded" }));
    appendRecord(makeRecord({ session_id: "s1", status: "deleted" }));
    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("deleted");
  });

  it("skips malformed lines", () => {
    fs.writeFileSync(
      manifestPath(),
      JSON.stringify(makeRecord({ session_id: "ok" })) + "\nnot json\n",
      "utf-8"
    );
    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].session_id).toBe("ok");
  });
});

describe("UploadRecord shape", () => {
  it("defaults the agent identifier to the MCP-client-specific value", () => {
    // Sanity check: the ledger record carries the per-client identifier the
    // Claude Code adapter now emits, not the old "claude" family name.
    appendRecord(makeRecord({ session_id: "agent-id-check" }));
    const found = findBySessionId("agent-id-check");
    expect(found!.agent).toBe("claude_code");
  });
});

describe("resolveExtraMetadata", () => {
  it("returns undefined when env var is unset", () => {
    expect(resolveExtraMetadata(undefined)).toBeUndefined();
  });

  it("returns undefined when env var is the empty string", () => {
    expect(resolveExtraMetadata("")).toBeUndefined();
  });

  it("parses valid JSON objects", () => {
    expect(resolveExtraMetadata('{"flags":["--no-color","-v"]}')).toEqual({
      flags: ["--no-color", "-v"],
    });
  });

  it("parses valid JSON scalars and arrays", () => {
    expect(resolveExtraMetadata("[1,2,3]")).toEqual([1, 2, 3]);
    expect(resolveExtraMetadata("42")).toBe(42);
    expect(resolveExtraMetadata("true")).toBe(true);
  });

  it("falls back to the raw string for invalid JSON", () => {
    expect(resolveExtraMetadata("--flags --enabled")).toBe(
      "--flags --enabled"
    );
    expect(resolveExtraMetadata("{not json")).toBe("{not json");
  });
});

describe("findBySessionId", () => {
  it("returns null when no match", () => {
    appendRecord(makeRecord({ session_id: "aaaa-bbbb" }));
    expect(findBySessionId("zzzz")).toBeNull();
  });

  it("finds by exact match", () => {
    appendRecord(makeRecord({ session_id: "aaaa-bbbb" }));
    const found = findBySessionId("aaaa-bbbb");
    expect(found).not.toBeNull();
    expect(found!.session_id).toBe("aaaa-bbbb");
  });

  it("finds by prefix match", () => {
    appendRecord(makeRecord({ session_id: "aaaa-bbbb-cccc-dddd" }));
    const found = findBySessionId("aaaa");
    expect(found).not.toBeNull();
    expect(found!.session_id).toBe("aaaa-bbbb-cccc-dddd");
  });

  it("throws on ambiguous prefix", () => {
    appendRecord(makeRecord({ session_id: "aaaa-1111" }));
    appendRecord(makeRecord({ session_id: "aaaa-2222" }));
    expect(() => findBySessionId("aaaa")).toThrow("Ambiguous");
  });
});
