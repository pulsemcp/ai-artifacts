import { describe, it, expect } from "vitest";
import { redactContent } from "../src/redactor";

describe("redactContent", () => {
  it("redacts PEM private keys", () => {
    const input = `before\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...base64...\n-----END RSA PRIVATE KEY-----\nafter`;
    const result = redactContent(input);
    expect(result).toBe("before\n[REDACTED:private_key]\nafter");
    expect(result).not.toContain("BEGIN");
  });

  it("redacts JWT tokens", () => {
    const input =
      "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactContent(input);
    expect(result).toContain("[REDACTED:jwt]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("redacts AWS access key IDs", () => {
    const result = redactContent("key: AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("[REDACTED:aws_key]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts AWS secret keys", () => {
    const result = redactContent(
      "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYaa"
    );
    expect(result).toContain("[REDACTED:aws_secret]");
    expect(result).not.toContain("wJalrXUtnFEMI");
  });

  it("redacts GitHub fine-grained PATs", () => {
    const result = redactContent(
      "token: github_pat_11ABCDEF0abcdefghijklmnopqrstuvwxyz"
    );
    expect(result).toContain("[REDACTED:github_pat]");
  });

  it("redacts GitHub classic tokens", () => {
    for (const prefix of ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]) {
      const token = prefix + "a".repeat(36);
      const result = redactContent(`token: ${token}`);
      expect(result).toContain("[REDACTED:github_token]");
      expect(result).not.toContain(token);
    }
  });

  it("redacts Anthropic keys before OpenAI keys (prefix overlap)", () => {
    const result = redactContent("key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
    expect(result).toContain("[REDACTED:anthropic_key]");
    expect(result).not.toContain("[REDACTED:openai_key]");
  });

  it("redacts Stripe keys before OpenAI keys (prefix overlap)", () => {
    // Use a constructed value to avoid GitHub push protection false positives
    const fakeKey = ["sk", "live", "FAKE00TEST00KEY"].join("_");
    const result = redactContent("key: " + fakeKey);
    expect(result).toContain("[REDACTED:stripe_key]");
    expect(result).not.toContain("[REDACTED:openai_key]");
  });

  it("redacts OpenAI keys", () => {
    const result = redactContent(
      "key: sk-abcdefghijklmnopqrstuvwxyz1234567890"
    );
    expect(result).toContain("[REDACTED:openai_key]");
  });

  it("redacts Bearer tokens", () => {
    const result = redactContent(
      "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9xxxxxxxxxxxxx"
    );
    expect(result).toContain("[REDACTED:");
    expect(result).not.toContain("eyJhbGciOi");
  });

  it("redacts generic api_key assignments", () => {
    const result = redactContent('api_key="sk_test_very_long_key_1234567890"');
    expect(result).toContain("[REDACTED:");
  });

  it("redacts connection strings", () => {
    for (const proto of ["mongodb", "postgres", "mysql", "redis"]) {
      const cs = `${proto}://user:pass@host:5432/db`;
      const result = redactContent(`dsn: ${cs}`);
      expect(result).toContain("[REDACTED:connection_string]");
      expect(result).not.toContain(cs);
    }
  });

  it("redacts password assignments", () => {
    const result = redactContent('password="hunter2"');
    expect(result).toContain("[REDACTED:password]");
    expect(result).not.toContain("hunter2");
  });

  it("redacts env var secrets", () => {
    const result = redactContent("SECRET_KEY=my_super_secret_value");
    expect(result).toContain("[REDACTED:env_secret]");
    expect(result).not.toContain("my_super_secret_value");
  });

  it("does not redact template variable references (${...})", () => {
    const result = redactContent("SECRET_KEY=${SECRET_KEY}");
    expect(result).toContain("${SECRET_KEY}");
  });

  it("redacts email addresses", () => {
    const result = redactContent("contact alice@example.com for info");
    expect(result).toContain("[REDACTED:email]");
    expect(result).not.toContain("alice@example.com");
  });

  it("leaves innocuous content unchanged", () => {
    const input = "Hello world, this is a normal log message with no secrets.";
    expect(redactContent(input)).toBe(input);
  });

  it("applies extra patterns from config", () => {
    const result = redactContent("customer CUST-123456 found", [
      { name: "customer_id", pattern: "CUST-[0-9]{6}" },
    ]);
    expect(result).toContain("[REDACTED:customer_id]");
    expect(result).not.toContain("CUST-123456");
  });

  it("uses custom replacement text for extra patterns", () => {
    const result = redactContent("customer CUST-123456 found", [
      {
        name: "customer_id",
        pattern: "CUST-[0-9]{6}",
        replacement: "***CUSTOMER***",
      },
    ]);
    expect(result).toContain("***CUSTOMER***");
  });
});
