/**
 * Local JSONL manifest for tracking uploads.
 *
 * Each upload appends a record to ~/.trace-capture/uploads.jsonl.
 * Deletions append a new record with status "deleted" for the same session.
 * The last entry for a given session_id wins (append-only dedup).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadRecord {
  session_id: string;
  timestamp: string;
  gcs_key: string;
  gcs_uri: string;
  bucket: string;
  agent: string;
  status: "uploaded" | "deleted";
  deleted_at?: string;
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

export function manifestPath(): string {
  const home =
    process.env.TRACE_CAPTURE_HOME || path.join(os.homedir(), ".trace-capture");
  return path.join(home, "uploads.jsonl");
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function appendRecord(record: UploadRecord): void {
  const filePath = manifestPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read all records from the manifest, deduplicate by session_id (last entry
 * wins), and return sorted by timestamp descending (most recent first).
 */
export function readRecords(): UploadRecord[] {
  const filePath = manifestPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  // Last entry per session_id wins.
  const bySession = new Map<string, UploadRecord>();
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as UploadRecord;
      bySession.set(record.session_id, record);
    } catch {
      // Skip malformed lines.
    }
  }

  return Array.from(bySession.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Find a record by session ID prefix.  Throws if the prefix matches multiple
 * sessions (ambiguous).  Returns null if no match.
 */
export function findBySessionId(prefix: string): UploadRecord | null {
  const records = readRecords();
  const matches = records.filter((r) => r.session_id.startsWith(prefix));

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  throw new Error(
    `Ambiguous session ID prefix "${prefix}" — matches ${matches.length} sessions. ` +
      `Use a longer prefix. Matches:\n` +
      matches.map((m) => `  ${m.session_id}`).join("\n")
  );
}
