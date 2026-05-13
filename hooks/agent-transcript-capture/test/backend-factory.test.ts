import { describe, it, expect } from "vitest";
import { createBackend } from "../src/backends/interface";
import { GCSSdkBackend } from "../src/backends/gcs-sdk";
import { GCSCliBackend } from "../src/backends/gcs-cli";

describe("createBackend", () => {
  it("throws on unknown backend type", () => {
    expect(() =>
      createBackend({ type: "s3", bucket: "b", prefix: "" })
    ).toThrow('Unknown storage backend: "s3"');
  });
});

describe("GCSSdkBackend", () => {
  it("implements upload and delete", () => {
    const backend = new GCSSdkBackend({ type: "gcs", bucket: "test-bucket", prefix: "" });
    expect(typeof backend.upload).toBe("function");
    expect(typeof backend.delete).toBe("function");
  });

  it("classifies 401 as auth_failure", () => {
    const backend = new GCSSdkBackend({ type: "gcs", bucket: "b", prefix: "" });
    const err = Object.assign(new Error("Unauthorized"), { code: 401 });
    const result = (backend as any).classifyError(err);
    expect(result).toEqual({ success: false, error: "auth_failure", details: "Unauthorized" });
  });

  it("classifies 'could not load the default credentials' as auth_failure", () => {
    const backend = new GCSSdkBackend({ type: "gcs", bucket: "b", prefix: "" });
    const result = (backend as any).classifyError(
      new Error("Could not load the default credentials")
    );
    expect(result.error).toBe("auth_failure");
  });

  it("classifies 404 as bucket_not_found", () => {
    const backend = new GCSSdkBackend({ type: "gcs", bucket: "b", prefix: "" });
    const err = Object.assign(new Error("Not Found"), { code: 404 });
    const result = (backend as any).classifyError(err);
    expect(result).toEqual({ success: false, error: "bucket_not_found", details: "Not Found" });
  });

  it("classifies 403 as permission_denied", () => {
    const backend = new GCSSdkBackend({ type: "gcs", bucket: "b", prefix: "" });
    const err = Object.assign(new Error("Forbidden"), { code: 403 });
    const result = (backend as any).classifyError(err);
    expect(result).toEqual({ success: false, error: "permission_denied", details: "Forbidden" });
  });

  it("classifies unknown errors as sdk_error", () => {
    const backend = new GCSSdkBackend({ type: "gcs", bucket: "b", prefix: "" });
    const result = (backend as any).classifyError(new Error("Something weird happened"));
    expect(result).toEqual({ success: false, error: "sdk_error", details: "Something weird happened" });
  });
});

describe("GCSCliBackend", () => {
  it("implements upload and delete", () => {
    const backend = new GCSCliBackend({ type: "gcs-cli", bucket: "test-bucket", prefix: "" });
    expect(typeof backend.upload).toBe("function");
    expect(typeof backend.delete).toBe("function");
  });
});
