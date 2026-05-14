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
exports.DEFAULT_MAX_ARCHIVE_BYTES = exports.NAMESPACE_KEY_PATTERN = void 0;
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
    // namespace_key sourcing: env var wins (so HOOK.json can be checked in with a
    // placeholder), then the config field.
    const envKey = process.env.STORAGE_NAMESPACE_KEY;
    const cfgKey = typeof noAuth.namespace_key === "string" ? noAuth.namespace_key : "";
    const namespaceKey = envKey && envKey.length > 0 ? envKey : cfgKey;
    if (!namespaceKey) {
        throw new Error("agent-transcript-capture config: 'no_auth.namespace_key' (or env STORAGE_NAMESPACE_KEY) is required");
    }
    if (!exports.NAMESPACE_KEY_PATTERN.test(namespaceKey)) {
        throw new Error("agent-transcript-capture config: 'namespace_key' must match " +
            "^secret-do-not-share-[a-f0-9]{12,}$. " +
            "Generate one with: echo \"secret-do-not-share-$(openssl rand -hex 16)\"");
    }
    let region;
    if (provider === "s3") {
        if (typeof noAuth.region !== "string" || !noAuth.region) {
            throw new Error("agent-transcript-capture config: 'no_auth.region' is required when provider is 's3'");
        }
        region = noAuth.region;
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
    return {
        mode: "no-auth",
        no_auth: {
            provider,
            bucket: noAuth.bucket,
            namespace_key: namespaceKey,
            region,
            max_archive_bytes: maxArchiveBytes,
        },
        privacy: {
            mode: privacy.mode,
            extra_patterns: extraPatterns,
        },
    };
}
/**
 * Helper: derive a BackendConfig from a no-auth-mode config.
 */
function toBackendConfig(noAuth) {
    return {
        provider: noAuth.provider,
        bucket: noAuth.bucket,
        namespace_key: noAuth.namespace_key,
        region: noAuth.region,
    };
}
