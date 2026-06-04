import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getClaudeAuthEmail,
  getUsername,
  resolveUploadIdentity,
  sanitizeUserId,
} from "../src/identity";
import { HookInput } from "../src/adapters/interface";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), "utf-8");
}

function coworkLayout(options: {
  sourceA?: unknown;
  sourceB?: unknown;
  transcriptUnderSession?: boolean;
} = {}): HookInput {
  const accountUuid = "acc-11111111-2222-3333-4444-555555555555";
  const organizationUuid = "org-11111111-2222-3333-4444-555555555555";
  const coworkSessionId = "local_cowork-session";
  const cliSessionId = "cli-session-1";
  const sessionDir = path.join(
    tmpDir,
    "Library",
    "Application Support",
    "Claude",
    "local-agent-mode-sessions",
    accountUuid,
    organizationUuid,
    coworkSessionId
  );
  const transcriptPath = options.transcriptUnderSession === false
    ? path.join(tmpDir, ".claude", "projects", "cwd", `${cliSessionId}.jsonl`)
    : path.join(
        sessionDir,
        ".claude",
        "projects",
        "cwd",
        `${cliSessionId}.jsonl`
      );

  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(transcriptPath, "{}\n", "utf-8");

  if (options.sourceA !== undefined) {
    writeJson(path.join(path.dirname(sessionDir), `${coworkSessionId}.json`), options.sourceA);
  }
  if (options.sourceB !== undefined) {
    writeJson(path.join(sessionDir, ".claude", ".claude.json"), options.sourceB);
  }

  return {
    session_id: cliSessionId,
    transcript_path: transcriptPath,
    cwd: path.join(sessionDir, "outputs"),
  };
}

describe("getUsername", () => {
  it("returns a non-empty string", () => {
    const u = getUsername();
    expect(typeof u).toBe("string");
    expect(u.length).toBeGreaterThan(0);
  });
});

