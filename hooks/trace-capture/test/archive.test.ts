import { describe, it, expect } from "vitest";
import * as zlib from "zlib";
import { buildTarGz, ArchiveEntry } from "../src/archive";

describe("buildTarGz", () => {
  it("produces a valid gzip buffer", async () => {
    const entries: ArchiveEntry[] = [
      { path: "hello.txt", content: Buffer.from("hello world") },
    ];
    const result = await buildTarGz(entries);
    // gzip magic number: 0x1f 0x8b
    expect(result[0]).toBe(0x1f);
    expect(result[1]).toBe(0x8b);
  });

  it("decompresses to valid tar with correct file content", async () => {
    const content = "test file content here";
    const entries: ArchiveEntry[] = [
      { path: "test.txt", content: Buffer.from(content) },
    ];
    const gzipped = await buildTarGz(entries);

    const tar = zlib.gunzipSync(gzipped);

    // First 100 bytes of tar header is the filename (null-terminated)
    const filename = tar.slice(0, 100).toString("utf-8").replace(/\0+$/, "");
    expect(filename).toBe("test.txt");

    // File content starts at offset 512 (after the 512-byte header)
    const fileContent = tar.slice(512, 512 + content.length).toString("utf-8");
    expect(fileContent).toBe(content);
  });

  it("handles multiple entries", async () => {
    const entries: ArchiveEntry[] = [
      { path: "a.txt", content: Buffer.from("aaa") },
      { path: "b.txt", content: Buffer.from("bbb") },
    ];
    const gzipped = await buildTarGz(entries);
    const tar = zlib.gunzipSync(gzipped);

    // First file at offset 0
    const name1 = tar.slice(0, 100).toString("utf-8").replace(/\0+$/, "");
    expect(name1).toBe("a.txt");

    // Second file: 512 (header) + 512 (content padded to 512) = 1024
    const name2 = tar.slice(1024, 1124).toString("utf-8").replace(/\0+$/, "");
    expect(name2).toBe("b.txt");
  });

  it("handles empty entries list", async () => {
    const gzipped = await buildTarGz([]);
    const tar = zlib.gunzipSync(gzipped);
    // Should contain just the two 512-byte terminator blocks
    expect(tar.length).toBe(1024);
  });

  it("preserves nested paths", async () => {
    const entries: ArchiveEntry[] = [
      {
        path: "subagents/agent-abc.jsonl",
        content: Buffer.from('{"msg":"hi"}'),
      },
    ];
    const gzipped = await buildTarGz(entries);
    const tar = zlib.gunzipSync(gzipped);
    const filename = tar.slice(0, 100).toString("utf-8").replace(/\0+$/, "");
    expect(filename).toBe("subagents/agent-abc.jsonl");
  });
});
