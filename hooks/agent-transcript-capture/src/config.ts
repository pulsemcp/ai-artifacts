import * as fs from "fs";
import * as path from "path";
import { BackendConfig, StorageProvider } from "./backends/interface";

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
  extra_patterns?: RedactionPattern[];
}

export interface NoAuthModeConfig {
  provider: StorageProvider;
  bucket: string;
  namespace_key: string;
  region?: string;
  /** Hard cap on the tar.gz size before uploading, in bytes. Default 50 MB. */
  max_archive_bytes?: number;
}

export interface CaptureConfig {
  mode: "no-auth";
  no_auth: NoAuthModeConfig;
  privacy: PrivacyConfig;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The namespace_key prefix is self-documenting so it's obvious in logs, pastes,
// and screenshots. Same idea as -----BEGIN OPENSSH PRIVATE KEY-----.
export const NAMESPACE_KEY_PATTERN = /^secret-do-not-share-[a-f0-9]{12,}$/;

export const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function resolveHookJsonPath(): string {
  // dist/config.js -> hook root is one level up.
  const hookRoot = path.resolve(__dirname, "..");
  return path.join(hookRoot, "HOOK.json");
}

/**
 * Load and validate config from HOOK.json's "x-config" key.
 * Returns null if HOOK.json does not exist or has no "x-config" section.
 * Throws on malformed config so the error surfaces loudly.
 */
export function loadConfig(): CaptureConfig | null {
  const hookJsonPath = resolveHookJsonPath();

  if (!fs.existsSync(hookJsonPath)) {
    return null;
  }

  const raw = fs.readFileSync(hookJsonPath, "utf-8");
  let hookJson: Record<string, unknown>;
  try {
    hookJson = JSON.parse(raw);
  } catch {
    throw new Error(`HOOK.json is not valid JSON: ${hookJsonPath}`);
  }

  const parsed = hookJson["x-config"] as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  // --- mode ---
  const mode = parsed.mode;
  if (mode !== "no-auth") {
    throw new Error(
      `agent-transcript-capture config: 'mode' must be 'no-auth' (got: ${JSON.stringify(mode)})`
    );
  }

  // --- no_auth ---
  const noAuth = parsed.no_auth as Record<string, unknown> | undefined;
  if (!noAuth || typeof noAuth !== "object") {
    throw new Error("agent-transcript-capture config: 'no_auth' is required");
  }

  if (noAuth.provider !== "gcs" && noAuth.provider !== "s3") {
    throw new Error(
      "agent-transcript-capture config: 'no_auth.provider' must be 'gcs' or 's3'"
    );
  }
  const provider = noAuth.provider as StorageProvider;

  if (typeof noAuth.bucket !== "string" || !noAuth.bucket) {
    throw new Error("agent-transcript-capture config: 'no_auth.bucket' is required");
  }
  if (noAuth.bucket.startsWith("gs://") || noAuth.bucket.startsWith("s3://")) {
    throw new Error(
      "agent-transcript-capture config: 'no_auth.bucket' should be the bare bucket name, not a URI"
    );
  }

  // namespace_key sourcing: env var wins (so HOOK.json can be checked in with a
  // placeholder), then the config field.
  const envKey = process.env.STORAGE_NAMESPACE_KEY;
  const cfgKey = typeof noAuth.namespace_key === "string" ? noAuth.namespace_key : "";
  const namespaceKey = envKey && envKey.length > 0 ? envKey : cfgKey;

  if (!namespaceKey) {
    throw new Error(
      "agent-transcript-capture config: 'no_auth.namespace_key' (or env STORAGE_NAMESPACE_KEY) is required"
    );
  }
  if (!NAMESPACE_KEY_PATTERN.test(namespaceKey)) {
    throw new Error(
      "agent-transcript-capture config: 'namespace_key' must match " +
        "^secret-do-not-share-[a-f0-9]{12,}$. " +
        "Generate one with: echo \"secret-do-not-share-$(openssl rand -hex 16)\""
    );
  }

  let region: string | undefined;
  if (provider === "s3") {
    if (typeof noAuth.region !== "string" || !noAuth.region) {
      throw new Error(
        "agent-transcript-capture config: 'no_auth.region' is required when provider is 's3'"
      );
    }
    region = noAuth.region;
  }

  let maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES;
  if (noAuth.max_archive_bytes !== undefined) {
    if (
      typeof noAuth.max_archive_bytes !== "number" ||
      !Number.isFinite(noAuth.max_archive_bytes) ||
      noAuth.max_archive_bytes <= 0
    ) {
      throw new Error(
        "agent-transcript-capture config: 'no_auth.max_archive_bytes' must be a positive number"
      );
    }
    maxArchiveBytes = noAuth.max_archive_bytes;
  }

  // --- privacy ---
  const privacy = parsed.privacy as Record<string, unknown> | undefined;
  if (!privacy || typeof privacy !== "object") {
    throw new Error("agent-transcript-capture config: 'privacy' is required");
  }
  if (privacy.mode !== "full" && privacy.mode !== "redacted") {
    throw new Error(
      "agent-transcript-capture config: 'privacy.mode' must be 'full' or 'redacted'"
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
    mode: "no-auth",
    no_auth: {
      provider,
      bucket: noAuth.bucket,
      namespace_key: namespaceKey,
      region,
      max_archive_bytes: maxArchiveBytes,
    },
    privacy: {
      mode: privacy.mode as "full" | "redacted",
      extra_patterns: extraPatterns,
    },
  };
}

/**
 * Helper: derive a BackendConfig from a no-auth-mode config.
 */
export function toBackendConfig(noAuth: NoAuthModeConfig): BackendConfig {
  return {
    provider: noAuth.provider,
    bucket: noAuth.bucket,
    namespace_key: noAuth.namespace_key,
    region: noAuth.region,
  };
}
