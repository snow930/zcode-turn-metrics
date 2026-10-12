import { formatTurnMetricsMarkdown } from "./mcp-server.mjs";

const arg = process.argv[2] || "";
const limit = /^\d+$/.test(arg) ? parseInt(arg, 10) : 5;
const sessionId = /^\d+$/.test(arg) ? (process.env.CLAUDE_SESSION_ID || "") : arg;

console.log(formatTurnMetricsMarkdown(sessionId, limit, true));
