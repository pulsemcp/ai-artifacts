import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../src/config";

/**
 * Config resolution is relative to __dirname (compiled dist/).
 * To test loadConfig() without mocking, we write a HOOK.json file to the
 * location it expects: one directory up from __dirname at import time.
 *
 * Since we're running via vitest (ts source, not compiled), __dirname in
 * config.ts points to src/. So the config path resolves to the hook root,
 * which is where HOOK.json should live.
 *
 * We use a temp copy approach: save/restore any existing HOOK.json file.
 */

const hookRoot = path.resolve(__dirname, "..");
const hookJsonPath = path.join(hookRoot, "HOOK.json");

let savedHookJson: Buffer | null = null;

beforeEach(() => {
  if (fs.existsSync(hookJsonPath)) {
    savedHookJson = fs.readFileSync(hookJsonPath);
  } else {
    savedHookJson = null;
  }
});

afterEach(() => {
  if (savedHookJson !== null) {
    fs.writeFileSync(hookJsonPath, savedHookJson);
  } else if (fs.existsSync(hookJsonPath)) {
    fs.unlinkSync(hookJsonPath);
  }
});

function writeHookJson(xConfig: unknown): void {
  const hookJson = {
    event: "Stop",
    command: "node",
    args: ["dist/capture.js"],
    "x-config": xConfig,
  };
  fs.writeFileSync(hookJsonPath, JSON.stringify(hookJson, null, 2), "utf-8");
}

function writeRawHookJson(content: string): void {
  fs.writeFileSync(hookJsonPath, content, "utf-8");
}

describe("loadConfig", () => {
  it("returns null when HOOK.json does not exist", () => {
    if (fs.existsSync(hookJsonPath)) fs.unlinkSync(hookJsonPath);
    expect(loadConfig()).toBeNull();
  });

  it("returns null when HOOK.json has no x-config key", () => {
    fs.writeFileSync(
      hookJsonPath,
      JSON.stringify({ event: "Stop", command: "node" }),
      "utf-8"
    );
    expect(loadConfig()).toBeNull();
  });

  it("loads a valid full-mode config", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "my-bucket", prefix: "traces/" },
      privacy: { mode: "full", org_salt: "" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.backend.type).toBe("gcs");
    expect(config!.backend.bucket).toBe("my-bucket");
    expect(config!.backend.prefix).toBe("traces/");
    expect(config!.privacy.mode).toBe("full");
  });

  it("loads a valid redacted-mode config without identity hashing", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "bucket" },
      privacy: { mode: "redacted" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.privacy.mode).toBe("redacted");
    expect(config!.privacy.hash_user_identity).toBe(false);
    expect(config!.backend.prefix).toBe(""); // default
  });

  it("loads a valid redacted-mode config with identity hashing", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "bucket" },
      privacy: { mode: "redacted", hash_user_identity: true, org_salt: "my-salt" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.privacy.hash_user_identity).toBe(true);
    expect(config!.privacy.org_salt).toBe("my-salt");
  });

  it("throws on invalid JSON", () => {
    writeRawHookJson("not json{{{");
    expect(() => loadConfig()).toThrow("not valid JSON");
  });

  it("throws when backend is missing", () => {
    writeHookJson({ privacy: { mode: "full" } });
    expect(() => loadConfig()).toThrow("'backend' is required");
  });

  it("throws when backend.type is missing", () => {
    writeHookJson({
      backend: { bucket: "b" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'backend.type' is required");
  });

  it("throws when backend.bucket is a gs:// URI", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "gs://my-bucket" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("not a gs:// URI");
  });

  it("throws when privacy.mode is invalid", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "summary" },
    });
    expect(() => loadConfig()).toThrow("'privacy.mode' must be");
  });

  it("throws when hash_user_identity is true but org_salt is missing", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "redacted", hash_user_identity: true },
    });
    expect(() => loadConfig()).toThrow("'privacy.org_salt' is required");
  });

  it("does not require org_salt when hash_user_identity is false", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "redacted" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.privacy.hash_user_identity).toBe(false);
  });

  it("parses extra_patterns", () => {
    writeHookJson({
      backend: { type: "gcs", bucket: "b" },
      privacy: {
        mode: "redacted",
        extra_patterns: [
          { name: "custom", pattern: "CUSTOM-[0-9]+" },
        ],
      },
    });
    const config = loadConfig();
    expect(config!.privacy.extra_patterns).toHaveLength(1);
    expect(config!.privacy.extra_patterns![0].name).toBe("custom");
  });
});
