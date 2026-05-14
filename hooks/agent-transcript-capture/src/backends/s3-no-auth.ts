/**
 * S3 backend using unauthenticated PUT/DELETE via `fetch`.
 *
 * Requires the bucket policy to allow `s3:PutObject` and `s3:DeleteObject`
 * for `Principal: "*"`, scoped by `Resource: arn:aws:s3:::{bucket}/{namespace_key}/*`.
 *
 * Block Public Access must be relaxed (BlockPublicPolicy + RestrictPublicBuckets)
 * for the bucket policy to take effect — see the README's S3 setup section.
 *
 * No SDK, no CLI, no auth header. The whole backend is two `fetch` calls.
 */

import { BackendConfig, StorageBackend, UploadResult } from "./interface";

export class S3NoAuthBackend implements StorageBackend {
  readonly provider = "s3" as const;
  readonly bucket: string;
  private region: string;

  constructor(config: BackendConfig) {
    this.bucket = config.bucket;
    if (!config.region) {
      throw new Error(
        "agent-transcript-capture config: 'region' is required for the s3 provider"
      );
    }
    this.region = config.region;
  }

  /** Virtual-hosted-style URL — works for both us-east-1 and other regions. */
  private objectHttpUrl(key: string): string {
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;
  }

  objectUrl(key: string): string {
    return `s3://${this.bucket}/${key}`;
  }

  async upload(key: string, data: Buffer): Promise<UploadResult> {
    try {
      const res = await fetch(this.objectHttpUrl(key), {
        method: "PUT",
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
    try {
      const res = await fetch(this.objectHttpUrl(key), { method: "DELETE" });
      // S3 returns 204 on successful delete.
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
