import { describe, it, expect, vi } from "vitest";
import * as os from "os";
import { hashUser, scrubUsername } from "../src/identity";

describe("hashUser", () => {
  it("returns a 12-character hex string", () => {
    const hash = hashUser("test-salt");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same salt", () => {
    expect(hashUser("salt-a")).toBe(hashUser("salt-a"));
  });

  it("produces different hashes for different salts", () => {
    expect(hashUser("salt-a")).not.toBe(hashUser("salt-b"));
  });
});

describe("scrubUsername", () => {
  const username = os.userInfo().username;

  it("replaces the system username with a hashed placeholder", () => {
    const content = `path: /home/${username}/project/file.ts`;
    const result = scrubUsername(content, "abc123def456");
    expect(result).toBe("path: /home/[USER:abc123def456]/project/file.ts");
    expect(result).not.toContain(username);
  });

  it("replaces all occurrences", () => {
    const content = `${username} owns /home/${username}/.config`;
    const result = scrubUsername(content, "hash");
    expect(result).not.toContain(username);
    expect(result.match(/\[USER:hash\]/g)?.length).toBe(2);
  });

  it("returns content unchanged when username is not present", () => {
    const content = "no username here at all";
    expect(scrubUsername(content, "hash")).toBe(content);
  });
});
