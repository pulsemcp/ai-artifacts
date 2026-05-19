"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_ARCHIVE_BYTES = exports.GCS_BUCKET_SUFFIX_PATTERN = exports.NAMESPACE_KEY_PATTERN = void 0;
exports.loadConfig = loadConfig;
exports.toBackendConfig = toBackendConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
// The namespace_key prefix is self-documenting so it's obvious in logs, pastes,
// and screenshots. Same idea as -----BEGIN OPENSSH PRIVATE KEY-----.
exports.NAMESPACE_KEY_PATTERN = /^secret-do-not-share-[a-f0-9]{12,}$/;
// For GCS, the secret lives in the bucket name itself. The bucket must end
// with the secret suffix so the self-documenting "secret-do-not-share-" marker
// is preserved end-to-end.
exports.GCS_BUCKET_SUFFIX_PATTERN = /secret-do-not-share-[a-f0-9]{12,}$/;
exports.DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
function resolveHookJsonPath() {
    // dist/config.js -> hook root is one level up.
    const hookRoot = path.resolve(__dirname, "..");
    return path.join(hookRoot, "HOOK.json");
}
/**
 * Load and validate config from HOOK.json's "x-config" key.
 * Returns null if HOOK.json does not exist or has no "x-config" section.
 * Throws on malformed config so the error surfaces loudly.
 */
