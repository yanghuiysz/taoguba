# 题材数据看板

这个项目用于在本地生成和查看题材数据看板，核心目标是把开盘啦板块强度、自定义板块波段状态、盘中机会雷达和交易记录放到同一个工作流里。

当前主要页面：

- `web/kpl.html`：开盘啦板块强度、板块映射和涨停池增强信息。
- `web/custom.html`：自定义板块、热门板块波段观察、趋势曲线、盘中雷达。
- `web/intraday.html`：盘中机会雷达，聚焦启动、良性回踩、退潮修复等可跟踪板块。
- `web/trades.html`：操作记录和持仓归集。

旧版公共题材源已经从代码和跟踪数据中移除。

## 环境准备

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

所有命令默认在仓库根目录执行：

```powershell
cd D:\github\taoguba
```

## 本地运行

普通静态查看：

```powershell
python -m http.server 8765
```

访问：

```text
http://127.0.0.1:8765/web/
```

需要在页面里编辑自定义板块时，使用可编辑服务：

```powershell
python .\scripts\serve_custom_boards.py --host 127.0.0.1 --port 8765
```

状态检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/custom-boards/status
```

正常返回类似：

```json
{"ok": true, "editable": true}
```

## 数据更新流程

### 完整日更

完整日更会刷新 KPL、KPL 板块个股关联、同花顺/东方财富映射增强、自定义板块数据，并运行校验。

```powershell
git pull --ff-only origin main
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
python .\scripts\validate_web_data.py
```

如果不是交易时间，通常可省略 `--full-during-trading`：

```powershell
python .\scripts\update_daily_data.py --date $date --intraday-custom
```

### 盘中雷达快刷

交易日盘中只需要刷新自定义板块实时行时，使用快刷模式：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --intraday-radar-only --custom-sleep 0
python .\scripts\validate_web_data.py
```

快刷模式只更新：

- `web/data/custom_boards.json`
- 每个自定义板块当天最新行
- 每只自定义板块成员股当天实时行
- 上证指数当天实时行

快刷模式不会更新：

- `web/data/kpl_dashboard.json`
- `web/data/kpl/index.json`
- `web/data/kpl/history/YYYYMMDD.json`
- `data/kpl_probe/`
- `data/kpl_linked/`
- `data/external/ths_limit_mapping/`

这是预期行为。盘中机会雷达主要依赖 `custom_boards.json`。

### 自动盘中快刷判断

`scripts/update_daily_data.py` 内置交易时间判断：

- 周一到周五
- 上午：`09:30-11:30`
- 下午：`13:00-15:05`

当目标日期是今天，并且当前时间在上述窗口内，且没有传 `--full-during-trading` 时，脚本会自动进入盘中雷达快刷模式，相当于：

```powershell
python .\scripts\update_daily_data.py --date $date --intraday-custom --intraday-radar-only --custom-sleep 0
```

如果交易时间内也要跑完整日更，明确加：

```powershell
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
```

## 常用参数

```powershell
python .\scripts\update_daily_data.py --date $date --intraday-custom --skip-kpl
python .\scripts\update_daily_data.py --date $date --skip-external --intraday-custom
python .\scripts\update_daily_data.py --date $date --skip-custom
python .\scripts\update_daily_data.py --date $date --strict-external --intraday-custom
python .\scripts\update_daily_data.py --date $date --strict-custom --intraday-custom
python .\scripts\update_daily_data.py --date $date --intraday-radar-only --custom-sleep 0
python .\scripts\build_custom_board_data.py --date $date --intraday-fast
```

默认容错策略：

- `build_ths_limit_mapping.py` 是增强步骤。失败时，只要已有 `web/data/kpl_dashboard.json`，脚本会保留旧文件。
- `build_custom_board_data.py` 失败时，如果已有 `web/data/custom_boards.json`，脚本会保留旧文件。
- `--strict-external` 和 `--strict-custom` 会把对应步骤改成失败即中断。
- `scripts/validate_web_data.py` 是最后兜底校验，前端必需 JSON 缺失或格式错误会直接失败。

