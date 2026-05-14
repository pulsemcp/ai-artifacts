"use strict";
/**
 * Claude Code agent adapter.
 *
 * Claude Code stores session data in a predictable filesystem layout:
 *
 *   ~/.claude/projects/{project}/
 *     {session-uuid}.jsonl                    # Parent transcript
 *     {session-uuid}/
 *       subagents/
 *         agent-{id}.jsonl                    # Subagent transcripts
 *         agent-{id}.meta.json               # Subagent metadata (type, description)
 *       tool-results/
 *         toolu_{id}.txt                      # Externalized large tool outputs (>~20KB)
 *
 * All Claude-specific knowledge lives in this file.
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
exports.ClaudeAdapter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Glob-like helper: list files in a directory matching a test function. */
function listFiles(dir, test) {
    if (!fs.existsSync(dir))
        return [];
    try {
        return fs
            .readdirSync(dir)
            .filter((name) => {
            const full = path.join(dir, name);
            return fs.statSync(full).isFile() && test(name);
        })
            .map((name) => path.join(dir, name));
    }
    catch {
        return [];
    }
}
class ClaudeAdapter {
    name = "claude";
    async collectSession(hookInput) {
        const transcriptPath = hookInput.transcript_path;
        const sessionId = hookInput.session_id;
        const files = [];
        // -----------------------------------------------------------------------
        // 1. Parent transcript
        // -----------------------------------------------------------------------
        if (!fs.existsSync(transcriptPath)) {
            throw new Error(`Parent transcript not found: ${transcriptPath}`);
        }
        files.push({
            archivePath: "transcript.jsonl",
            content: fs.readFileSync(transcriptPath),
            redactable: true,
        });
        // -----------------------------------------------------------------------
        // 2. Session directory (strip .jsonl to get the companion dir)
        // -----------------------------------------------------------------------
        const sessionDir = transcriptPath.replace(/\.jsonl$/, "");
        // -----------------------------------------------------------------------
        // 3. Subagent transcripts + metadata
        // -----------------------------------------------------------------------
        const subagentsDir = path.join(sessionDir, "subagents");
        for (const filePath of listFiles(subagentsDir, (n) => n.endsWith(".jsonl"))) {
            files.push({
                archivePath: `subagents/${path.basename(filePath)}`,
                content: fs.readFileSync(filePath),
                redactable: true,
            });
        }
        for (const filePath of listFiles(subagentsDir, (n) => n.endsWith(".meta.json"))) {
            files.push({
                archivePath: `subagents/${path.basename(filePath)}`,
                content: fs.readFileSync(filePath),
                redactable: false, // metadata only contains agent type + description
            });
        }
        // -----------------------------------------------------------------------
        // 4. Externalized tool results
        // -----------------------------------------------------------------------
        const toolResultsDir = path.join(sessionDir, "tool-results");
        for (const filePath of listFiles(toolResultsDir, (n) => n.endsWith(".txt"))) {
            files.push({
                archivePath: `tool-results/${path.basename(filePath)}`,
                content: fs.readFileSync(filePath),
                redactable: true,
            });
        }
        return { sessionId, files };
    }
}
exports.ClaudeAdapter = ClaudeAdapter;
