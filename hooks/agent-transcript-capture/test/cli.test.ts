import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { formatList, ListOptions, performDelete } from "../src/cli";
import { appendRecord, UploadRecord } from "../src/manifest";

let tmpDir: string;
const origEnv = process.env.TRACE_CAPTURE_HOME;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  process.env.TRACE_CAPTURE_HOME = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origEnv !== undefined) {
    process.env.TRACE_CAPTURE_HOME = origEnv;
  } else {
    delete process.env.TRACE_CAPTURE_HOME;
  }
});

function makeRecord(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    session_id: "aaaa-bbbb-cccc-dddd",
    timestamp: "2026-04-10T12:00:00.000Z",
    gcs_key: "traces/alice/2026/04/10/aaaa-bbbb-cccc-dddd.tar.gz",
    gcs_uri: "gs://bucket/traces/alice/2026/04/10/aaaa-bbbb-cccc-dddd.tar.gz",
    bucket: "bucket",
    agent: "claude-code",
    status: "uploaded",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatList
// ---------------------------------------------------------------------------

describe("formatList", () => {
  const defaultOpts: ListOptions = { all: false, count: 25 };

  it("shows 'No uploads found' when empty", () => {
    expect(formatList([], defaultOpts)).toBe("No uploads found.");
  });

  it("renders uploaded records", () => {
    const records = [makeRecord()];
    const output = formatList(records, defaultOpts);
    expect(output).toContain("aaaa-bbbb-ccc");
    expect(output).toContain("uploaded");
    expect(output).toContain("gs://bucket/");
  });

  it("hides deleted records by default", () => {
    const records = [
      makeRecord({ session_id: "s1", status: "uploaded" }),
      makeRecord({ session_id: "s2", status: "deleted" }),
    ];
    const output = formatList(records, defaultOpts);
    expect(output).toContain("s1");
    expect(output).not.toContain("s2");
  });

  it("shows deleted records with --all", () => {
    const records = [
      makeRecord({ session_id: "s1", status: "uploaded" }),
      makeRecord({ session_id: "s2", status: "deleted" }),
    ];
    const output = formatList(records, { all: true, count: 25 });
    expect(output).toContain("s1");
    expect(output).toContain("s2");
    expect(output).toContain("deleted");
  });

  it("limits output to count", () => {
    const records = [
      makeRecord({ session_id: "s1" }),
      makeRecord({ session_id: "s2" }),
      makeRecord({ session_id: "s3" }),
    ];
    const output = formatList(records, { all: false, count: 2 });
    expect(output).toContain("s1");
    expect(output).toContain("s2");
    expect(output).not.toContain("s3");
    expect(output).toContain("1 more");
  });
});

// ---------------------------------------------------------------------------
// performDelete
// ---------------------------------------------------------------------------

describe("performDelete", () => {
  it("returns error when no match", async () => {
    const backend = { delete: async () => ({ success: true }) };
    const result = await performDelete("nonexistent", backend);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No upload found");
  });

  it("returns error when already deleted", async () => {
    appendRecord(makeRecord({ session_id: "del-1", status: "deleted" }));
    const backend = { delete: async () => ({ success: true }) };
    const result = await performDelete("del-1", backend);
    expect(result.success).toBe(false);
    expect(result.message).toContain("already deleted");
  });

  it("deletes successfully and appends deleted record", async () => {
    appendRecord(makeRecord({ session_id: "to-delete" }));
    const backend = { delete: async () => ({ success: true }) };
    const result = await performDelete("to-delete", backend);
    expect(result.success).toBe(true);
    expect(result.message).toContain("Deleted session to-delete");

    // Verify manifest was updated.
    const { readRecords } = await import("../src/manifest");
    const records = readRecords();
    const record = records.find((r) => r.session_id === "to-delete");
    expect(record).toBeDefined();
    expect(record!.status).toBe("deleted");
    expect(record!.deleted_at).toBeDefined();
  });

  it("returns error when backend delete fails", async () => {
    appendRecord(makeRecord({ session_id: "fail-del" }));
    const backend = {
      delete: async () => ({
        success: false,
        error: "permission_denied",
        details: "403 Forbidden",
      }),
    };
    const result = await performDelete("fail-del", backend);
    expect(result.success).toBe(false);
    expect(result.message).toContain("permission_denied");
  });
});
