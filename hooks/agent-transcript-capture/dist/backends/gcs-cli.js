"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCSCliBackend = void 0;
const child_process_1 = require("child_process");
class GCSCliBackend {
    bucket;
    constructor(config) {
        this.bucket = config.bucket;
    }
    gcsUri(key) {
        return `gs://${this.bucket}/${key}`;
    }
    /**
     * Classify a gsutil stderr message into an error category.
     */
    classifyError(stderr, fallback) {
        const lower = stderr.toLowerCase();
        if (lower.includes("401") ||
            lower.includes("credentials") ||
            lower.includes("not authorized") ||
            lower.includes("login")) {
            return { success: false, error: "auth_failure", details: stderr.trim() };
        }
        if (lower.includes("404") ||
            lower.includes("bucket not found") ||
            lower.includes("does not exist")) {
            return {
                success: false,
                error: "bucket_not_found",
                details: stderr.trim(),
            };
        }
        if (lower.includes("403") ||
            lower.includes("access denied") ||
            lower.includes("forbidden")) {
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
    run(args, stdinData) {
        return new Promise((resolve) => {
            const child = (0, child_process_1.spawn)("gsutil", args, {
                stdio: [stdinData ? "pipe" : "ignore", "ignore", "pipe"],
            });
            let stderr = "";
            child.stderr.on("data", (chunk) => {
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
                resolve(this.classifyError(stderr, "command_failed"));
            });
            if (stdinData && child.stdin) {
                child.stdin.write(stdinData);
                child.stdin.end();
            }
        });
    }
    upload(key, data) {
        return this.run(["cp", "-", this.gcsUri(key)], data);
    }
    delete(key) {
        return this.run(["rm", this.gcsUri(key)]);
    }
}
exports.GCSCliBackend = GCSCliBackend;
