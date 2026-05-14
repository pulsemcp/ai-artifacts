import * as os from "os";
import { execFileSync } from "child_process";

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
 * Identity used for the {user_id} segment of the object key. Prefers the
 * Claude account email (so transcripts from one person on multiple machines
 * cluster together) and falls back to the OS username when no account email
 * is available.
 *
 * Without auth, per-user hashing is theatre — the user_id is organizational,
 * not a security boundary.
 */
export function getUsername(): string {
  return getClaudeAuthEmail() || os.userInfo().username || "unknown";
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
