import { describe, it, expect } from "vitest";
import { createBackend } from "../src/backends/interface";

describe("createBackend", () => {
  it('routes "gcs" to the SDK backend (GCSSdkBackend)', () => {
    const backend = createBackend({ type: "gcs", bucket: "test-bucket", prefix: "" });
    expect(backend.constructor.name).toBe("GCSSdkBackend");
  });

  it('routes "gcs-cli" to the CLI backend (GCSCliBackend)', () => {
    const backend = createBackend({ type: "gcs-cli", bucket: "test-bucket", prefix: "" });
    expect(backend.constructor.name).toBe("GCSCliBackend");
  });

  it("throws on unknown backend type", () => {
    expect(() =>
      createBackend({ type: "s3", bucket: "b", prefix: "" })
    ).toThrow('Unknown storage backend: "s3"');
  });

  it("gcs backend has upload and delete methods", () => {
    const backend = createBackend({ type: "gcs", bucket: "test-bucket", prefix: "" });
    expect(typeof backend.upload).toBe("function");
    expect(typeof backend.delete).toBe("function");
  });

  it("gcs-cli backend has upload and delete methods", () => {
    const backend = createBackend({ type: "gcs-cli", bucket: "test-bucket", prefix: "" });
    expect(typeof backend.upload).toBe("function");
    expect(typeof backend.delete).toBe("function");
  });
});
