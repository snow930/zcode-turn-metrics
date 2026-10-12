import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  formatCompactStopBanner,
  fmtMs,
  fmtPct,
  fmtTok,
  fmtTps,
  querySessionTurns,
  resolveZCodeDbPath,
} from "./metrics-core.mjs";

const MARKER = "<!-- zcode-turn-metrics -->";

function appendFooterToLastTextPart(sessionId, turnSummary, banner) {
  try {
    const dbPath = resolveZCodeDbPath();
    const db = new DatabaseSync(dbPath, { open: true });
    try {
      db.exec("PRAGMA busy_timeout = 2000");
      let partRow = null;
      if (turnSummary.lastAssistantMessageId) {
        partRow = db.prepare(`
          SELECT id, data FROM part
          WHERE session_id = ? AND message_id = ? AND json_extract(data, '$.type') = 'text'
          ORDER BY sequence DESC, time_created DESC LIMIT 1
        `).get(sessionId, turnSummary.lastAssistantMessageId);
      }
      if (!partRow) {
        partRow = db.prepare(`
          SELECT id, data FROM part
          WHERE session_id = ? AND json_extract(data, '$.type') = 'text'
          ORDER BY time_created DESC LIMIT 1
        `).get(sessionId);
      }
      if (!partRow) return;
      const dataObj = JSON.parse(partRow.data);
      if (typeof dataObj.text !== "string" || dataObj.text.includes(MARKER)) return;

      const footer = `\n\n---\n${MARKER}\n> 📊 **本轮指标** ｜ ${banner}`;
      dataObj.text = dataObj.text.trimEnd() + footer;
      db.prepare("UPDATE part SET data = ?, time_updated = ? WHERE id = ?").run(
        JSON.stringify(dataObj),
        Date.now(),
        partRow.id,
      );
    } finally {
      db.close();
    }
  } catch {
    // 数据库忙或只读时静默跳过，不影响实时 Hook 弹窗显示
  }
}

function main() {
  let hookInput = {};
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (raw) hookInput = JSON.parse(raw);
  } catch {}

  const sessionId = hookInput.session_id || hookInput.sessionId || process.env.CLAUDE_SESSION_ID || "";
  const { sessionId: resolvedSessionId, turns } = querySessionTurns(sessionId, 5);
  if (!turns.length) {
    process.exit(0);
  }

  const targetTurnId = hookInput.turnId || hookInput.turn_id;
  const currentTurn = (targetTurnId && turns.find((t) => t.turnId === targetTurnId)) || turns[turns.length - 1];
  const banner = formatCompactStopBanner(currentTurn);

  if (resolvedSessionId) {
    appendFooterToLastTextPart(resolvedSessionId, currentTurn, banner);
  }

  // 输出 Stop Hook 结构：使用 decision:"block" + stopReason（不带 reason/systemMessage/additionalContext）
  // 这样 ZCode 既不会触发模型继续生成，也不会报错，且在每轮底部的 Hook 图标弹窗中直接展示完整指标！
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      stopReason: banner,
    }) + "\n",
  );
}

main();
