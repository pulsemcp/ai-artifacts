"use strict";
/**
 * Agent adapter interface.
 *
 * Each coding agent (Claude Code, Cursor, etc.) stores session transcripts
 * differently. Adapters encapsulate the agent-specific logic for discovering
 * and collecting all files that belong to a session.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdapter = createAdapter;
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createAdapter(agent) {
    switch (agent) {
        case "claude": {
            // Lazy require to avoid circular deps and keep the factory lightweight.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { ClaudeAdapter } = require("./claude");
            return new ClaudeAdapter();
        }
        default:
            throw new Error(`Unknown agent adapter: "${agent}". Supported: claude`);
    }
}
