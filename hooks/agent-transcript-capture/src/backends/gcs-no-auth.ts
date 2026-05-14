/**
 * GCS backend using unauthenticated PUT/DELETE via `fetch`.
 *
 * GCP refuses IAM Conditions on `allUsers` (the PublicResourceAllowConditionCheck
 * lint), so the secret can't live in a path prefix on a shared bucket. Instead,
 * the namespace_key is embedded in the bucket name itself, and allUsers gets a
 * bucket-wide write+delete binding. The bucket is dedicated to transcripts, so
 * the blast radius is the same as the S3 prefix-scoped variant.
 *
 * No SDK, no CLI, no auth header. The whole backend is two `fetch` calls.
 */

import { BackendConfig, StorageBackend, UploadResult } from "./interface";

const JSON_API = "https://storage.googleapis.com/storage/v1/b";
const UPLOAD_API = "https://storage.googleapis.com/upload/storage/v1/b";

export class GcsNoAuthBackend implements StorageBackend {
  readonly provider = "gcs" as const;
  readonly bucket: string;

  constructor(config: BackendConfig) {
    this.bucket = config.bucket;
  }

  objectUrl(key: string): string {
    return `gs://${this.bucket}/${key}`;
  }

  // The bucket name already contains the namespace_key, so no path prefix.
  buildObjectKey(suffix: string): string {
    return suffix;
  }

  async upload(key: string, data: Buffer): Promise<UploadResult> {
    const url =
      `${UPLOAD_API}/${encodeURIComponent(this.bucket)}/o` +
      `?uploadType=media&name=${encodeURIComponent(key)}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: data,
      });
      if (res.ok) return { success: true };
      return this.classifyResponse(res.status, await safeBody(res));
    } catch (err) {
      return {
        success: false,
        error: "network_error",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async delete(key: string): Promise<UploadResult> {
    const url = `${JSON_API}/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok || res.status === 204) return { success: true };
      return this.classifyResponse(res.status, await safeBody(res));
    } catch (err) {
      return {
        success: false,
        error: "network_error",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private classifyResponse(status: number, body: string): UploadResult {
    if (status === 401 || status === 403) {
      return { success: false, error: "permission_denied", details: `HTTP ${status}: ${body}` };
    }
    if (status === 404) {
      return { success: false, error: "not_found", details: `HTTP ${status}: ${body}` };
    }
    if (status === 413) {
      return { success: false, error: "payload_too_large", details: `HTTP ${status}: ${body}` };
    }
    return { success: false, error: "http_error", details: `HTTP ${status}: ${body}` };
  }
}

async function safeBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 2048);
  } catch {
    return "";
  }
}
