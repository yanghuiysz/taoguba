# 创业板主要下探独立模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有下探统计的前提下，新增“下跌 0.8% 确认、反弹 0.8% 确认”的主要下探趋势图、汇总表和明细表。

**Architecture:** 后端以 1 分钟价格运行独立 ZigZag 状态机，并将结果写入每日 `majorDips` 与聚合字段。前端只消费这些新增字段，单独渲染趋势图、汇总表和可展开明细，不复用或修改现有 `dips` 的含义。

**Tech Stack:** Python 3 标准库、JSON、原生 JavaScript、SVG、CSS、Playwright。

## Global Constraints

- 下跌确认阈值固定为 `0.8%`。
- 反弹确认阈值固定为 `0.8%`。
- 收盘仍未反弹 0.8% 的波段标记为 `收盘未确认`。
- 现有 `dips`、下探趋势图、汇总表、收复率和强弱判断不得改变。
- 新字段缺失时页面安全降级为 `—` 或不显示数据点。

---

### Task 1: 主要下探计算与数据输出

**Files:**
- Modify: `scripts/build_cyb_trend_stats.py`
- Modify: `scripts/test_cyb_strength_system.py`

**Interfaces:**
- Produces: `detect_major_dips(bars, decline_threshold=0.8, rebound_threshold=0.8) -> list[dict]`
- Produces daily fields: `majorDipCount`, `majorDipMaxDepth`, `majorDipAvgDepth`, `majorDipConfirmedCount`, `majorDipOpenCount`, `majorDips`.

- [ ] 写测试：0.79% 不确认、0.8% 确认、反弹 0.8% 完成、收盘未完成、多个波段。
- [ ] 运行目标测试并确认因函数缺失而失败。
- [ ] 实现最小状态机和日聚合字段。
- [ ] 运行完整后端测试并确认通过。

### Task 2: 独立趋势图和表格

**Files:**
- Modify: `web/custom.js`
- Modify: `web/custom.css`
- Modify: `scripts/test_trend_stats_table_layout.py`

**Interfaces:**
- Consumes: Task 1 的每日主要下探字段。
- Produces: 独立主要下探 SVG、日汇总表、展开式逐波段明细表。

- [ ] 先扩展浏览器测试，要求出现模块标题、图表、六列表头和六列明细。
- [ ] 运行测试并确认旧页面失败。
- [ ] 实现趋势图：次数柱状、最大深度折线、未确认空心标记。
- [ ] 实现汇总表与明细表，保持现有模块不变。
- [ ] 添加响应式样式并通过 1180、901、900、768 像素检查。

### Task 3: 数据重建与完整验证

**Files:**
- Modify: `web/data/cyb_trend_stats.json`
- Modify/Create: `web/data/cyb_trend_stats_history/` 中实际重算日期文件

- [ ] 拉取最近 5 个交易日完整分钟数据并重算。
- [ ] 验证 8 月 12、13、14 日主要下探结果存在且数据完整。
- [ ] 运行后端测试、JSON 校验、JavaScript 语法和浏览器布局测试。
- [ ] 运行 `git diff --check`，不暂存用户原有改动。
