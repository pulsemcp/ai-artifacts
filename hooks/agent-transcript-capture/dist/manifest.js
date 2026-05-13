"use strict";
/**
 * Local JSONL manifest for tracking uploads.
 *
 * Each upload appends a record to ~/.trace-capture/uploads.jsonl.
 * Deletions append a new record with status "deleted" for the same session.
 * The last entry for a given session_id wins (append-only dedup).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.manifestPath = manifestPath;
exports.appendRecord = appendRecord;
exports.readRecords = readRecords;
exports.findBySessionId = findBySessionId;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------
function manifestPath() {
    const home = process.env.TRACE_CAPTURE_HOME || path.join(os.homedir(), ".trace-capture");
    return path.join(home, "uploads.jsonl");
}
// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
function appendRecord(record) {
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
function readRecords() {
    const filePath = manifestPath();
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const lines = fs
        .readFileSync(filePath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0);
    // Last entry per session_id wins.
    const bySession = new Map();
    for (const line of lines) {
        try {
            const record = JSON.parse(line);
            bySession.set(record.session_id, record);
        }
        catch {
            // Skip malformed lines.
        }
    }
    return Array.from(bySession.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------
/**
 * Find a record by session ID prefix.  Throws if the prefix matches multiple
 * sessions (ambiguous).  Returns null if no match.
 */
function findBySessionId(prefix) {
    const records = readRecords();
    const matches = records.filter((r) => r.session_id.startsWith(prefix));
    if (matches.length === 0)
        return null;
    if (matches.length === 1)
        return matches[0];
    throw new Error(`Ambiguous session ID prefix "${prefix}" — matches ${matches.length} sessions. ` +
        `Use a longer prefix. Matches:\n` +
        matches.map((m) => `  ${m.session_id}`).join("\n"));
}
