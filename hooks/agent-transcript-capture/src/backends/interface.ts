/**
 * Storage backend interface.
 *
 * No-authentication mode uses pure `fetch` against a bucket configured to allow
 * unauthenticated PUT/DELETE scoped to a namespace_key prefix. No SDK,
 * no CLI, no auth header.
 */

export interface UploadResult {
  success: boolean;
  /** Short error category (e.g., "permission_denied", "network_error"). */
  error?: string;
  /** Raw details — typically the response body. */
  details?: string;
}

export type StorageProvider = "gcs" | "s3";

export interface BackendConfig {
  provider: StorageProvider;
  bucket: string;
  namespace_key: string;
  /** AWS region — required for s3, ignored for gcs. */
  region?: string;
}

export interface StorageBackend {
  /** Provider identifier for diagnostics. */
  readonly provider: StorageProvider;

  /** Bucket name (public infrastructure, OK to expose in URIs/messages). */
  readonly bucket: string;

  /** A canonical object URL for diagnostics / manifest records. */
  objectUrl(key: string): string;

  upload(key: string, data: Buffer): Promise<UploadResult>;
  delete(key: string): Promise<UploadResult>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { GcsNoAuthBackend } from "./gcs-no-auth";
import { S3NoAuthBackend } from "./s3-no-auth";

export function createBackend(config: BackendConfig): StorageBackend {
  switch (config.provider) {
    case "gcs":
      return new GcsNoAuthBackend(config);
    case "s3":
      return new S3NoAuthBackend(config);
    default:
      throw new Error(
        `Unknown storage provider: "${(config as { provider: string }).provider}". Supported: gcs, s3`
      );
  }
}
