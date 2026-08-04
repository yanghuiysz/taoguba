# 题材数据看板

这是一个本地运行的 A 股题材复盘与盘中观察工具。项目把自定义板块、盘中雷达、集合竞价预警和交易记录放到同一个看板里，方便在交易日快速刷新、筛选和复盘。

主入口：

```text
http://127.0.0.1:8765/web/
```

## 功能入口

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 总入口 | `web/index.html` | 标签页容器，整合盘中雷达、操作记录、自定义板块 |
| 盘中雷达 | `web/intraday.html` | 盘中机会、集合竞价预警、开盘后加速板块和核心股筛选 |
| 自定义板块 | `web/custom.html` | 自定义板块维护、板块强度、波段状态和成员股观察 |
| 高股息雷达 | `web/high-dividend.html` | 全A高股息筛选、稳定/周期分池、双锚估值和观察状态 |
| 操作记录 | `web/trades.html` | 本地交易/观察记录 |

## 环境准备

建议使用 Python 虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

主要依赖见 `requirements.txt`：

- `akshare`：行情与历史数据
- `pandas`：数据处理
- `requests` / `beautifulsoup4`：接口和页面解析
- `playwright`：部分采集或验证流程使用

## 本地启动

### 推荐：可编辑服务

如果需要在页面里编辑自定义板块，启动项目自带服务：

```powershell
python .\scripts\serve_custom_boards.py --host 127.0.0.1 --port 8765
```

访问：

```text
http://127.0.0.1:8765/web/
```

### 简单静态预览

只看静态页面时可以用：

```powershell
python -m http.server 8765
```

### 一键启动

`start_server.bat` 会依次执行：

1. 检查是否需要收盘后补刷新。
2. 启动可编辑本地服务。
3. 启动盘中雷达守护进程。
4. 启动集合竞价探针。
5. 打开本地看板。

```powershell
.\start_server.bat
```

## 日常数据更新

### 完整更新

用于收盘后或需要刷新全部数据时：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
python .\scripts\validate_web_data.py
```

完整更新会尝试刷新自定义板块和前端依赖数据。脚本会保留已有数据文件，并在可选数据源不可用时给出 warning。

### 盘中快速刷新

交易时段只刷新盘中雷达依赖的数据：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --intraday-radar-only --custom-sleep 0
python .\scripts\validate_web_data.py
```

如果目标日期是今天且处于交易时段，`update_daily_data.py` 默认也会自动切到盘中快速刷新模式；需要强制完整更新时加 `--full-during-trading`。
注意：`--intraday-custom` 和 `--intraday-radar-only` 只用于当天盘中刷新；补历史日期时脚本会自动忽略这两个盘中参数，避免实时行情覆盖历史数据。

## 盘中雷达守护

守护进程会在交易时段循环刷新盘中雷达数据，并按节流规则发送企业微信通知。

```powershell
python .\scripts\intraday_radar_daemon.py
```

常用参数：

```powershell
python .\scripts\intraday_radar_daemon.py --disable-notify
python .\scripts\intraday_radar_daemon.py --notify-interval 600
python .\scripts\intraday_radar_daemon.py --once --force
```

日志写入：

```text
logs/intraday_radar.log
```

守护脚本默认会在交易日 15:30 后自动补跑一次当天盘后数据更新，并只执行一次；执行记录写入
`logs/closing_refresh_date.txt`。如需关闭或调整时间：

```powershell
python .\scripts\intraday_radar_daemon.py --disable-after-close-refresh
python .\scripts\intraday_radar_daemon.py --after-close-time 15:40
```

## 集合竞价探针

集合竞价探针会在 `09:15-09:25` 采样自定义板块成分股行情，保存快照，并在 `09:20` 后按板块竞价强度推送提醒。

```powershell
python .\scripts\auction_probe.py
```

常用参数：

```powershell
python .\scripts\auction_probe.py --no-notify
python .\scripts\auction_probe.py --sample-interval 5
python .\scripts\auction_probe.py --once --force --no-notify
```

输出文件：

```text
web/data/auction_snapshots/YYYYMMDD.summary.json
web/data/auction_snapshots/raw/YYYYMMDD.json
```

盘中雷达页面会读取当天快照，在顶部展示最新集合竞价预警板块和锁定股。

## 企业微信通知

企业微信机器人地址放在本地 `.env`：

```text
WECOM_WEBHOOK_URL=...
```

模板见 `.env.example`。

手动发送一次盘中雷达通知：

```powershell
python .\scripts\notify_intraday_radar.py --top 80
```

集合竞价探针也会复用同一套企业微信配置。

## 主要脚本

