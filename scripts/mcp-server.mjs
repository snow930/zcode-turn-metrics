import { createInterface } from "node:readline";
import {
  formatCompactStopBanner,
  fmtMs,
  fmtPct,
  fmtTok,
  fmtTps,
  querySessionTurns,
} from "./metrics-core.mjs";

export function formatTurnMetricsMarkdown(sessionId, limitTurns = 5, includeSteps = true) {
  const { sessionId: resolvedId, turns } = querySessionTurns(sessionId, limitTurns);
  if (!turns.length) {
    return "当前未查询到已完成的模型调用记录。";
  }

  const lines = [];
  lines.push(`### 📊 会话每轮性能指标 (\`${resolvedId}\`)`);
  lines.push("");
  lines.push("| 轮次 | 步数 | 首步 TTFT | 步均 TTFT | 预读取 (未缓存/总输入) | 缓存命中 | 预读取速度 (PP) | 解码 Token | 解码速度 (TG) | 解码耗时 | 模型总耗时 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");

  turns.forEach((t, idx) => {
    const turnLabel = `#${idx + 1}`;
    const ppCell = `${fmtTok(t.prefillTokens)} / ${fmtTok(t.promptTokens)}`;
    const ppSpeed = `${fmtTps(t.ppTpsUncached)} (总 ${fmtTps(t.ppTpsTotal)})`;
    const tgTok = t.reasoningTokens > 0 ? `${fmtTok(t.outputTokens)} (思 ${fmtTok(t.reasoningTokens)})` : fmtTok(t.outputTokens);
    lines.push(
      `| ${turnLabel} | ${t.stepsCount} | ${fmtMs(t.firstStepTtftMs)} | ${fmtMs(t.avgTtftMs)} | ${ppCell} | ${fmtPct(t.cacheHitPercent)} | ${ppSpeed} | ${tgTok} | ${fmtTps(t.tgTps)} | ${fmtMs(t.totalDecodeMs)} | ${fmtMs(t.totalDurationMs)} |`,
    );
  });

  const latest = turns[turns.length - 1];
  lines.push("");
  lines.push(`**最新一轮摘要**：${formatCompactStopBanner(latest)}`);

  if (includeSteps && latest.steps.length > 0) {
    lines.push("");
    lines.push(`#### 最新一轮逐步骤明细（共 ${latest.steps.length} 步，模型：\`${latest.providerId}/${latest.modelId}\`）`);
    lines.push("");
    lines.push("| 步骤 | TTFT (预读耗时) | 预读取 (计算/总输入) | 缓存命中 | 预读取速度 (计算 / 总) | 解码 Token | 解码速度 (耗时) | 单步耗时 |");
    lines.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
    latest.steps.forEach((s, i) => {
      const tgTok = s.reasoningTokens > 0 ? `${fmtTok(s.outputTokens)} (思 ${fmtTok(s.reasoningTokens)})` : fmtTok(s.outputTokens);
      lines.push(
        `| Step ${i + 1} | ${fmtMs(s.ttftMs)} | ${fmtTok(s.prefillTokens)} / ${fmtTok(s.promptTokens)} | ${fmtPct(s.cacheHitPercent)} | ${fmtTps(s.ppTpsUncached)} / ${fmtTps(s.ppTpsTotal)} | ${tgTok} | ${fmtTps(s.tgTps)} (${fmtMs(s.decodeMs)}) | ${fmtMs(s.durationMs)} |`,
      );
    });
  }

  return lines.join("\n");
}

const TOOLS = [
  {
    name: "get_turn_metrics",
    description:
      "查询当前或指定 ZCode 会话每轮的 TTFT（首字延迟）、预读取（Prefill Token 数、吞吐速度 tok/s、缓存命中率）和解码（Decode Token 数、解码速度 tok/s、耗时）明细。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "可选会话 ID（如 sess_xxx）；留空则自动取最新活跃会话。",
        },
        limitTurns: {
          type: "number",
          description: "返回的最近轮次数，默认 5。",
        },
        includeSteps: {
          type: "boolean",
          description: "是否附带最新一轮的逐步骤（Step）拆解表，默认 true。",
        },
      },
    },
  },
];

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;

    let result;
    let error;
    try {
      if (message.method === "initialize") {
        result = {
          protocolVersion: message.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "turn-metrics", version: "0.1.0" },
        };
      } else if (message.method === "tools/list") {
        result = { tools: TOOLS };
      } else if (message.method === "tools/call") {
        const name = message.params?.name;
        const args = message.params?.arguments || {};
        if (name === "get_turn_metrics") {
          const text = formatTurnMetricsMarkdown(
            args.sessionId || process.env.CLAUDE_SESSION_ID || "",
            typeof args.limitTurns === "number" ? args.limitTurns : 5,
            args.includeSteps !== false,
          );
          result = { content: [{ type: "text", text }] };
        } else {
          error = { code: -32601, message: `Unknown tool: ${name}` };
        }
      } else if (message.method === "ping") {
        result = {};
      } else {
        error = { code: -32601, message: `Method not found: ${message.method}` };
      }
    } catch (e) {
      error = { code: -32000, message: String(e?.message || e) };
    }

    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        ...(error ? { error } : { result }),
      }) + "\n",
    );
  }
}