## 定时任务

### 推荐方案：Windows 计划任务

Codex Desktop 的 heartbeat 自动化在某些 Windows 路径下可能把同一会话识别成两种路径：

```text
C:\Users\...\rollout.jsonl
\\?\C:\Users\...\rollout.jsonl
```

这会导致 `cannot resume running thread ... with stale path`。因此盘中快刷更推荐用 Windows 计划任务直接跑本地脚本，不依赖 Codex 会话。

本地脚本放在：

```text
.codex-local/run_intraday_radar_task.ps1
.codex-local/install_intraday_radar_task.ps1
.codex-local/uninstall_intraday_radar_task.ps1
```

安装任务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.codex-local\install_intraday_radar_task.ps1
```

任务名称：

```text
Taoguba Intraday Radar 5min
```

运行频率：

```text
每 5 分钟
```

脚本内部会自行判断交易时段：

- 周末跳过
- 非 `09:30-11:30` 或 `13:00-15:05` 跳过
- 上一次运行未结束时跳过，避免并发写 `custom_boards.json`

查看任务：

```powershell
schtasks.exe /Query /TN "Taoguba Intraday Radar 5min" /V /FO LIST
```

手动触发：

```powershell
schtasks.exe /Run /TN "Taoguba Intraday Radar 5min"
```

删除任务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\.codex-local\uninstall_intraday_radar_task.ps1
```

日志文件：

```text
C:\Users\yanghui\.codex\automation-logs\taoguba-intraday-radar.log
```

### Codex 自动化方案

如果 Codex heartbeat 恢复线程不报 stale path，也可以创建绑定当前对话的 heartbeat 自动化，提示词使用：

```text
在 D:\github\taoguba 刷新当天盘中雷达数据。先把 current_time_iso 转换为 Asia/Shanghai 时间；只有周一到周五且时间在 09:30-11:30 或 13:00-15:05 时才执行刷新。若不在该时段，立即返回 DONT_NOTIFY，说明跳过原因，不要运行任何命令。若在盘中时段，获取当天日期 YYYYMMDD，执行 `python scripts\update_daily_data.py --date YYYYMMDD --intraday-custom --intraday-radar-only --custom-sleep 0`，完成后执行 `python scripts\validate_web_data.py`。报告是否成功、数据日期、盘中雷达数据是否已刷新；失败时说明错误原因。
```

如果出现 stale path，删除 Codex 自动化，改用 Windows 计划任务。

## 数据文件

前端使用的主要数据文件：

```text
web/data/kpl_dashboard.json
web/data/kpl/index.json
web/data/kpl/history/YYYYMMDD.json
web/data/custom_boards.json
web/data/custom_boards_config.json
web/data/custom_board_membership.json
web/data/trades.json
```

生成过程中的中间数据：

```text
data/kpl_probe/YYYYMMDD/
data/kpl_linked/YYYYMMDD/
data/external/ths_limit_mapping/YYYYMMDD/
data/custom_stock_history/
data/custom_financial_metrics/
data/custom_market_index_history/
```

## 脚本说明

```text
scripts/update_daily_data.py              # 一键更新日常数据，含盘中快刷自动切换
scripts/fetch_kpl_probe.py                # 拉取开盘啦板块和个股接口 -> data/kpl_probe/YYYYMMDD
scripts/build_kpl_plate_stock_links.py    # 推断开盘啦板块和个股关联 -> data/kpl_linked/YYYYMMDD
scripts/build_kpl_web_data.py             # 生成开盘啦看板 JSON 和日期快照
scripts/build_ths_limit_mapping.py        # 同花顺概念 x 东方财富涨停池增强映射
scripts/build_custom_board_data.py        # 生成自定义板块历史数据，可叠加实时行情
scripts/validate_web_data.py              # 校验前端需要的 web/data JSON
scripts/serve_custom_boards.py            # 启动可编辑的本地看板服务
```

