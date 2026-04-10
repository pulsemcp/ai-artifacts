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
  hash_user_identity: boolean;
  org_salt: string;
  extra_patterns?: RedactionPattern[];
}

export interface TraceCaptureConfig {
  enabled: boolean;
  backend: BackendConfig;
  privacy: PrivacyConfig;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Resolve the config file path.
 *
 * The config lives alongside the hook itself: trace-capture.json in the hook
 * root directory.  At runtime, dist/capture.js is one level down from the
 * hook root, so we resolve relative to __dirname's parent.
 *
 * When installed via a hook manager, the hook directory is copied into the
 * agent's workspace (e.g., .claude/hooks/trace-capture/).  The config file
 * travels with it.
 */
function resolveConfigPath(): string {
  // dist/capture.js -> hook root is one level up
  const hookRoot = path.resolve(__dirname, "..");
  return path.join(hookRoot, "trace-capture.json");
}

/**
 * Load and validate the trace-capture config.
 * Returns null if the config file does not exist (hook is not configured).
 * Throws on malformed config so the error surfaces loudly.
 */
export function loadConfig(): TraceCaptureConfig | null {
  const configPath = resolveConfigPath();

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
    typeof backend.bucket === "string" &&
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
  const hashUserIdentity = privacy.hash_user_identity === true;

  if (
    hashUserIdentity &&
    (typeof privacy.org_salt !== "string" || !privacy.org_salt)
  ) {
    throw new Error(
      "trace-capture config: 'privacy.org_salt' is required when hash_user_identity is true"
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
    backend: {
      type: backend.type as string,
      bucket: backend.bucket as string,
      prefix,
    },
    privacy: {
      mode: privacy.mode as "full" | "redacted",
      hash_user_identity: hashUserIdentity,
      org_salt: (privacy.org_salt as string) || "",
      extra_patterns: extraPatterns,
    },
  };
}
