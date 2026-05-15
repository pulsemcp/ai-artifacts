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

export interface S3NoAuthConfig {
  provider: "s3";
  bucket: string;
  namespace_key: string;
  region: string;
  /** Hard cap on the tar.gz size before uploading, in bytes. Default 50 MB. */
  max_archive_bytes?: number;
}

export interface GcsNoAuthConfig {
  provider: "gcs";
  bucket: string;
  /** Hard cap on the tar.gz size before uploading, in bytes. Default 50 MB. */
  max_archive_bytes?: number;
}

export type NoAuthModeConfig = S3NoAuthConfig | GcsNoAuthConfig;

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

// For GCS, the secret lives in the bucket name itself. The bucket must end
// with the secret suffix so the self-documenting "secret-do-not-share-" marker
// is preserved end-to-end.
export const GCS_BUCKET_SUFFIX_PATTERN = /secret-do-not-share-[a-f0-9]{12,}$/;

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

  let noAuthConfig: NoAuthModeConfig;
  if (provider === "gcs") {
    // For GCS, the namespace secret is embedded in the bucket name itself
    // (see hooks/agent-transcript-capture/src/backends/gcs-no-auth.ts). A
    // separate namespace_key field would be redundant — reject it loudly so
    // the config doesn't encode the same secret twice.
    if (noAuth.namespace_key !== undefined) {
      throw new Error(
        "agent-transcript-capture config: 'no_auth.namespace_key' must NOT be set when provider is 'gcs'. " +
          "For GCS, the namespace secret is embedded in the bucket name itself (no separate field). " +
          "Remove the 'namespace_key' field. See README for details."
      );
    }
    if (process.env.STORAGE_NAMESPACE_KEY !== undefined) {
      throw new Error(
        "agent-transcript-capture config: the STORAGE_NAMESPACE_KEY env var is set, but it is unused when provider is 'gcs'. " +
          "For GCS, the namespace secret is embedded in the bucket name itself. Unset STORAGE_NAMESPACE_KEY. " +
          "See README for details."
      );
    }
    if (!GCS_BUCKET_SUFFIX_PATTERN.test(noAuth.bucket)) {
      throw new Error(
        "agent-transcript-capture config: GCS bucket name must end with " +
          "'secret-do-not-share-<12+ hex chars>' " +
          "(e.g., 'agent-transcripts-secret-do-not-share-a1b2c3d4e5f6'). " +
          "Generate the suffix with: echo \"secret-do-not-share-$(openssl rand -hex 16)\". " +
          "See README for details."
      );
    }
    noAuthConfig = {
      provider: "gcs",
      bucket: noAuth.bucket,
      max_archive_bytes: maxArchiveBytes,
    };
  } else {
    // S3: namespace_key sourcing — env var wins (so HOOK.json can be checked
    // in with a placeholder), then the config field.
    const envKey = process.env.STORAGE_NAMESPACE_KEY;
    const cfgKey = typeof noAuth.namespace_key === "string" ? noAuth.namespace_key : "";
    const namespaceKey = envKey && envKey.length > 0 ? envKey : cfgKey;

    if (!namespaceKey) {
      throw new Error(
        "agent-transcript-capture config: 'no_auth.namespace_key' (or env STORAGE_NAMESPACE_KEY) is required when provider is 's3'"
      );
    }
    if (!NAMESPACE_KEY_PATTERN.test(namespaceKey)) {
      throw new Error(
        "agent-transcript-capture config: 'namespace_key' must match " +
          "^secret-do-not-share-[a-f0-9]{12,}$. " +
          "Generate one with: echo \"secret-do-not-share-$(openssl rand -hex 16)\""
      );
    }
    if (typeof noAuth.region !== "string" || !noAuth.region) {
      throw new Error(
        "agent-transcript-capture config: 'no_auth.region' is required when provider is 's3'"
      );
    }
    noAuthConfig = {
      provider: "s3",
      bucket: noAuth.bucket,
      namespace_key: namespaceKey,
      region: noAuth.region,
      max_archive_bytes: maxArchiveBytes,
    };
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
    no_auth: noAuthConfig,
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
  if (noAuth.provider === "s3") {
    return {
      provider: "s3",
      bucket: noAuth.bucket,
      namespace_key: noAuth.namespace_key,
      region: noAuth.region,
    };
  }
  return {
    provider: "gcs",
    bucket: noAuth.bucket,
  };
}
