import { Storage } from "@google-cloud/storage";
import { BackendConfig, StorageBackend, UploadResult } from "./interface";

/**
 * GCS backend using the @google-cloud/storage SDK.
 *
 * Auth is handled automatically by the SDK via Application Default Credentials:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var (path to service account key JSON)
 *   - Workload Identity (GKE, Cloud Run, etc.)
 *   - `gcloud auth application-default login` for local dev
 *
 * No CLI tools required — only `npm install` in the hook directory.
 */
export class GCSSdkBackend implements StorageBackend {
  private storage: Storage;
  private bucket: string;

  constructor(config: BackendConfig) {
    this.bucket = config.bucket;
    this.storage = new Storage();
  }

  async upload(key: string, data: Buffer): Promise<UploadResult> {
    try {
      const file = this.storage.bucket(this.bucket).file(key);
      await file.save(data, {
        contentType: "application/gzip",
        resumable: false, // small files — skip resumable overhead
      });
      return { success: true };
    } catch (err) {
      return this.classifyError(err);
    }
  }

  async delete(key: string): Promise<UploadResult> {
    try {
      await this.storage.bucket(this.bucket).file(key).delete();
      return { success: true };
    } catch (err) {
      return this.classifyError(err);
    }
  }

  private classifyError(err: unknown): UploadResult {
    const code = (err as { code?: number }).code;
    const message =
      err instanceof Error ? err.message : String(err);

    if (code === 401 || /credentials|not authorized|login/i.test(message)) {
      return { success: false, error: "auth_failure", details: message };
    }
    if (code === 404 || /bucket.*not found|does not exist/i.test(message)) {
      return { success: false, error: "bucket_not_found", details: message };
    }
    if (code === 403 || /access denied|forbidden/i.test(message)) {
      return { success: false, error: "permission_denied", details: message };
    }

    return { success: false, error: "sdk_error", details: message };
  }
}
