import * as fs from "fs";
import * as path from "path";
import { BackendConfig } from "./backends/interface";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedactionPattern {
  name: string;
  pattern: string;
  replacement?: string;
}

export interface PrivacyConfig {
  mode: "full" | "redacted";
  org_salt: string;
  extra_patterns?: RedactionPattern[];
}

export interface TraceCaptureConfig {
  enabled: boolean;
  agent: string;
  backend: BackendConfig;
  privacy: PrivacyConfig;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Resolve the config file path. Checks $CLAUDE_PROJECT_DIR first, then falls
 * back to the cwd provided by the hook input.
 */
function resolveConfigPath(cwd: string): string {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  return path.join(projectDir, ".claude", "trace-capture.json");
}

/**
 * Load and validate the trace-capture config.
 * Returns null if the config file does not exist (hook is simply not configured).
 * Throws on malformed config so the error surfaces loudly.
 */
export function loadConfig(cwd: string): TraceCaptureConfig | null {
  const configPath = resolveConfigPath(cwd);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `trace-capture config is not valid JSON: ${configPath}`
    );
  }

  // --- enabled ---
  if (typeof parsed.enabled !== "boolean") {
    throw new Error("trace-capture config: 'enabled' must be a boolean");
  }

  // --- agent (optional, defaults to "claude") ---
  const agent =
    typeof parsed.agent === "string" ? parsed.agent : "claude";

  // --- backend ---
  const backend = parsed.backend as Record<string, unknown> | undefined;
  if (!backend || typeof backend !== "object") {
    throw new Error("trace-capture config: 'backend' is required");
  }
  if (typeof backend.type !== "string" || !backend.type) {
    throw new Error("trace-capture config: 'backend.type' is required");
  }
  if (typeof backend.bucket !== "string" || !backend.bucket) {
    throw new Error("trace-capture config: 'backend.bucket' is required");
  }
  if (
    typeof (backend as Record<string, unknown>).bucket === "string" &&
    (backend.bucket as string).startsWith("gs://")
  ) {
    throw new Error(
      "trace-capture config: 'backend.bucket' should be just the bucket name, not a gs:// URI"
    );
  }
  const prefix =
    typeof backend.prefix === "string" ? backend.prefix : "";

  // --- privacy ---
  const privacy = parsed.privacy as Record<string, unknown> | undefined;
  if (!privacy || typeof privacy !== "object") {
    throw new Error("trace-capture config: 'privacy' is required");
  }
  if (privacy.mode !== "full" && privacy.mode !== "redacted") {
    throw new Error(
      "trace-capture config: 'privacy.mode' must be 'full' or 'redacted'"
    );
  }
  if (
    privacy.mode === "redacted" &&
    (typeof privacy.org_salt !== "string" || !privacy.org_salt)
  ) {
    throw new Error(
      "trace-capture config: 'privacy.org_salt' is required when mode is 'redacted'"
    );
  }

  const extraPatterns: RedactionPattern[] = [];
  if (Array.isArray(privacy.extra_patterns)) {
    for (const p of privacy.extra_patterns) {
      if (
        typeof p === "object" &&
        p !== null &&
        typeof (p as Record<string, unknown>).name === "string" &&
        typeof (p as Record<string, unknown>).pattern === "string"
      ) {
        extraPatterns.push(p as RedactionPattern);
      }
    }
  }

  return {
    enabled: parsed.enabled,
    agent,
    backend: {
      type: backend.type as string,
      bucket: backend.bucket as string,
      prefix,
    },
    privacy: {
      mode: privacy.mode as "full" | "redacted",
      org_salt: (privacy.org_salt as string) || "",
      extra_patterns: extraPatterns,
    },
  };
}
