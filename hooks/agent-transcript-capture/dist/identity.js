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
exports.getClaudeAuthEmail = getClaudeAuthEmail;
exports.getUsername = getUsername;
exports.sanitizeUserId = sanitizeUserId;
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
/**
 * Best-effort lookup of the Claude account email via `claude auth status`.
 * Returns null if the binary is missing, auth lookup fails, or the user
 * isn't logged in via an account method (e.g., raw API key with no email).
 */
function getClaudeAuthEmail() {
    try {
        const out = (0, child_process_1.execFileSync)("claude", ["auth", "status"], {
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf-8",
            timeout: 5_000,
        });
        const parsed = JSON.parse(out);
        if (parsed.loggedIn && typeof parsed.email === "string" && parsed.email) {
            return parsed.email;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Identity used for the {user_id} segment of the object key. Prefers the
 * Claude account email (so transcripts from one person on multiple machines
 * cluster together) and falls back to the OS username when no account email
 * is available.
 *
 * Without auth, per-user hashing is theatre — the user_id is organizational,
 * not a security boundary.
 */
function getUsername() {
    return getClaudeAuthEmail() || os.userInfo().username || "unknown";
}
/**
 * Sanitize a username for use as a path segment.
 *
 * Replaces anything that isn't a safe path character with a dash, and
 * lower-cases the result. Defends against pathological usernames containing
 * slashes, dots, or whitespace.
 */
function sanitizeUserId(name) {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
    return safe || "unknown";
}
