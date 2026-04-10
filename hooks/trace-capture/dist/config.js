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
exports.loadConfig = loadConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
/**
 * Resolve the config file path.
 *
 * The config lives alongside the hook itself: trace-capture.json in the hook
 * root directory.  At runtime, dist/capture.js is one level down from the
 * hook root, so we resolve relative to __dirname's parent.
 *
 * When installed via a hook manager, the hook directory is copied into the
 * agent's workspace (e.g., .claude/hooks/trace-capture/).  The config file
 * travels with it.
 */
function resolveConfigPath() {
    // dist/capture.js -> hook root is one level up
    const hookRoot = path.resolve(__dirname, "..");
    return path.join(hookRoot, "trace-capture.json");
}
/**
 * Load and validate the trace-capture config.
 * Returns null if the config file does not exist (hook is not configured).
 * Throws on malformed config so the error surfaces loudly.
 */
function loadConfig() {
    const configPath = resolveConfigPath();
    if (!fs.existsSync(configPath)) {
        return null;
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`trace-capture config is not valid JSON: ${configPath}`);
    }
    // --- backend ---
    const backend = parsed.backend;
    if (!backend || typeof backend !== "object") {
        throw new Error("trace-capture config: 'backend' is required");
    }
    if (typeof backend.type !== "string" || !backend.type) {
        throw new Error("trace-capture config: 'backend.type' is required");
    }
    if (typeof backend.bucket !== "string" || !backend.bucket) {
        throw new Error("trace-capture config: 'backend.bucket' is required");
    }
    if (typeof backend.bucket === "string" &&
        backend.bucket.startsWith("gs://")) {
        throw new Error("trace-capture config: 'backend.bucket' should be just the bucket name, not a gs:// URI");
    }
    const prefix = typeof backend.prefix === "string" ? backend.prefix : "";
    // --- privacy ---
    const privacy = parsed.privacy;
    if (!privacy || typeof privacy !== "object") {
        throw new Error("trace-capture config: 'privacy' is required");
    }
    if (privacy.mode !== "full" && privacy.mode !== "redacted") {
        throw new Error("trace-capture config: 'privacy.mode' must be 'full' or 'redacted'");
    }
    const hashUserIdentity = privacy.hash_user_identity === true;
    if (hashUserIdentity &&
        (typeof privacy.org_salt !== "string" || !privacy.org_salt)) {
        throw new Error("trace-capture config: 'privacy.org_salt' is required when hash_user_identity is true");
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
        backend: {
            type: backend.type,
            bucket: backend.bucket,
            prefix,
        },
        privacy: {
            mode: privacy.mode,
            hash_user_identity: hashUserIdentity,
            org_salt: privacy.org_salt || "",
            extra_patterns: extraPatterns,
        },
    };
}
