/**
 * Storage backend interface.
 *
 * Each backend (GCS, S3, Azure Blob, etc.) implements a single `upload`
 * method. The hook pipes a tar.gz buffer through it.
 */

export interface UploadResult {
  success: boolean;
  /** Short error category (e.g., "auth_failure", "bucket_not_found"). */
  error?: string;
  /** Raw details — typically stderr from the CLI tool. */
  details?: string;
}

export interface BackendConfig {
  type: string;
  bucket: string;
  prefix: string;
}

export interface StorageBackend {
  upload(key: string, data: Buffer): Promise<UploadResult>;
  delete(key: string): Promise<UploadResult>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBackend(config: BackendConfig): StorageBackend {
  switch (config.type) {
    case "gcs": {
      const { GCSBackend } = require("./gcs");
      return new GCSBackend(config);
    }
    default:
      throw new Error(
        `Unknown storage backend: "${config.type}". Supported: gcs`
      );
  }
}
