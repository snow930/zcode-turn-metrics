import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_LLAMA_LOG_DIR = "F:\\LocalLLM\\logs";
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const PROMPT_EVAL_RE = /task\s+(\d+)\s*\|\s*prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*([\d.]+)\s*ms per token,\s*([\d.]+)\s*tokens per second\)/;
const EVAL_RE = /task\s+(\d+)\s*\|\s*eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens\s*\(\s*([\d.]+)\s*ms per token,\s*([\d.]+)\s*tokens per second\)/;
const DRAFT_RE = /task\s+(\d+)\s*\|\s*draft acceptance\s*=\s*([\d.]+)\s*\(\s*(\d+)\s*accepted\s*\/\s*(\d+)\s*generated\)(?:,\s*mean len\s*=\s*([\d.]+))?/;

export function resolveZCodeDbPath() {
  const candidates = [
    process.env.ZCODE_STORAGE_DIR ? join(process.env.ZCODE_STORAGE_DIR, "cli", "db", "db.sqlite") : "",
    "F:\\wendang\\ZCODE\\.zcode\\cli\\db\\db.sqlite",
    join(homedir(), ".zcode", "cli", "db", "db.sqlite"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`找不到 ZCode 数据库 db.sqlite（已检查: ${candidates.join(", ")}）`);
}

export function fmtMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  const rem = (s - m * 60).toFixed(1);
  return `${m}m${rem}s`;
}

