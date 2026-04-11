import { spawn } from "child_process";
import { BackendConfig, StorageBackend, UploadResult } from "./interface";

export class GCSCliBackend implements StorageBackend {
  private bucket: string;

  constructor(config: BackendConfig) {
    this.bucket = config.bucket;
  }

  private gcsUri(key: string): string {
    return `gs://${this.bucket}/${key}`;
  }

  /**
   * Classify a gsutil stderr message into an error category.
   */
  private classifyError(stderr: string, fallback: string): UploadResult {
    const lower = stderr.toLowerCase();

    if (
      lower.includes("401") ||
      lower.includes("credentials") ||
      lower.includes("not authorized") ||
      lower.includes("login")
    ) {
      return { success: false, error: "auth_failure", details: stderr.trim() };
    }
    if (
      lower.includes("404") ||
      lower.includes("bucket not found") ||
      lower.includes("does not exist")
    ) {
      return {
        success: false,
        error: "bucket_not_found",
        details: stderr.trim(),
      };
    }
    if (
      lower.includes("403") ||
      lower.includes("access denied") ||
      lower.includes("forbidden")
    ) {
      return {
        success: false,
        error: "permission_denied",
        details: stderr.trim(),
      };
    }
    return {
      success: false,
      error: fallback,
      details: stderr.trim() || `gsutil exited with non-zero code`,
    };
  }

  /**
   * Run a gsutil command.  Returns { success, error?, details? }.
   * If stdinData is provided it is piped to the child's stdin.
   */
  private run(
    args: string[],
    stdinData?: Buffer
  ): Promise<UploadResult> {
    return new Promise((resolve) => {
      const child = spawn("gsutil", args, {
        stdio: [stdinData ? "pipe" : "ignore", "ignore", "pipe"],
      });

      let stderr = "";

      child.stderr!.on("data", (chunk: Buffer) => {
        if (stderr.length < 4096) {
          stderr += chunk.toString("utf-8");
        }
      });

      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({
            success: false,
            error: "gsutil_not_found",
            details:
              "gsutil is not installed or not in PATH. " +
              "Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install",
          });
        } else {
          resolve({
            success: false,
            error: "spawn_error",
            details: err.message,
          });
        }
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ success: true });
          return;
        }
        resolve(this.classifyError(stderr, "command_failed"));
      });

      if (stdinData && child.stdin) {
        child.stdin.write(stdinData);
        child.stdin.end();
      }
    });
  }

  upload(key: string, data: Buffer): Promise<UploadResult> {
    return this.run(["cp", "-", this.gcsUri(key)], data);
  }

  delete(key: string): Promise<UploadResult> {
    return this.run(["rm", this.gcsUri(key)]);
  }
}
