import * as os from "os";

/**
 * Local system username, used verbatim for the {user_id} segment of the
 * object key. Without auth, per-user hashing is theatre — the user_id is
 * organizational, not a security boundary.
 */
export function getUsername(): string {
  return os.userInfo().username || "unknown";
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
