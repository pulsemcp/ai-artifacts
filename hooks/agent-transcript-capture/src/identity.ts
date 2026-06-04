import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { HookInput } from "./adapters/interface";

const COWORK_SESSION_RE = /^local_.+/;

type JsonObject = Record<string, unknown>;

export interface CoworkIdentityMetadata {
  source: "cowork_sidecar";
  emailAddress?: string;
  accountName?: string;
  displayName?: string;
  accountUuid?: string;
  organizationUuid?: string;
  organizationName?: string;
  organizationType?: string;
  seatTier?: string;
  billingType?: string;
  pathAccountUuid?: string;
  pathOrganizationUuid?: string;
  coworkSessionId: string;
  sourceA: {
    present: boolean;
    parsed: boolean;
    emailAddress?: string;
    cliSessionId?: string;
    cliSessionIdMatchesHook?: boolean;
  };
  sourceB: {
    present: boolean;
    parsed: boolean;
    hasOauthAccount: boolean;
    emailAddress?: string;
  };
  diagnostics: string[];
}

export interface HostIdentityMetadata {
  source: "claude_auth" | "os_user" | "unknown";
  emailAddress?: string;
}

export interface UploadIdentity {
  /**
   * Unsanitized identity used to derive the object-key {user_id} segment.
   * Callers should still pass this through `sanitizeUserId`.
   */
  rawUserId: string;
  metadata: CoworkIdentityMetadata | HostIdentityMetadata;
}

/**
 * Best-effort lookup of the Claude account email via `claude auth status`.
 * Returns null if the binary is missing, auth lookup fails, or the user
 * isn't logged in via an account method (e.g., raw API key with no email).
 */
export function getClaudeAuthEmail(): string | null {
  try {
    const out = execFileSync("claude", ["auth", "status"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 5_000,
    });
    const parsed = JSON.parse(out) as { loggedIn?: boolean; email?: string };
    if (parsed.loggedIn && typeof parsed.email === "string" && parsed.email) {
      return parsed.email;
    }
    return null;
  } catch {
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
export function getUsername(): string {
  return getClaudeAuthEmail() || os.userInfo().username || "unknown";
}

function asObject(value: unknown): JsonObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function stringField(obj: JsonObject | null, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readJsonObject(filePath: string): JsonObject | null {
  try {
    return asObject(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return null;
  }
}

// Deliberately stricter than the loose `/local-agent-mode-sessions/` substring
// check that `detectAgent` uses to tag the `agent` field. Identity resolution
// requires the exact `<root=local-agent-mode-sessions>/<account>/<org>/local_*`
// layout so it can locate the sidecars; a transcript tagged `claude_cowork`
// that doesn't match this structure safely degrades to the host fallback.
function isCoworkSessionDir(candidate: string): boolean {
  if (!COWORK_SESSION_RE.test(path.basename(candidate))) return false;

  const orgDir = path.dirname(candidate);
  const accountDir = path.dirname(orgDir);
  const rootDir = path.dirname(accountDir);
  return path.basename(rootDir) === "local-agent-mode-sessions";
}

function findCoworkSessionDir(hookInput: HookInput): string | null {
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

export function resolveUploadIdentity(hookInput: HookInput): UploadIdentity {
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

function resolveCoworkIdentity(
  hookInput: HookInput,
  sessionDir: string
): UploadIdentity {
  const orgDir = path.dirname(sessionDir);
  const accountDir = path.dirname(orgDir);
  const coworkSessionId = path.basename(sessionDir);
  const pathAccountUuid = path.basename(accountDir);
  const pathOrganizationUuid = path.basename(orgDir);
  const diagnostics: string[] = [];
  const sidecarPath = path.join(orgDir, `${coworkSessionId}.json`);
  const claudeJsonPath = path.join(sessionDir, ".claude", ".claude.json");

  const sourceAExists = fs.existsSync(sidecarPath);
  const sourceA = sourceAExists ? readJsonObject(sidecarPath) : null;
  const sourceBExists = fs.existsSync(claudeJsonPath);
  const sourceB = sourceBExists ? readJsonObject(claudeJsonPath) : null;
  const oauthAccount = asObject(sourceB?.oauthAccount);
  const cliSessionId = stringField(sourceA, "cliSessionId");
  const sourceAEmailAddress = stringField(sourceA, "emailAddress");
  const sourceBEmailAddress =
    stringField(oauthAccount, "emailAddress") ||
    stringField(oauthAccount, "email");

  if (!sourceAExists) diagnostics.push("cowork_source_a_missing");
  if (sourceAExists && !sourceA) diagnostics.push("cowork_source_a_unparseable");
  if (!sourceBExists) diagnostics.push("cowork_source_b_missing");
  if (sourceBExists && !sourceB) diagnostics.push("cowork_source_b_unparseable");
  if (sourceB && !oauthAccount) diagnostics.push("cowork_oauth_account_missing");
  if (cliSessionId && cliSessionId !== hookInput.session_id) {
    diagnostics.push("cowork_cli_session_id_mismatch");
  }
  if (
    sourceAEmailAddress &&
    sourceBEmailAddress &&
    sourceAEmailAddress !== sourceBEmailAddress
  ) {
    diagnostics.push("cowork_email_address_mismatch");
  }

  const emailAddress = sourceAEmailAddress || sourceBEmailAddress;
  const accountUuid =
    stringField(oauthAccount, "accountUuid") ||
    stringField(oauthAccount, "uuid");
  const organizationUuid =
    stringField(oauthAccount, "organizationUuid");

  if (accountUuid && accountUuid !== pathAccountUuid) {
    diagnostics.push("cowork_account_uuid_path_mismatch");
  }
  if (organizationUuid && organizationUuid !== pathOrganizationUuid) {
    diagnostics.push("cowork_organization_uuid_path_mismatch");
  }

  const fallbackUuid = accountUuid || pathAccountUuid;
  const rawUserId =
    emailAddress ||
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
        cliSessionIdMatchesHook:
          cliSessionId === undefined ? undefined : cliSessionId === hookInput.session_id,
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
export function sanitizeUserId(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
  return safe || "unknown";
}
