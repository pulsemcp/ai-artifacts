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
exports.resolveUploadIdentity = resolveUploadIdentity;
exports.sanitizeUserId = sanitizeUserId;
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const COWORK_SESSION_RE = /^local_.+/;
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
 * Legacy host-Claude identity fallback. Cowork callers must use
 * `resolveUploadIdentity` so sidecars, not host CLI auth, determine identity.
 *
 * Without auth, per-user hashing is theatre — the user_id is organizational,
 * not a security boundary.
 */
function getUsername() {
    return getClaudeAuthEmail() || os.userInfo().username || "unknown";
}
function asObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return null;
}
function stringField(obj, key) {
    const value = obj?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function readJsonObject(filePath) {
    try {
        return asObject(JSON.parse(fs.readFileSync(filePath, "utf-8")));
    }
    catch {
        return null;
    }
}
function isCoworkSessionDir(candidate) {
    if (!COWORK_SESSION_RE.test(path.basename(candidate)))
        return false;
    const orgDir = path.dirname(candidate);
    const accountDir = path.dirname(orgDir);
    const rootDir = path.dirname(accountDir);
    return path.basename(rootDir) === "local-agent-mode-sessions";
}
function findCoworkSessionDir(hookInput) {
    let current = path.resolve(hookInput.transcript_path);
    while (current && current !== path.dirname(current)) {
        if (isCoworkSessionDir(current)) {
            return current;
        }
        current = path.dirname(current);
    }
    const cwd = hookInput.cwd ? path.resolve(hookInput.cwd) : "";
    if (cwd && path.basename(cwd) === "outputs") {
        const candidate = path.dirname(cwd);
        if (isCoworkSessionDir(candidate)) {
            return candidate;
        }
    }
    return null;
}
function resolveUploadIdentity(hookInput) {
    const coworkSessionDir = findCoworkSessionDir(hookInput);
    if (coworkSessionDir) {
        return resolveCoworkIdentity(hookInput, coworkSessionDir);
    }
    const email = getClaudeAuthEmail();
    if (email) {
        return {
            rawUserId: email,
            metadata: { source: "claude_auth", emailAddress: email },
        };
    }
    const username = os.userInfo().username;
    if (username) {
        return { rawUserId: username, metadata: { source: "os_user" } };
    }
    return { rawUserId: "unknown", metadata: { source: "unknown" } };
}
function resolveCoworkIdentity(hookInput, sessionDir) {
    const orgDir = path.dirname(sessionDir);
    const accountDir = path.dirname(orgDir);
    const coworkSessionId = path.basename(sessionDir);
    const pathAccountUuid = path.basename(accountDir);
    const pathOrganizationUuid = path.basename(orgDir);
    const diagnostics = [];
    const sidecarPath = path.join(orgDir, `${coworkSessionId}.json`);
    const claudeJsonPath = path.join(sessionDir, ".claude", ".claude.json");
    const sourceAExists = fs.existsSync(sidecarPath);
    const sourceA = sourceAExists ? readJsonObject(sidecarPath) : null;
    const sourceBExists = fs.existsSync(claudeJsonPath);
    const sourceB = sourceBExists ? readJsonObject(claudeJsonPath) : null;
    const oauthAccount = asObject(sourceB?.oauthAccount);
    const cliSessionId = stringField(sourceA, "cliSessionId");
    const sourceAEmailAddress = stringField(sourceA, "emailAddress");
    const sourceBEmailAddress = stringField(oauthAccount, "emailAddress") ||
        stringField(oauthAccount, "email");
    if (!sourceAExists)
        diagnostics.push("cowork_source_a_missing");
    if (sourceAExists && !sourceA)
        diagnostics.push("cowork_source_a_unparseable");
    if (!sourceBExists)
        diagnostics.push("cowork_source_b_missing");
    if (sourceBExists && !sourceB)
        diagnostics.push("cowork_source_b_unparseable");
    if (sourceB && !oauthAccount)
        diagnostics.push("cowork_oauth_account_missing");
    if (cliSessionId && cliSessionId !== hookInput.session_id) {
        diagnostics.push("cowork_cli_session_id_mismatch");
    }
    if (sourceAEmailAddress &&
        sourceBEmailAddress &&
        sourceAEmailAddress !== sourceBEmailAddress) {
        diagnostics.push("cowork_email_address_mismatch");
    }
    const emailAddress = sourceAEmailAddress || sourceBEmailAddress;
    const accountUuid = stringField(oauthAccount, "accountUuid") ||
        stringField(oauthAccount, "uuid");
    const organizationUuid = stringField(oauthAccount, "organizationUuid");
    if (accountUuid && accountUuid !== pathAccountUuid) {
        diagnostics.push("cowork_account_uuid_path_mismatch");
    }
    if (organizationUuid && organizationUuid !== pathOrganizationUuid) {
        diagnostics.push("cowork_organization_uuid_path_mismatch");
    }
    const fallbackUuid = accountUuid || pathAccountUuid;
    const rawUserId = emailAddress ||
        (fallbackUuid ? `cowork-${fallbackUuid.slice(0, 8)}` : "unknown");
    return {
        rawUserId,
        metadata: {
            source: "cowork_sidecar",
            emailAddress,
            accountName: stringField(sourceA, "accountName"),
            displayName: stringField(oauthAccount, "displayName"),
            accountUuid,
            organizationUuid,
            organizationName: stringField(oauthAccount, "organizationName"),
            organizationType: stringField(oauthAccount, "organizationType"),
            seatTier: stringField(oauthAccount, "seatTier"),
            billingType: stringField(oauthAccount, "billingType"),
            pathAccountUuid,
            pathOrganizationUuid,
            coworkSessionId,
            sourceA: {
                present: sourceAExists,
                parsed: sourceA !== null,
                emailAddress: sourceAEmailAddress,
                cliSessionId,
                cliSessionIdMatchesHook: cliSessionId === undefined ? undefined : cliSessionId === hookInput.session_id,
            },
            sourceB: {
                present: sourceBExists,
                parsed: sourceB !== null,
                hasOauthAccount: oauthAccount !== null,
                emailAddress: sourceBEmailAddress,
            },
            diagnostics,
        },
    };
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
