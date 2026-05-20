import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadConfig } from "../src/config";

const hookRoot = path.resolve(__dirname, "..");
const hookJsonPath = path.join(hookRoot, "HOOK.json");

let savedHookJson: Buffer | null = null;
let savedEnvKey: string | undefined;

const GOOD_KEY = "secret-do-not-share-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const GOOD_GCS_BUCKET = `agent-transcripts-${GOOD_KEY}`;

beforeEach(() => {
  savedHookJson = fs.existsSync(hookJsonPath)
    ? fs.readFileSync(hookJsonPath)
    : null;
  savedEnvKey = process.env.STORAGE_NAMESPACE_KEY;
  delete process.env.STORAGE_NAMESPACE_KEY;
});

afterEach(() => {
  if (savedHookJson !== null) {
    fs.writeFileSync(hookJsonPath, savedHookJson);
  } else if (fs.existsSync(hookJsonPath)) {
    fs.unlinkSync(hookJsonPath);
  }
  if (savedEnvKey !== undefined) {
    process.env.STORAGE_NAMESPACE_KEY = savedEnvKey;
  } else {
    delete process.env.STORAGE_NAMESPACE_KEY;
  }
});

function writeHookJson(xConfig: unknown): void {
  fs.writeFileSync(
    hookJsonPath,
    JSON.stringify(
      {
        event: "Stop",
        command: "node",
        args: ["dist/capture.js"],
        "x-config": xConfig,
      },
      null,
      2
    ),
    "utf-8"
  );
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

  it("loads a valid GCS no-auth config (no namespace_key)", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: GOOD_GCS_BUCKET,
      },
      privacy: { mode: "redacted" },
    });
    const config = loadConfig();
    expect(config).not.toBeNull();
    expect(config!.mode).toBe("no-auth");
    expect(config!.no_auth.provider).toBe("gcs");
    expect(config!.no_auth.bucket).toBe(GOOD_GCS_BUCKET);
    // namespace_key must not be present on the GCS variant.
    expect(
      (config!.no_auth as { namespace_key?: string }).namespace_key
    ).toBeUndefined();
    expect(config!.privacy.mode).toBe("redacted");
  });

  it("loads a valid S3 no-auth config", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "s3",
        bucket: "my-s3-bucket",
        namespace_key: GOOD_KEY,
        region: "us-east-1",
      },
      privacy: { mode: "full" },
    });
    const config = loadConfig();
    expect(config!.no_auth.provider).toBe("s3");
    expect((config!.no_auth as { namespace_key: string }).namespace_key).toBe(
      GOOD_KEY
    );
    expect((config!.no_auth as { region: string }).region).toBe("us-east-1");
    expect(config!.privacy.mode).toBe("full");
  });

  it("sources S3 namespace_key from STORAGE_NAMESPACE_KEY env when set", () => {
    process.env.STORAGE_NAMESPACE_KEY = GOOD_KEY;
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "s3",
        bucket: "b",
        namespace_key: "placeholder",
        region: "us-east-1",
      },
      privacy: { mode: "redacted" },
    });
    const config = loadConfig();
    expect((config!.no_auth as { namespace_key: string }).namespace_key).toBe(
      GOOD_KEY
    );
  });

  it("throws when mode is not 'no-auth'", () => {
    writeHookJson({
      mode: "managed",
      no_auth: {},
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'mode' must be 'no-auth'");
  });

  it("throws when no_auth.provider is invalid", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: { provider: "azure", bucket: "b", namespace_key: GOOD_KEY },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'no_auth.provider' must be 'gcs' or 's3'");
  });

  it("throws when bucket is missing", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: { provider: "gcs" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'no_auth.bucket' is required");
  });

  it("throws when bucket is a gs:// URI", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: `gs://${GOOD_GCS_BUCKET}`,
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("bare bucket name");
  });

  // --- GCS-specific: namespace_key prohibited ---

  it("throws when namespace_key is set under provider: gcs (HOOK.json field)", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: GOOD_GCS_BUCKET,
        namespace_key: GOOD_KEY,
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow(
      /'no_auth\.namespace_key' must NOT be set when provider is 'gcs'/
    );
  });

  it("throws when STORAGE_NAMESPACE_KEY env var is set under provider: gcs", () => {
    process.env.STORAGE_NAMESPACE_KEY = GOOD_KEY;
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: GOOD_GCS_BUCKET,
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow(
      /STORAGE_NAMESPACE_KEY env var is set, but it is unused when provider is 'gcs'/
    );
  });

  it("throws when GCS bucket name does not end with secret-do-not-share-<hex>", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: "my-plain-bucket",
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow(
      /GCS bucket name must end with 'secret-do-not-share-/
    );
  });

  it("accepts an empty STORAGE_NAMESPACE_KEY env var under provider: gcs (treated as unset)", () => {
    process.env.STORAGE_NAMESPACE_KEY = "";
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: GOOD_GCS_BUCKET,
      },
      privacy: { mode: "full" },
    });
    // Should NOT throw — empty env var is functionally unset.
    const config = loadConfig();
    expect(config!.no_auth.provider).toBe("gcs");
  });

  it("throws when explicit null namespace_key is set under provider: gcs", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: GOOD_GCS_BUCKET,
        namespace_key: null,
      },
      privacy: { mode: "full" },
    });
    // `in` operator catches explicit null/undefined-but-present too.
    // null specifically: present in the object but not === undefined.
    // Verify we don't silently accept it.
    // (If the author chose to permit null, this test will fail and they can
    // update — but the intent here is "no namespace_key field at all".)
    expect(() => loadConfig()).toThrow(
      /'no_auth\.namespace_key' must NOT be set when provider is 'gcs'/
    );
  });

  it("accepts a GCS bucket name with the secret suffix anywhere it ends", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        // Some other org-specific prefix, but ends with the secret suffix.
        bucket: `org-prefix-${GOOD_KEY}`,
      },
      privacy: { mode: "full" },
    });
    const config = loadConfig();
    expect(config!.no_auth.bucket).toBe(`org-prefix-${GOOD_KEY}`);
  });

  // --- S3-specific: namespace_key required ---

  it("throws when S3 namespace_key has wrong format", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "s3",
        bucket: "b",
        namespace_key: "not-a-real-key",
        region: "us-east-1",
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow(/namespace_key.*must match/);
  });

  it("throws when S3 namespace_key is missing entirely", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: { provider: "s3", bucket: "b", region: "us-east-1" },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow(
      /'no_auth\.namespace_key'.*required when provider is 's3'/
    );
  });

  it("throws when region is missing for s3", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "s3",
        bucket: "b",
        namespace_key: GOOD_KEY,
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'no_auth.region' is required");
  });

  it("throws on invalid privacy.mode", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: { provider: "gcs", bucket: GOOD_GCS_BUCKET },
      privacy: { mode: "summary" },
    });
    expect(() => loadConfig()).toThrow("'privacy.mode' must be");
  });

  it("parses extra_patterns", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: { provider: "gcs", bucket: GOOD_GCS_BUCKET },
      privacy: {
        mode: "redacted",
        extra_patterns: [{ name: "custom", pattern: "CUSTOM-[0-9]+" }],
      },
    });
    const config = loadConfig();
    expect(config!.privacy.extra_patterns).toHaveLength(1);
    expect(config!.privacy.extra_patterns![0].name).toBe("custom");
  });

  it("validates max_archive_bytes", () => {
    writeHookJson({
      mode: "no-auth",
      no_auth: {
        provider: "gcs",
        bucket: GOOD_GCS_BUCKET,
        max_archive_bytes: -1,
      },
      privacy: { mode: "full" },
    });
    expect(() => loadConfig()).toThrow("'no_auth.max_archive_bytes' must be a positive number");
  });

});
