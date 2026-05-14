"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3NoAuthBackend = void 0;
class S3NoAuthBackend {
    provider = "s3";
    bucket;
    region;
    constructor(config) {
        this.bucket = config.bucket;
        if (!config.region) {
            throw new Error("agent-transcript-capture config: 'region' is required for the s3 provider");
        }
        this.region = config.region;
    }
    /** Virtual-hosted-style URL — works for both us-east-1 and other regions. */
    objectHttpUrl(key) {
        const encodedKey = key.split("/").map(encodeURIComponent).join("/");
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;
    }
    objectUrl(key) {
        return `s3://${this.bucket}/${key}`;
    }
    async upload(key, data) {
        try {
            const res = await fetch(this.objectHttpUrl(key), {
                method: "PUT",
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
        try {
            const res = await fetch(this.objectHttpUrl(key), { method: "DELETE" });
            // S3 returns 204 on successful delete.
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
exports.S3NoAuthBackend = S3NoAuthBackend;
async function safeBody(res) {
    try {
        const text = await res.text();
        return text.slice(0, 2048);
    }
    catch {
        return "";
    }
}