## 数据计算口径

### KPL 数据

KPL 日更链路：

```text
fetch_kpl_probe.py
  -> data/kpl_probe/YYYYMMDD
build_kpl_plate_stock_links.py
  -> data/kpl_linked/YYYYMMDD
build_kpl_web_data.py
  -> web/data/kpl_dashboard.json
  -> web/data/kpl/history/YYYYMMDD.json
  -> web/data/kpl/index.json
build_ths_limit_mapping.py
  -> data/external/ths_limit_mapping/YYYYMMDD/ths_limit_mapping.json
  -> 增强 web/data/kpl_dashboard.json
```

KPL 主要用于板块强度、开盘啦板块列表、涨停池映射和历史快照。

### 自定义板块数据

配置入口：

```text
web/data/custom_boards_config.json
```

生成入口：

```powershell
python .\scripts\build_custom_board_data.py --date $date --intraday
```

主要计算字段：

- `averageChange`：板块成员股当日涨跌幅平均值。
- `totalTurnover` / `totalAmount`：板块成员股成交额汇总。
- `stocks`：当天板块成员股快照。
- `latestAverageChange`：最新交易日板块平均涨幅。
- `latestLimitUpCount`：最新交易日涨停数量。
- `latestNearHigh100Rate`：接近百日新高的成员股占比。
- `latestAvgDistanceToHigh100`：成员股到百日新高的平均距离。
- `latestAvgPosition100`：成员股在近百日区间中的平均位置。

盘中实时源：

- 个股实时行情优先走腾讯实时行情批量请求。
- 失败时脚本内有备用实时源逻辑。
- 快刷模式只覆盖当天最新行，不重建全量历史。

### 热门板块波段观察

前端逻辑主要在：

```text
web/custom-swing.js
web/custom-decision.js
```

核心输入：

- 今日板块平均涨幅。
- 3 日、5 日、10 日复合收益。
- 3 日、5 日、10 日相对上证指数超额收益。
- 今日红盘率。
- 3 日平均红盘率。
- 5 日量能比。
- 3 日最大回撤。
- 当日进攻质量。

热度分 `heatScore`：

```text
0.28 * 今日涨幅得分
+ 0.22 * 3日收益得分
+ 0.18 * 3日超额得分
+ 0.14 * 今日红盘率得分
+ 0.10 * 3日红盘率得分
+ 0.08 * 量能比得分
```

进攻质量 `attackQuality.score`：

```text
0.42 * 涨幅 >= 5% 个股占比得分
+ 0.34 * 涨幅 >= 3% 个股占比得分
+ 0.24 * 红盘率得分
```

板块状态判定：

- `主升`：热度分 >= 65，今日上涨，3 日收益为正，3 日超额 >= 0，今日红盘率 >= 50，且 5/10 日背景未破坏。
- `良性回踩`：今日下跌，但热度分 >= 50，3 日超额 >= -0.5，今日红盘率 >= 40，量能比 <= 1.15，且中期背景仍可。
- `恶性回踩`：今日下跌且热度不低，但出现明显跑输、红盘率过低、回撤加深或放量下跌。
- `启动`：热度分 >= 55，今日上涨，3 日收益为正，3 日超额 >= -0.5，且背景未破坏。
- `高位震荡`：热度分 >= 45，且 3 日回撤 >= 4。
- `热度退潮`：热度分 < 35，或短线明显跑输且红盘率弱，或 5/10 日超额同时转弱。
- `趋势走弱`：不满足以上强状态时的默认弱势状态。

四段归类：

```text
主升 / 启动 / 二波观察 -> 进攻段
良性回踩 -> 良性回踩
恶性回踩 -> 恶性回踩
其他 -> 退潮段
```

变化结论：