describe("resolveUploadIdentity", () => {
  it("uses Cowork Source A email and accountName as the primary identity", () => {
    const input = coworkLayout({
      sourceA: {
        emailAddress: "person@example.com",
        accountName: "Person Account",
        cliSessionId: "cli-session-1",
      },
      sourceB: {
        oauthAccount: {
          emailAddress: "person@example.com",
          accountUuid: "acc-11111111-2222-3333-4444-555555555555",
          organizationUuid: "org-11111111-2222-3333-4444-555555555555",
          displayName: "Person Display",
          organizationName: "Example Org",
          organizationType: "team",
          seatTier: "pro",
          billingType: "invoice",
        },
      },
    });

    const identity = resolveUploadIdentity(input);
    expect(identity.rawUserId).toBe("person@example.com");
    expect(identity.metadata.source).toBe("cowork_sidecar");
    if (identity.metadata.source !== "cowork_sidecar") throw new Error("bad source");
    expect(identity.metadata.emailAddress).toBe("person@example.com");
    expect(identity.metadata.accountName).toBe("Person Account");
    expect(identity.metadata.displayName).toBe("Person Display");
    expect(identity.metadata.organizationName).toBe("Example Org");
    expect(identity.metadata.sourceA).toMatchObject({
      present: true,
      parsed: true,
      cliSessionId: "cli-session-1",
      cliSessionIdMatchesHook: true,
    });
    expect(identity.metadata.diagnostics).toEqual([]);
  });

  it("falls back to Cowork Source B oauthAccount when Source A has no email", () => {
    const input = coworkLayout({
      sourceA: { accountName: "No Email", cliSessionId: "cli-session-1" },
      sourceB: {
        oauthAccount: {
          emailAddress: "oauth@example.com",
          accountUuid: "acc-11111111-2222-3333-4444-555555555555",
          organizationUuid: "org-11111111-2222-3333-4444-555555555555",
        },
      },
    });

    const identity = resolveUploadIdentity(input);
    expect(identity.rawUserId).toBe("oauth@example.com");
    expect(identity.metadata.source).toBe("cowork_sidecar");
    if (identity.metadata.source !== "cowork_sidecar") throw new Error("bad source");
    expect(identity.metadata.accountUuid).toBe(
      "acc-11111111-2222-3333-4444-555555555555"
    );
    expect(identity.metadata.organizationUuid).toBe(
      "org-11111111-2222-3333-4444-555555555555"
    );
    expect(identity.metadata.sourceB).toMatchObject({
      present: true,
      parsed: true,
      hasOauthAccount: true,
    });
  });

  it("records cliSessionId mismatches as Cowork diagnostics without failing", () => {
    const input = coworkLayout({
      sourceA: {
        emailAddress: "person@example.com",
        cliSessionId: "different-cli-session",
      },
    });

    const identity = resolveUploadIdentity(input);
    expect(identity.rawUserId).toBe("person@example.com");
    expect(identity.metadata.source).toBe("cowork_sidecar");
    if (identity.metadata.source !== "cowork_sidecar") throw new Error("bad source");
    expect(identity.metadata.sourceA.cliSessionIdMatchesHook).toBe(false);
    expect(identity.metadata.diagnostics).toContain(
      "cowork_cli_session_id_mismatch"
    );
  });

  it("records Source A and Source B email mismatches as diagnostics", () => {
    const input = coworkLayout({
      sourceA: {
        emailAddress: "source-a@example.com",
        cliSessionId: "cli-session-1",
      },
      sourceB: {
        oauthAccount: {
          emailAddress: "source-b@example.com",
          accountUuid: "acc-11111111-2222-3333-4444-555555555555",
          organizationUuid: "org-11111111-2222-3333-4444-555555555555",
        },
      },
    });

    const identity = resolveUploadIdentity(input);
    expect(identity.rawUserId).toBe("source-a@example.com");
    expect(identity.metadata.source).toBe("cowork_sidecar");
    if (identity.metadata.source !== "cowork_sidecar") throw new Error("bad source");
    expect(identity.metadata.sourceA.emailAddress).toBe("source-a@example.com");
    expect(identity.metadata.sourceB.emailAddress).toBe("source-b@example.com");
    expect(identity.metadata.diagnostics).toContain(
      "cowork_email_address_mismatch"
    );
  });

  it("detects Cowork from cwd outputs fallback when transcript_path lacks local_*", () => {
    const input = coworkLayout({
      transcriptUnderSession: false,
      sourceA: { emailAddress: "cwd@example.com", cliSessionId: "cli-session-1" },
    });

    const identity = resolveUploadIdentity(input);
    expect(identity.rawUserId).toBe("cwd@example.com");
    expect(identity.metadata.source).toBe("cowork_sidecar");
  });

  it("preserves non-Cowork host identity fallback behavior", () => {
    const identity = resolveUploadIdentity({
      session_id: "cli-session-1",
      transcript_path: path.join(tmpDir, ".claude", "projects", "cwd", "cli-session-1.jsonl"),
      cwd: tmpDir,
    });

    expect(identity.rawUserId).toBeTruthy();
    expect(identity.metadata.source).not.toBe("cowork_sidecar");
  });

  it("does not treat arbitrary local_* transcript ancestors as Cowork", () => {
    const identity = resolveUploadIdentity({
      session_id: "cli-session-1",
      transcript_path: path.join(
        tmpDir,
        "work",
        "local_project",
        ".claude",
        "projects",
        "cwd",
        "cli-session-1.jsonl"
      ),
      cwd: path.join(tmpDir, "work", "local_project"),
    });

    expect(identity.rawUserId).toBeTruthy();
    expect(identity.metadata.source).not.toBe("cowork_sidecar");
  });

  it("does not use host identity for Cowork when sidecars are missing", () => {
    const input = coworkLayout();
    const identity = resolveUploadIdentity(input);
    expect(identity.rawUserId).toBe("cowork-acc-1111");
    expect(identity.metadata.source).toBe("cowork_sidecar");
    if (identity.metadata.source !== "cowork_sidecar") throw new Error("bad source");
    expect(identity.metadata.emailAddress).toBeUndefined();
    expect(identity.metadata.diagnostics).toEqual([
      "cowork_source_a_missing",
      "cowork_source_b_missing",
    ]);
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
