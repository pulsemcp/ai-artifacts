"use strict";
/**
 * GCS backend using unauthenticated PUT/DELETE via `fetch`.
 *
 * Requires the bucket to grant `storage.objects.create` and
 * `storage.objects.delete` to `allUsers`, scoped via an IAM Condition to
 * `resource.name.startsWith("projects/_/buckets/{bucket}/objects/{namespace_key}/")`.
 *
 * No SDK, no CLI, no auth header. The whole backend is two `fetch` calls.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcsNoAuthBackend = void 0;
const JSON_API = "https://storage.googleapis.com/storage/v1/b";
const UPLOAD_API = "https://storage.googleapis.com/upload/storage/v1/b";
class GcsNoAuthBackend {
    provider = "gcs";
    bucket;
    constructor(config) {
        this.bucket = config.bucket;
    }
    objectUrl(key) {
        return `gs://${this.bucket}/${key}`;
    }
    async upload(key, data) {
        const url = `${UPLOAD_API}/${encodeURIComponent(this.bucket)}/o` +
            `?uploadType=media&name=${encodeURIComponent(key)}`;
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/gzip" },
                body: data,
            });
            if (res.ok)
                return { success: true };
            return this.classifyResponse(res.status, await safeBody(res));
        }
        catch (err) {
            return {
                success: false,
                error: "network_error",
                details: err instanceof Error ? err.message : String(err),
            };
        }
    }
    async delete(key) {
        const url = `${JSON_API}/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`;
        try {
            const res = await fetch(url, { method: "DELETE" });
            if (res.ok || res.status === 204)
                return { success: true };
            return this.classifyResponse(res.status, await safeBody(res));
        }
        catch (err) {
            return {
                success: false,
                error: "network_error",
                details: err instanceof Error ? err.message : String(err),
            };
        }
    }
    classifyResponse(status, body) {
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
exports.GcsNoAuthBackend = GcsNoAuthBackend;
async function safeBody(res) {
    try {
        const text = await res.text();
        return text.slice(0, 2048);
    }
    catch {
        return "";
    }
}