- `进攻增强`：进攻段延续，热度和进攻质量都不下降。
- `进攻延续`：进攻段维持，但增强不明显。
- `弱分歧`：进攻段维持，但热度或进攻质量小幅下降。
- `进攻钝化`：进攻段维持，但热度和进攻质量明显下降。
- `进攻分歧`：进攻段转良性回踩。
- `进攻转弱`：进攻段转恶性回踩。
- `进攻退潮`：进攻段转退潮段。
- `良性回踩转强`：良性回踩转进攻段。
- `承接观察`：良性回踩维持，量能和进攻质量尚可。
- `回踩走弱`：良性回踩内部继续转弱。
- `恶性回踩修复`：恶性回踩转进攻段。
- `恶性转良性`：恶性回踩转良性回踩。
- `恶化`：恶性回踩延续。
- `退潮转强`：退潮段转进攻段。
- `退潮修复`：退潮段转良性回踩。
- `退潮延续`：退潮段继续。

### 盘中机会雷达

盘中雷达优先从“热门板块波段观察”的变化结论里选板块，每个板块只取 3 个核心股。

当前可纳入监控的变化结论包括：

```text
良性回踩转强
退潮转强
恶性回踩修复
弱分歧
进攻分歧
承接观察
进攻增强
进攻延续
恶性转良性
退潮修复
进攻钝化
回踩走弱
```

个股侧主要参考：

- 3 日、5 日涨幅。
- 3 日、5 日成交额。
- 相对板块强弱。
- 分时/当日涨跌表现。
- MACD 标签和分数。
- 百日新高状态。

机会雷达是观察池，不是自动买卖信号。真正操作仍需要结合盘中分时、板块节奏、持仓成本和交易计划。

## 数据校验

每次更新后运行：

```powershell
python .\scripts\validate_web_data.py
```

正常输出类似：

```text
KPL data OK: date=2026-05-11, plates=270, history=16
Custom board data OK: date=2026-05-12, boards=18, configBoards=18, membershipOverrides=304
```

其中：

- KPL 日期可能落后于盘中快刷日期，这是正常的，因为快刷只更新自定义板块。
- 完整日更后，KPL 和自定义板块日期应尽量一致。

## 提交和推送

先看改动范围：

```powershell
git status --short
git diff --stat
```

盘中快刷通常只提交：

```powershell
git add web/data/custom_boards.json
git commit -m "Update intraday custom board data for YYYYMMDD"
git push origin main
```

完整日更通常提交：

```powershell
git add web/data/kpl_dashboard.json web/data/kpl/index.json web/data/kpl/history/YYYYMMDD.json web/data/custom_boards.json
git commit -m "Update daily data for YYYYMMDD"
git push origin main
```

不要提交本地服务日志：

```text
.codex-serve-*.log
```

如果 `.codex-local/` 只是个人本机计划任务脚本，也可以保持不提交。

## 常见问题

### 盘中快刷后 KPL 日期没变

正常。快刷只更新 `web/data/custom_boards.json`，KPL 要跑完整日更才更新。

### Codex 自动化报 stale path

这是 Codex Desktop 在 Windows 下恢复 heartbeat 线程时的路径格式问题。处理方式：

1. 删除 Codex 自动化。
2. 使用 Windows 计划任务运行 `.codex-local/run_intraday_radar_task.ps1`。
3. 通过日志确认刷新结果。

### 页面数据不是最新

先检查文件日期：

```powershell
node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('web/data/custom_boards.json','utf8')); console.log(c.date)"
```

再刷新浏览器页面。若服务未启动，重新运行：

```powershell
python .\scripts\serve_custom_boards.py --host 127.0.0.1 --port 8765
```

## 注意事项

- 只采集无需登录即可公开访问的数据。
- 保持较低请求频率，避免给第三方数据源造成压力。
- 自动任务只负责刷新数据，不负责提交或推送 GitHub。
- 交易判断是工具辅助，最终买卖决策仍以人工复盘和盘中确认优先。