function loadConfig() {
    const hookJsonPath = resolveHookJsonPath();
    if (!fs.existsSync(hookJsonPath)) {
        return null;
    }
    const raw = fs.readFileSync(hookJsonPath, "utf-8");
    let hookJson;
    try {
        hookJson = JSON.parse(raw);
    }
    catch {
        throw new Error(`HOOK.json is not valid JSON: ${hookJsonPath}`);
    }
    const parsed = hookJson["x-config"];
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    // --- mode ---
    const mode = parsed.mode;
    if (mode !== "no-auth") {
        throw new Error(`agent-transcript-capture config: 'mode' must be 'no-auth' (got: ${JSON.stringify(mode)})`);
    }
    // --- no_auth ---
    const noAuth = parsed.no_auth;
    if (!noAuth || typeof noAuth !== "object") {
        throw new Error("agent-transcript-capture config: 'no_auth' is required");
    }
    if (noAuth.provider !== "gcs" && noAuth.provider !== "s3") {
        throw new Error("agent-transcript-capture config: 'no_auth.provider' must be 'gcs' or 's3'");
    }
    const provider = noAuth.provider;
    if (typeof noAuth.bucket !== "string" || !noAuth.bucket) {
        throw new Error("agent-transcript-capture config: 'no_auth.bucket' is required");
    }
    if (noAuth.bucket.startsWith("gs://") || noAuth.bucket.startsWith("s3://")) {
        throw new Error("agent-transcript-capture config: 'no_auth.bucket' should be the bare bucket name, not a URI");
    }
    let maxArchiveBytes = exports.DEFAULT_MAX_ARCHIVE_BYTES;
    if (noAuth.max_archive_bytes !== undefined) {
        if (typeof noAuth.max_archive_bytes !== "number" ||
            !Number.isFinite(noAuth.max_archive_bytes) ||
            noAuth.max_archive_bytes <= 0) {
            throw new Error("agent-transcript-capture config: 'no_auth.max_archive_bytes' must be a positive number");
        }
        maxArchiveBytes = noAuth.max_archive_bytes;
    }
    let noAuthConfig;
    if (provider === "gcs") {
        // For GCS, the namespace secret is embedded in the bucket name itself
        // (see hooks/agent-transcript-capture/src/backends/gcs-no-auth.ts). A
        // separate namespace_key field would be redundant — reject it loudly so
        // the config doesn't encode the same secret twice. `in` catches explicit
        // null too, not just undefined.
        if ("namespace_key" in noAuth && noAuth.namespace_key !== undefined) {
            throw new Error("agent-transcript-capture config: 'no_auth.namespace_key' must NOT be set when provider is 'gcs'. " +
                "For GCS, the namespace secret is embedded in the bucket name itself (no separate field). " +
                "Remove the 'namespace_key' field. See README for details.");
        }
        // Only complain about STORAGE_NAMESPACE_KEY if it's set to a non-empty value,
        // matching how the S3 path treats env precedence. An exported-but-empty
        // env var ("") is functionally unset and shouldn't trip the validator.
        if (process.env.STORAGE_NAMESPACE_KEY !== undefined &&
            process.env.STORAGE_NAMESPACE_KEY.length > 0) {
            throw new Error("agent-transcript-capture config: the STORAGE_NAMESPACE_KEY env var is set, but it is unused when provider is 'gcs'. " +
                "For GCS, the namespace secret is embedded in the bucket name itself. Unset STORAGE_NAMESPACE_KEY. " +
                "See README for details.");
        }
        if (!exports.GCS_BUCKET_SUFFIX_PATTERN.test(noAuth.bucket)) {
            throw new Error("agent-transcript-capture config: GCS bucket name must end with " +
                "'secret-do-not-share-<12+ hex chars>' " +
                "(e.g., 'agent-transcripts-secret-do-not-share-a1b2c3d4e5f6'). " +
                "Generate the suffix with: echo \"secret-do-not-share-$(openssl rand -hex 16)\". " +
                "See README for details.");
        }
        noAuthConfig = {
            provider: "gcs",
            bucket: noAuth.bucket,
            max_archive_bytes: maxArchiveBytes,
        };
    }
    else {
        // S3: namespace_key sourcing — env var wins (so HOOK.json can be checked
        // in with a placeholder), then the config field.
        const envKey = process.env.STORAGE_NAMESPACE_KEY;
        const cfgKey = typeof noAuth.namespace_key === "string" ? noAuth.namespace_key : "";
        const namespaceKey = envKey && envKey.length > 0 ? envKey : cfgKey;
        if (!namespaceKey) {
            throw new Error("agent-transcript-capture config: 'no_auth.namespace_key' (or env STORAGE_NAMESPACE_KEY) is required when provider is 's3'");
        }
        if (!exports.NAMESPACE_KEY_PATTERN.test(namespaceKey)) {
            throw new Error("agent-transcript-capture config: 'namespace_key' must match " +
                "^secret-do-not-share-[a-f0-9]{12,}$. " +
                "Generate one with: echo \"secret-do-not-share-$(openssl rand -hex 16)\"");
        }
        if (typeof noAuth.region !== "string" || !noAuth.region) {
            throw new Error("agent-transcript-capture config: 'no_auth.region' is required when provider is 's3'");
        }
        noAuthConfig = {
            provider: "s3",
            bucket: noAuth.bucket,
            namespace_key: namespaceKey,
            region: noAuth.region,
            max_archive_bytes: maxArchiveBytes,
        };
    }
    // --- privacy ---
    const privacy = parsed.privacy;
    if (!privacy || typeof privacy !== "object") {
        throw new Error("agent-transcript-capture config: 'privacy' is required");
    }
    if (privacy.mode !== "full" && privacy.mode !== "redacted") {
        throw new Error("agent-transcript-capture config: 'privacy.mode' must be 'full' or 'redacted'");
    }
    const extraPatterns = [];
    if (Array.isArray(privacy.extra_patterns)) {
        for (const p of privacy.extra_patterns) {
            if (typeof p === "object" &&
                p !== null &&
                typeof p.name === "string" &&
                typeof p.pattern === "string") {
                extraPatterns.push(p);
            }
        }
    }
    // --- agent_name (optional override) ---
    // Empty-string is treated as "not set" and falls through to the next signal
    // in resolveAgentName — matches the AGENT_TRANSCRIPT_CAPTURE_AGENT_NAME env
    // var's empty-string handling. Non-string values are rejected loudly.
    let agentName;
    if (parsed.agent_name !== undefined && parsed.agent_name !== "") {
        if (typeof parsed.agent_name !== "string") {
            throw new Error("agent-transcript-capture config: 'agent_name' must be a string when set");
        }
        agentName = parsed.agent_name;
    }
    return {
        mode: "no-auth",
        no_auth: noAuthConfig,
        privacy: {
            mode: privacy.mode,
            extra_patterns: extraPatterns,
        },
        agent_name: agentName,
    };
}
/**
 * Helper: derive a BackendConfig from a no-auth-mode config.
 */
function toBackendConfig(noAuth) {
    if (noAuth.provider === "s3") {
        return {
            provider: "s3",
            bucket: noAuth.bucket,
            namespace_key: noAuth.namespace_key,
            region: noAuth.region,
        };
    }
    return {
        provider: "gcs",
        bucket: noAuth.bucket,
    };
}
