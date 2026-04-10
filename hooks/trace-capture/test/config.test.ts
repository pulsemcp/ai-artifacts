import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig } from "../src/config";

/**
 * Config resolution is relative to __dirname (compiled dist/).
 * To test loadConfig() without mocking, we write a config file to the
 * location it expects: one directory up from __dirname at import time.
 *
 * Since we're running via vitest (ts source, not compiled), __dirname in
 * config.ts points to src/. So the config path resolves to the hook root,
 * which is where trace-capture.json should live.
 *
 * We use a temp copy approach: save/restore any existing config file.
 */

const hookRoot = path.resolve(__dirname, "..");
const configPath = path.join(hookRoot, "trace-capture.json");

let savedConfig: Buffer | null = null;

beforeEach(() => {
  if (fs.existsSync(configPath)) {
    savedConfig = fs.readFileSync(configPath);
  } else {
    savedConfig = null;
  }
});

afterEach(() => {
  if (savedConfig !== null) {
    fs.writeFileSync(configPath, savedConfig);
  } else if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
});

function writeConfig(obj: unknown): void {
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2), "utf-8");
}

describe("loadConfig", () => {
  it("returns null when config file does not exist", () => {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    expect(loadConfig()).toBeNull();
  });

  it("loads a valid full-mode config", () => {
    writeConfig({
      enabled: true,
      backend: { type: "gcs", bucket: "my-bucket", prefix: "traces/" },
      privacy: { mode: "full", org_salt: "" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.enabled).toBe(true);
    expect(config!.backend.type).toBe("gcs");
    expect(config!.backend.bucket).toBe("my-bucket");
    expect(config!.backend.prefix).toBe("traces/");
    expect(config!.privacy.mode).toBe("full");
  });

  it("loads a valid redacted-mode config without identity hashing", () => {
    writeConfig({
      enabled: false,
      backend: { type: "gcs", bucket: "bucket" },
      privacy: { mode: "redacted" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.enabled).toBe(false);
    expect(config!.privacy.mode).toBe("redacted");
    expect(config!.privacy.hash_user_identity).toBe(false);
    expect(config!.backend.prefix).toBe(""); // default
  });

  it("loads a valid redacted-mode config with identity hashing", () => {
    writeConfig({
      enabled: true,
      backend: { type: "gcs", bucket: "bucket" },
      privacy: { mode: "redacted", hash_user_identity: true, org_salt: "my-salt" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.privacy.hash_user_identity).toBe(true);
    expect(config!.privacy.org_salt).toBe("my-salt");
  });

  it("throws on invalid JSON", () => {
    fs.writeFileSync(configPath, "not json{{{", "utf-8");
    expect(() => loadConfig()).toThrow("not valid JSON");
  });

  it("throws when enabled is not a boolean", () => {
    writeConfig({
      enabled: "yes",
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'enabled' must be a boolean");
  });

  it("throws when backend is missing", () => {
    writeConfig({ enabled: true, privacy: { mode: "full" } });
    expect(() => loadConfig()).toThrow("'backend' is required");
  });

  it("throws when backend.type is missing", () => {
    writeConfig({
      enabled: true,
      backend: { bucket: "b" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'backend.type' is required");
  });

  it("throws when backend.bucket is a gs:// URI", () => {
    writeConfig({
      enabled: true,
      backend: { type: "gcs", bucket: "gs://my-bucket" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("not a gs:// URI");
  });

  it("throws when privacy.mode is invalid", () => {
    writeConfig({
      enabled: true,
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "summary" },
    });
    expect(() => loadConfig()).toThrow("'privacy.mode' must be");
  });

  it("throws when hash_user_identity is true but org_salt is missing", () => {
    writeConfig({
      enabled: true,
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "redacted", hash_user_identity: true },
    });
    expect(() => loadConfig()).toThrow("'privacy.org_salt' is required");
  });

  it("does not require org_salt when hash_user_identity is false", () => {
    writeConfig({
      enabled: true,
      backend: { type: "gcs", bucket: "b" },
      privacy: { mode: "redacted" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.privacy.hash_user_identity).toBe(false);
  });

  it("parses extra_patterns", () => {
    writeConfig({
      enabled: true,
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
