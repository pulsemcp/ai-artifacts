"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCSBackend = void 0;
const child_process_1 = require("child_process");
class GCSBackend {
    bucket;
    constructor(config) {
        this.bucket = config.bucket;
    }
    upload(key, data) {
        const gcsUri = `gs://${this.bucket}/${key}`;
        return new Promise((resolve) => {
            const child = (0, child_process_1.spawn)("gsutil", ["cp", "-", gcsUri], {
                stdio: ["pipe", "ignore", "pipe"],
            });
            let stderr = "";
            child.stderr.on("data", (chunk) => {
                // Cap stderr collection at 4KB to prevent memory issues.
                if (stderr.length < 4096) {
                    stderr += chunk.toString("utf-8");
                }
            });
            child.on("error", (err) => {
                if (err.code === "ENOENT") {
                    resolve({
                        success: false,
                        error: "gsutil_not_found",
                        details: "gsutil is not installed or not in PATH. " +
                            "Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install",
                    });
                }
                else {
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
                // Classify the error from stderr content.
                const lower = stderr.toLowerCase();
                if (lower.includes("401") ||
                    lower.includes("credentials") ||
                    lower.includes("not authorized") ||
                    lower.includes("login")) {
                    resolve({
                        success: false,
                        error: "auth_failure",
                        details: stderr.trim(),
                    });
                }
                else if (lower.includes("404") ||
                    lower.includes("bucket not found") ||
                    lower.includes("does not exist")) {
                    resolve({
                        success: false,
                        error: "bucket_not_found",
                        details: stderr.trim(),
                    });
                }
                else if (lower.includes("403") ||
                    lower.includes("access denied") ||
                    lower.includes("forbidden")) {
                    resolve({
                        success: false,
                        error: "permission_denied",
                        details: stderr.trim(),
                    });
                }
                else {
                    resolve({
                        success: false,
                        error: "upload_failed",
                        details: stderr.trim() || `gsutil exited with code ${code}`,
                    });
                }
            });
            // Pipe the tar.gz data to gsutil's stdin.
            child.stdin.write(data);
            child.stdin.end();
        });
    }
}
exports.GCSBackend = GCSBackend;
