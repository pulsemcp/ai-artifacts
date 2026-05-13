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
//
// Lazy-require each backend so that unused backends never load their
// dependencies.  This lets gcs-cli work without @google-cloud/storage
// installed, and vice versa.
// ---------------------------------------------------------------------------

export function createBackend(config: BackendConfig): StorageBackend {
  switch (config.type) {
    case "gcs": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GCSSdkBackend } = require("./gcs-sdk");
      return new GCSSdkBackend(config);
    }
    case "gcs-cli": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GCSCliBackend } = require("./gcs-cli");
      return new GCSCliBackend(config);
    }
    default:
      throw new Error(
        `Unknown storage backend: "${config.type}". Supported: gcs, gcs-cli`
      );
  }
}
