---
name: turn-metrics
description: 当用户需要查看或分析 ZCode 每轮会话的预读取（Prefill / PP）、解码（Decode / TG）、TTFT（首字延迟）、KV 缓存命中率或本地 llama-server 硬件级吞吐速度时使用此技能。
---

# Turn Metrics（每轮预读取 / 解码 / TTFT 指标）

本插件通过三种方式在 ZCode 中展示每轮会话的 **TTFT（首字时间）**、**预读取（Prefill / PP）** 与 **解码（Decode / TG）**：

1. **每轮结束自动展示（`Stop` Hook）**：
   - 每轮回复完成时自动触发 `scripts/stop-turn-metrics.mjs`。
   - **实时视图**：在每轮回复右下角的 Hook 气泡弹窗中直接显示本轮及末步的 `⏱ TTFT ｜ ⚡ 预读取 (tok & tok/s & 缓存命中率) ｜ 🚀 解码 (tok & tok/s & 耗时)`。
   - **持久化正文页脚**：同时将指标条追加写入该轮回复在 `db.sqlite` `part` 表的末尾，重新打开或切换会话时在回复正文底部直接可见。
2. **随时按需拉取完整表格（MCP 工具 `get_turn_metrics` / 斜杠命令 `/turn-metrics:metrics`）**：
   - 调用 `get_turn_metrics` 工具或运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli-report.mjs"` 输出最近 N 轮的汇总表格与最新一轮的逐步骤（Step 1, Step 2...）明细。
3. **本地 `llama-server` 硬件日志自动关联**：
   - 当检测到本地模型时，自动解析 `F:\LocalLLM\logs` 下最新日志的真实增量 `prompt eval`、`eval` 与 MTP/DFlash 草稿接受率。
