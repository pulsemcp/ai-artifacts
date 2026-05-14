import { describe, it, expect } from "vitest";
import { getClaudeAuthEmail, getUsername, sanitizeUserId } from "../src/identity";

describe("getUsername", () => {
  it("returns a non-empty string", () => {
    const u = getUsername();
    expect(typeof u).toBe("string");
    expect(u.length).toBeGreaterThan(0);
  });
});

describe("getClaudeAuthEmail", () => {
  // The result depends on the host: either the `claude` CLI is installed and
  // logged in with an email (string with @), or it's not (null). Either is
  // a valid outcome — assert the shape, not a specific value.
  it("returns either null or an email-shaped string", () => {
    const result = getClaudeAuthEmail();
    if (result !== null) {
      expect(typeof result).toBe("string");
      expect(result).toContain("@");
    }
  });
});

describe("sanitizeUserId", () => {
  it("lowercases the name", () => {
    expect(sanitizeUserId("AliceCooper")).toBe("alicecooper");
  });

  it("replaces unsafe characters with dashes", () => {
    expect(sanitizeUserId("alice/bob")).toBe("alice-bob");
    expect(sanitizeUserId("alice cooper")).toBe("alice-cooper");
    expect(sanitizeUserId("alice@example.com")).toBe("alice-example.com");
  });

  it("preserves safe characters", () => {
    expect(sanitizeUserId("alice_bob-1.2")).toBe("alice_bob-1.2");
  });

  it("falls back to 'unknown' for empty input", () => {
    expect(sanitizeUserId("")).toBe("unknown");
  });
});
