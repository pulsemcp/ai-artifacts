import { describe, it, expect } from "vitest";
import { createBackend } from "../src/backends/interface";
import { GcsNoAuthBackend } from "../src/backends/gcs-no-auth";
import { S3NoAuthBackend } from "../src/backends/s3-no-auth";

const GOOD_KEY = "secret-do-not-share-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const GOOD_GCS_BUCKET = `agent-transcripts-${GOOD_KEY}`;

describe("createBackend", () => {
  it("returns a GcsNoAuthBackend for provider=gcs", () => {
    const backend = createBackend({
      provider: "gcs",
      bucket: GOOD_GCS_BUCKET,
    });
    expect(backend.provider).toBe("gcs");
    expect(backend.bucket).toBe(GOOD_GCS_BUCKET);
  });

  it("returns an S3NoAuthBackend for provider=s3", () => {
    const backend = createBackend({
      provider: "s3",
      bucket: "b",
      namespace_key: GOOD_KEY,
      region: "us-east-1",
    });
    expect(backend.provider).toBe("s3");
  });

  it("throws on unknown provider", () => {
    expect(() =>
      createBackend({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: "azure" as any,
        bucket: "b",
        namespace_key: GOOD_KEY,
      } as never)
    ).toThrow(/Unknown storage provider/);
  });
});

describe("GcsNoAuthBackend", () => {
  it("produces a gs:// object URL", () => {
    const backend = new GcsNoAuthBackend({
      provider: "gcs",
      bucket: "my-bucket",
    });
    expect(backend.objectUrl("foo/bar.tar.gz")).toBe("gs://my-bucket/foo/bar.tar.gz");
  });

  it("buildObjectKey returns the suffix unchanged (namespace_key lives in the bucket name)", () => {
    const backend = new GcsNoAuthBackend({
      provider: "gcs",
      bucket: GOOD_GCS_BUCKET,
    });
    expect(backend.buildObjectKey("alice/2026/05/14/abc.tar.gz")).toBe(
      "alice/2026/05/14/abc.tar.gz"
    );
  });
});

describe("S3NoAuthBackend", () => {
  it("requires region", () => {
    expect(
      () =>
        new S3NoAuthBackend({
          provider: "s3",
          bucket: "b",
          namespace_key: GOOD_KEY,
        } as never)
    ).toThrow(/'region' is required/);
  });

  it("produces an s3:// object URL", () => {
    const backend = new S3NoAuthBackend({
      provider: "s3",
      bucket: "my-bucket",
      namespace_key: GOOD_KEY,
      region: "us-east-1",
    });
    expect(backend.objectUrl("foo/bar.tar.gz")).toBe("s3://my-bucket/foo/bar.tar.gz");
  });

  it("buildObjectKey prefixes the suffix with the namespace_key", () => {
    const backend = new S3NoAuthBackend({
      provider: "s3",
      bucket: "my-bucket",
      namespace_key: GOOD_KEY,
      region: "us-east-1",
    });
    expect(backend.buildObjectKey("alice/2026/05/14/abc.tar.gz")).toBe(
      `${GOOD_KEY}/alice/2026/05/14/abc.tar.gz`
    );
  });
});
