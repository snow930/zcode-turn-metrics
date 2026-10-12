# zcode-turn-metrics (ZCode 每轮预读取 / 解码 / TTFT 性能指标插件)

在 ZCode 中自动统计并显示每轮会话（Turn）与每一步模型调用（Step）的：
- **TTFT（首字延迟）**：首步 TTFT、末步 TTFT、步均 TTFT 与整轮累计 TTFT。
- **预读取（Prefill / PP）**：未缓存实际计算 Token、总输入 Prompt Token、KV 缓存命中率、预读取吞吐速度（`t/s`）。
- **解码（Decode / TG）**：输出 Token（含推理思考 Token）、解码速度（`t/s`）与解码耗时。
- **本地 `llama-server` 硬件级增强**：自动匹配 `F:\LocalLLM\logs` 中的硬件 `prompt eval`、`eval` 与推测解码草稿接受率（MTP / DFlash `draft acceptance`）。

## 安装方法

1. 打开 ZCode 客户端 **插件市场（Plugin Marketplace）**。
2. 点击 **添加（Add）→ 添加插件市场（Add Plugin Marketplace）**。
3. 填入 GitHub 仓库地址：
   ```text
   https://github.com/snow930/zcode-turn-metrics
   ```
   （或本地市场目录 `F:\wendang\ZCODE\plugins`）。
4. 在 **个人（Personal）** 标签页下找到 **每轮性能指标 (预读取/解码/TTFT)**（`turn-metrics`），点击 **安装（Install）**。

## 组件构成

- **Hook (`Stop`)**：每轮会话结束时自动运行 `scripts/stop-turn-metrics.mjs`，在每轮回复右下角的 Hook 图标弹窗中实时显示本轮指标，并同步把指标栏写入该轮回复的持久消息页脚。
- **Command (`/turn-metrics:metrics`)**：一键打印当前会话最近各轮及最新一轮各步骤的完整 Markdown 性能报表。
- **MCP (`turn-metrics` -> `get_turn_metrics`)**：提供结构化工具查询任意会话的逐轮与逐步骤性能指标。
- **Skill (`turn-metrics`)**：支持在对话中直接要求查看或分析本轮/历史轮次的预读取、解码与 TTFT。

## 许可证

MIT
