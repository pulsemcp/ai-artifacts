import * as crypto from "crypto";
import * as os from "os";

/**
 * Compute a pseudonymised user identifier.
 * sha256(orgSalt + username) truncated to 12 hex characters.
 */
export function hashUser(orgSalt: string): string {
  const username = os.userInfo().username;
  return crypto
    .createHash("sha256")
    .update(orgSalt + username)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Replace every literal occurrence of the system username in `content` with
 * a pseudonymised placeholder.  Catches paths like /home/username/ and
 * JSON-escaped variants like \\/home\\/username.
 */
export function scrubUsername(
  content: string,
  hashedUser: string
): string {
  const username = os.userInfo().username;
  if (!username) return content;

  const placeholder = `[USER:${hashedUser}]`;

  // Escape for use in a regex (username could contain dots, etc.)
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "g");

  return content.replace(re, placeholder);
}
