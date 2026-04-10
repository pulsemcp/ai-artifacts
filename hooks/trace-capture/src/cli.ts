/**
 * CLI for managing trace-capture uploads.
 *
 * Usage:
 *   node dist/cli.js list [--all] [-n <count>]
 *   node dist/cli.js delete <session-id>
 *   node dist/cli.js help
 */

import { readRecords, findBySessionId, appendRecord, UploadRecord } from "./manifest";
import { loadConfig } from "./config";
import { createBackend } from "./backends/interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}`;
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface ListOptions {
  all: boolean;
  count: number;
}

export function formatList(records: UploadRecord[], opts: ListOptions): string {
  let filtered = opts.all
    ? records
    : records.filter((r) => r.status !== "deleted");

  if (filtered.length === 0) {
    return "No uploads found.";
  }

  const shown = filtered.slice(0, opts.count);
  const lines: string[] = [];

  // Header.
  lines.push(
    `${"SESSION".padEnd(14)} ${"UPLOADED".padEnd(17)} ${"STATUS".padEnd(9)} URI`
  );
  lines.push("-".repeat(80));

  for (const r of shown) {
    const status = r.status === "deleted" ? "deleted" : "uploaded";
    lines.push(
      `${shortId(r.session_id).padEnd(14)} ${formatTimestamp(r.timestamp).padEnd(17)} ${status.padEnd(9)} ${r.gcs_uri}`
    );
  }

  if (filtered.length > opts.count) {
    lines.push(
      `\n... and ${filtered.length - opts.count} more. Use -n to show more.`
    );
  }

  return lines.join("\n");
}

function cmdList(args: string[]): void {
  let all = false;
  let count = 25;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      all = true;
    } else if (args[i] === "-n" && i + 1 < args.length) {
      count = parseInt(args[i + 1], 10) || 25;
      i++;
    }
  }

  const records = readRecords();
  console.log(formatList(records, { all, count }));
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

export interface DeleteResult {
  success: boolean;
  message: string;
}

export async function performDelete(
  sessionPrefix: string,
  backend: { delete(key: string): Promise<{ success: boolean; error?: string; details?: string }> }
): Promise<DeleteResult> {
  const record = findBySessionId(sessionPrefix);
  if (!record) {
    return { success: false, message: `No upload found matching "${sessionPrefix}".` };
  }

  if (record.status === "deleted") {
    return { success: false, message: `Session ${record.session_id} was already deleted.` };
  }

  const result = await backend.delete(record.gcs_key);
  if (!result.success) {
    return {
      success: false,
      message: `Failed to delete from storage: ${result.error}${result.details ? " — " + result.details : ""}`,
    };
  }

  appendRecord({
    ...record,
    status: "deleted",
    deleted_at: new Date().toISOString(),
  });

  return { success: true, message: `Deleted session ${record.session_id} from ${record.gcs_uri}` };
}

async function cmdDelete(args: string[]): Promise<void> {
  const sessionPrefix = args[0];
  if (!sessionPrefix) {
    console.error("Usage: delete <session-id>");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.error("trace-capture is not configured (no trace-capture.json found).");
    process.exit(1);
  }

  const backend = createBackend(config.backend);

  try {
    const result = await performDelete(sessionPrefix, backend);
    if (result.success) {
      console.log(result.message);
    } else {
      console.error(result.message);
      process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

function cmdHelp(): void {
  console.log(`trace-capture CLI

Usage:
  node dist/cli.js <command> [options]

Commands:
  list [--all] [-n <count>]   List recent uploads (default: 25, hides deleted)
  delete <session-id>         Delete a session archive from storage
  help                        Show this help message

Examples:
  node dist/cli.js list
  node dist/cli.js list --all -n 50
  node dist/cli.js delete 5f1a4e51`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "list":
      cmdList(args);
      break;
    case "delete":
      await cmdDelete(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      cmdHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