| 脚本 | 说明 |
| --- | --- |
| `scripts/update_daily_data.py` | 统一调度日更、盘中刷新和数据校验 |
| `scripts/validate_web_data.py` | 校验前端依赖数据是否可读、字段是否完整 |
| `scripts/build_custom_board_data.py` | 生成自定义板块行情、强度和成员股数据 |
| `scripts/serve_custom_boards.py` | 本地可编辑服务，支持页面修改自定义板块配置 |
| `scripts/intraday_radar_engine.py` | 盘中雷达核心计算逻辑 |
| `scripts/intraday_radar_daemon.py` | 交易时段循环刷新和通知守护进程 |
| `scripts/notify_intraday_radar.py` | 盘中雷达企业微信消息拼装 |
| `scripts/auction_probe.py` | 集合竞价采样、预警评分和通知 |
| `scripts/refresh_latest_after_close.py` | 启动前检查并执行收盘后补刷新 |
| `scripts/notify_wecom.py` | 企业微信发送封装 |
| `scripts/sync_position_stops.py` | 辅助同步持仓止损线数据 |

## 数据文件

核心前端数据位于 `web/data/`：

| 文件 | 说明 |
| --- | --- |
| `custom_boards.json` | 自定义板块主数据，盘中雷达和自定义板块页面都会读取 |
| `custom_boards/index.json` | 自定义板块每日历史索引 |
| `custom_boards/history/*.json` | 自定义板块按日期拆分保存的每日历史数据 |
| `custom_boards/intraday/*.json` | 自定义板块盘中运行态快照，默认不提交 |
| `custom_boards_config.json` | 自定义板块配置 |
| `custom_board_membership.json` | 板块成员覆盖关系 |
| `custom_board_labels.json` | 板块标签 |
| `custom_resonance_config.json` | 共振观察相关配置 |
| `auction_snapshots/YYYYMMDD.summary.json` | 集合竞价前端/复盘用瘦身快照 |
| `auction_snapshots/raw/YYYYMMDD.json` | 集合竞价原始采样，默认不提交 |
| `trades.json` | 操作记录页面数据 |
| `positions.json` | 持仓辅助数据，主要给脚本维护使用 |

### 高股息雷达

高股息 Tab 将候选分为“稳定收息池”和“周期高息池”，使用固定收益率底线与中国 10 年期国债利差的双锚估值。页面只输出“可关注、等待、偏贵、风险观察、数据不足”，不输出买卖或仓位建议。

开发环境可用固定夹具生成一份可复现快照：

```powershell
python .\scripts\build_high_dividend_data.py --date 2026-08-04 --source-json .\tests\fixtures\high_dividend_source.json
```

不带 `--source-json` 时，构建器尝试从 AKShare 获取全 A 股行情、分红概览和国债收益率。上游数据不可用或个股缺少逐年分红、财务明细时，系统保留缺失状态，不将缺失值写成 0。配置位于 `web/data/high_dividend_config.json`，可维护观察名单和人工分池覆盖；快照位于 `web/data/high_dividend/latest.json` 与 `web/data/high_dividend/history/`。

### 资金净流入

板块趋势页直接读取东方财富个股历史资金流接口，将每只成分股的历史数据缓存到
`data/custom_fund_flow/YYYYMMDD/CODE.json`，页面显示最近 15 个交易日的“资金净流入
（东方财富口径）”。首次运行会逐只回填成分股，之后优先复用缓存；Python 网络请求失败时
自动回退系统 `curl.exe`，单股抓取失败则读取最近一次有效缓存，不把失败写成 0。

每日板块净额由同一天有数据的成分股求和。有效覆盖率不足 80% 时该日净额保持 `null`，
折线在该日断开并提示覆盖不足。东方财富的资金流分类口径不等同于机构、量化资金的真实持仓变化。
同花顺全市场快照缓存仍保留给其他数据消费者，但不会与趋势折线混用。

## 推荐工作流

交易日前：

```powershell
.\start_server.bat
```

盘中临时刷新：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --intraday-radar-only --custom-sleep 0
```

收盘后完整复盘：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
python .\scripts\validate_web_data.py
```

## 维护注意事项

- 修改脚本或数据结构后，优先运行 `python .\scripts\validate_web_data.py`。
- 不要手动提交 `.env`，企业微信 webhook 只保存在本地。
- `web/data/custom_boards.json`、`web/data/custom_boards/index.json`、`web/data/custom_boards/history/*.json`、`web/data/auction_snapshots/*.summary.json` 属于生成数据，提交前确认日期和内容是否符合预期。
- 页面入口统一从 `web/index.html` 维护，新增页面时同步更新标签页和 README。