export function fmtTok(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}K`;
  }
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function fmtTps(tps) {
  if (typeof tps !== "number" || !Number.isFinite(tps) || tps <= 0) return "—";
  return `${tps >= 100 ? tps.toFixed(1) : tps.toFixed(2)} t/s`;
}

export function fmtPct(p) {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0) return "0%";
  if (p >= 99.95 && p < 100) return "99.9%";
  return `${p >= 10 ? p.toFixed(1) : p.toFixed(2)}%`;
}

export function parseLlamaTasks(logDir = DEFAULT_LLAMA_LOG_DIR, minMtimeMs = 0) {
  try {
    if (!existsSync(logDir)) return [];
    const files = readdirSync(logDir)
      .filter((f) => f.endsWith(".log") && !f.startsWith("router-"))
      .map((f) => {
        const p = join(logDir, f);
        const st = statSync(p);
        return { p, mtimeMs: st.mtimeMs };
      })
      .filter((f) => f.mtimeMs >= minMtimeMs)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 2);
    if (!files.length) return [];
    const byTask = new Map();
    for (const f of files) {
      const lines = readFileSync(f.p, "utf8").split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.replace(ANSI_RE, "");
        if (!line.includes("slot ")) continue;
        let m;
        if ((m = PROMPT_EVAL_RE.exec(line))) {
          const t = byTask.get(m[1]) ?? { taskId: Number(m[1]) };
          t.promptMs = parseFloat(m[2]);
          t.promptTokens = parseInt(m[3], 10);
          t.promptTps = parseFloat(m[5]);
          byTask.set(m[1], t);
        } else if ((m = EVAL_RE.exec(line))) {
          const t = byTask.get(m[1]) ?? { taskId: Number(m[1]) };
          t.evalMs = parseFloat(m[2]);
          t.evalTokens = parseInt(m[3], 10);
          t.evalTps = parseFloat(m[5]);
          byTask.set(m[1], t);
        } else if ((m = DRAFT_RE.exec(line))) {
          const t = byTask.get(m[1]) ?? { taskId: Number(m[1]) };
          t.draftAcceptance = parseFloat(m[2]) * 100;
          t.draftAccepted = parseInt(m[3], 10);
          t.draftGenerated = parseInt(m[4], 10);
          if (m[5] !== undefined) t.draftMeanLen = parseFloat(m[5]);
          byTask.set(m[1], t);
        }
      }
    }
    return [...byTask.values()].filter((t) => t.evalTokens > 1);
  } catch {
    return [];
  }
}

export function normalizeStepRow(row) {
  const startedAt = Number(row.started_at || 0);
  const firstTokenAt = row.first_token_at ? Number(row.first_token_at) : null;
  const completedAt = row.completed_at ? Number(row.completed_at) : null;
  const durationMs = row.duration_ms != null ? Number(row.duration_ms) : (completedAt && startedAt ? Math.max(0, completedAt - startedAt) : null);
  const ttftMs = row.time_to_first_token_ms != null ? Number(row.time_to_first_token_ms) : (firstTokenAt && startedAt ? Math.max(0, firstTokenAt - startedAt) : null);
  const decodeMs = (completedAt && firstTokenAt)
    ? Math.max(0, completedAt - firstTokenAt)
    : (durationMs !== null && ttftMs !== null ? Math.max(0, durationMs - ttftMs) : null);

  const rawInput = Math.max(0, Number(row.input_tokens || 0));
  const cacheRead = Math.max(0, Number(row.cache_read_input_tokens || 0));
  const cacheWrite = Math.max(0, Number(row.cache_creation_input_tokens || 0));
  const outputTokens = Math.max(0, Number(row.output_tokens || 0));
  const reasoningTokens = Math.max(0, Number(row.reasoning_tokens || 0));
  const storedTotal = Math.max(0, Number(row.provider_total_tokens ?? row.computed_total_tokens ?? 0));

  let promptTokens = rawInput;
  let uncachedInput = rawInput;
  if (cacheRead + cacheWrite > 0) {
    if (rawInput >= cacheRead + cacheWrite && (storedTotal === 0 || Math.abs(storedTotal - (rawInput + outputTokens)) <= Math.abs(storedTotal - (rawInput + cacheRead + cacheWrite + outputTokens)))) {
      promptTokens = rawInput;
      uncachedInput = Math.max(0, rawInput - cacheRead - cacheWrite);
    } else {
      uncachedInput = rawInput;
      promptTokens = rawInput + cacheRead + cacheWrite;
    }
  }
  const prefillTokens = uncachedInput + cacheWrite;
  const ppTpsUncached = ttftMs && ttftMs > 0 && prefillTokens > 0 ? prefillTokens / (ttftMs / 1000) : null;
  const ppTpsTotal = ttftMs && ttftMs > 0 && promptTokens > 0 ? promptTokens / (ttftMs / 1000) : null;
  const tgTps = decodeMs && decodeMs > 0 && outputTokens > 0 ? outputTokens / (decodeMs / 1000) : null;
  const cacheHitPercent = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : 0;

  return {
    stepId: row.id,
    turnId: row.turn_id,
    assistantMessageId: row.assistant_message_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    startedAt,
    firstTokenAt,
    completedAt,
    durationMs,
    ttftMs,
    decodeMs,
    promptTokens,
    prefillTokens,
    uncachedInput,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens,
    reasoningTokens,
    totalTokens: promptTokens + outputTokens,
    ppTpsUncached,
    ppTpsTotal,
    tgTps,
    cacheHitPercent,
  };
}

export function aggregateTurnSteps(turnId, steps) {
  if (!steps.length) return null;
  let firstStepTtftMs = null;
  let totalTtftMs = 0;
  let ttftCount = 0;
  let totalDecodeMs = 0;
  let totalDurationMs = 0;
  let promptTokens = 0;
  let prefillTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  for (const s of steps) {
    if (s.ttftMs != null && s.ttftMs >= 0) {
      if (firstStepTtftMs === null) firstStepTtftMs = s.ttftMs;
      totalTtftMs += s.ttftMs;
      ttftCount += 1;
    }
    if (s.decodeMs != null && s.decodeMs >= 0) totalDecodeMs += s.decodeMs;
    if (s.durationMs != null && s.durationMs >= 0) totalDurationMs += s.durationMs;
    promptTokens += s.promptTokens;
    prefillTokens += s.prefillTokens;
    cacheReadTokens += s.cacheReadTokens;
    cacheWriteTokens += s.cacheWriteTokens;
    outputTokens += s.outputTokens;
    reasoningTokens += s.reasoningTokens;
  }
  const avgTtftMs = ttftCount > 0 ? totalTtftMs / ttftCount : null;
  const ppTpsUncached = totalTtftMs > 0 && prefillTokens > 0 ? prefillTokens / (totalTtftMs / 1000) : null;
  const ppTpsTotal = totalTtftMs > 0 && promptTokens > 0 ? promptTokens / (totalTtftMs / 1000) : null;
  const tgTps = totalDecodeMs > 0 && outputTokens > 0 ? outputTokens / (totalDecodeMs / 1000) : null;
  const cacheHitPercent = promptTokens > 0 ? (cacheReadTokens / promptTokens) * 100 : 0;
  const lastStep = steps[steps.length - 1];

  let llamaHw = null;
  const isLocal = steps.some((s) => /local|qwen|llama/i.test(s.providerId || "") || /\.gguf|qwen/i.test(s.modelId || ""));
  if (isLocal && steps[0].startedAt > 0) {
    const tasks = parseLlamaTasks(DEFAULT_LLAMA_LOG_DIR, steps[0].startedAt - 60_000);
    const matched = tasks.findLast((t) => Math.abs((t.evalTokens || 0) - lastStep.outputTokens) <= 3);
    if (matched) llamaHw = matched;
  }

  return {
    turnId,
    stepsCount: steps.length,
    providerId: lastStep.providerId,
    modelId: lastStep.modelId,
    lastAssistantMessageId: lastStep.assistantMessageId,
    startedAt: steps[0].startedAt,
    completedAt: lastStep.completedAt,
    firstStepTtftMs,
    avgTtftMs,
    totalTtftMs,
    totalDecodeMs,
    totalDurationMs,
    promptTokens,
    prefillTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    ppTpsUncached,
    ppTpsTotal,
    tgTps,
    cacheHitPercent,
    lastStep,
    steps,
    llamaHw,
  };
}

export function querySessionTurns(sessionId, limitTurns = 10) {
  const dbPath = resolveZCodeDbPath();
  const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
  try {
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const latest = db.prepare("SELECT session_id FROM model_usage ORDER BY started_at DESC LIMIT 1").get();
      targetSessionId = latest?.session_id;
    }
    if (!targetSessionId) return { sessionId: null, turns: [] };
    const rows = db.prepare(`
      SELECT id, turn_id, assistant_message_id, provider_id, model_id, status,
             started_at, first_token_at, completed_at, duration_ms, time_to_first_token_ms,
             input_tokens, output_tokens, reasoning_tokens,
             cache_creation_input_tokens, cache_read_input_tokens,
             provider_total_tokens, computed_total_tokens
      FROM model_usage
      WHERE session_id = ? AND query_source = 'main_turn'
      ORDER BY started_at ASC
    `).all(targetSessionId);

    const byTurn = new Map();
    for (const r of rows) {
      const tid = r.turn_id || `turn_${r.started_at}`;
      const list = byTurn.get(tid) ?? [];
      list.push(normalizeStepRow(r));
      byTurn.set(tid, list);
    }
    const turns = [];
    for (const [tid, stepList] of byTurn.entries()) {
      const agg = aggregateTurnSteps(tid, stepList);
      if (agg) turns.push(agg);
    }
    return {
      sessionId: targetSessionId,
      turns: limitTurns > 0 ? turns.slice(-limitTurns) : turns,
    };
  } finally {
    db.close();
  }
}

export function formatCompactStopBanner(t) {
  const ttftAvg = fmtMs(t.avgTtftMs ?? t.firstStepTtftMs);
  const ppAvg = fmtTps(t.ppTpsUncached ?? t.ppTpsTotal);
  const tgAvg = fmtTps(t.tgTps);
  const hwSuffix = t.llamaHw?.draftAcceptance != null
    ? ` · 草稿 ${t.llamaHw.draftAcceptance.toFixed(1)}%`
    : "";
  return `TTFT ${ttftAvg} · 预读取 ${ppAvg} · 解码 ${tgAvg}${hwSuffix}`;
}

export function formatCollapsibleTurnDetails(t, marker = "<!-- zcode-turn-metrics -->") {
  const ttftAvg = fmtMs(t.avgTtftMs ?? t.firstStepTtftMs);
  const ppAvg = fmtTps(t.ppTpsUncached ?? t.ppTpsTotal);
  const tgAvg = fmtTps(t.tgTps);
  const hwInline = t.llamaHw?.draftAcceptance != null
    ? ` · 草稿 <code>${t.llamaHw.draftAcceptance.toFixed(1)}%</code>`
    : "";
  const ls = t.lastStep;
  const cacheStr = `${fmtPct(t.cacheHitPercent)} (${fmtTok(t.cacheReadTokens)} / ${fmtTok(t.promptTokens)} tok)`;
  const ppDetail = `未缓存计算 <code>${fmtTok(t.prefillTokens)} tok</code> @ <b>${fmtTps(t.ppTpsUncached)}</b> · 总输入 <code>${fmtTok(t.promptTokens)} tok</code> @ <b>${fmtTps(t.ppTpsTotal)}</b> · 缓存命中 <code>${cacheStr}</code>`;
  const tgDetail = `输出 <code>${fmtTok(t.outputTokens)} tok</code>${t.reasoningTokens > 0 ? ` (思考 <code>${fmtTok(t.reasoningTokens)}</code>)` : ""} · 均速 <b>${fmtTps(t.tgTps)}</b> · 解码耗时 <code>${fmtMs(t.totalDecodeMs)}</code> · 总耗时 <code>${fmtMs(t.totalDurationMs)}</code>`;
  const ttftDetail = t.stepsCount > 1
    ? `均值 <b>${fmtMs(t.avgTtftMs)}</b> · 首步 <code>${fmtMs(t.firstStepTtftMs)}</code> · 末步 <code>${fmtMs(ls.ttftMs)}</code> · 累计 <code>${fmtMs(t.totalTtftMs)}</code>（共 ${t.stepsCount} 步）`
    : `耗时 <b>${fmtMs(t.firstStepTtftMs)}</b>（单步完成）`;

  const hwLine = t.llamaHw
    ? `<li><b>本地硬件实测</b>：增量预读取 <code>${fmtTok(t.llamaHw.promptTokens)} tok</code> @ <b>${fmtTps(t.llamaHw.promptTps)}</b> (${fmtMs(t.llamaHw.promptMs)}) · 硬件解码 <code>${fmtTok(t.llamaHw.evalTokens)} tok</code> @ <b>${fmtTps(t.llamaHw.evalTps)}</b>${t.llamaHw.draftAcceptance != null ? ` · 草稿接受率 <b>${t.llamaHw.draftAcceptance.toFixed(1)}%</b>${t.llamaHw.draftMeanLen ? ` (L${t.llamaHw.draftMeanLen.toFixed(2)})` : ""}` : ""}</li>`
    : "";

  let stepTable = "";
  if (t.steps && t.steps.length > 1) {
    const rows = t.steps
      .map((s, i) => {
        const tgTok = s.reasoningTokens > 0 ? `${fmtTok(s.outputTokens)} (思${fmtTok(s.reasoningTokens)})` : fmtTok(s.outputTokens);
        return `<tr><td>#${i + 1}</td><td>${fmtMs(s.ttftMs)}</td><td>${fmtTok(s.prefillTokens)} / ${fmtTok(s.promptTokens)} (${fmtPct(s.cacheHitPercent)})</td><td>${fmtTps(s.ppTpsUncached)}</td><td>${tgTok}</td><td>${fmtTps(s.tgTps)} (${fmtMs(s.decodeMs)})</td></tr>`;
      })
      .join("");
    stepTable = `<table><thead><tr><th>步骤</th><th>TTFT</th><th>预读取 (未缓存/总 · 命中)</th><th>预读取速度</th><th>解码 Token</th><th>解码速度 (耗时)</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  return [
    `\n\n${marker}`,
    `<details><summary><b>本轮均值</b> · TTFT <code>${ttftAvg}</code> · 预读取 <code>${ppAvg}</code> · 解码 <code>${tgAvg}</code>${hwInline} (${t.stepsCount}步 · 点击展开)</summary>`,
    `<ul>`,
    `<li><b>TTFT (首字延迟)</b>：${ttftDetail}</li>`,
    `<li><b>预读取 (Prefill)</b>：${ppDetail}</li>`,
    `<li><b>解码 (Decode)</b>：${tgDetail}</li>`,
    hwLine,
    `</ul>`,
    stepTable,
    `</details>`,
  ]
    .filter(Boolean)
    .join("");
}
