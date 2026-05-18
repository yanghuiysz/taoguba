# 题材数据看板

本项目用于本地维护一套题材观察工作流，把盘中雷达、自定义板块、开盘啦强度和交易记录放到同一个看板里。

当前主入口：

- `web/index.html`：看板总入口，包含盘中雷达、操作记录、自定义板块、开盘啦强度四个标签页
- `web/intraday.html`：盘中机会雷达
- `web/custom.html`：自定义板块、热门板块波段观察
- `web/kpl.html`：开盘啦板块强度
- `web/trades.html`：操作记录

## 环境准备

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 本地启动

最简单的静态查看：

```powershell
python -m http.server 8765
```

访问：

```text
http://127.0.0.1:8765/web/
```

如果需要在页面里直接编辑自定义板块，使用可编辑服务：

```powershell
python .\scripts\serve_custom_boards.py --host 127.0.0.1 --port 8765
```

如果希望启动时顺手做一次收盘后补刷新，并自动拉起本地网页和盘中守护进程：

```powershell
.\start_server.bat
```

## 日常数据更新

完整日更：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
python .\scripts\validate_web_data.py
```

盘中只刷新雷达依赖数据：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --intraday-radar-only --custom-sleep 0
python .\scripts\validate_web_data.py
```

`update_daily_data.py` 在交易时段内、目标日期又是今天时，也会自动切到盘中雷达快刷模式。

## 盘中自动刷新与通知

盘中守护进程：

```powershell
python .\scripts\intraday_radar_daemon.py
```

当前默认行为：

- 每 `60s` 刷新一次盘中雷达数据
- 每 `60s` 推送一次企业微信通知
- 只在交易时段执行
- 刷新成功后才会触发通知

常用参数：

```powershell
python .\scripts\intraday_radar_daemon.py --disable-notify
python .\scripts\intraday_radar_daemon.py --notify-interval 60
python .\scripts\intraday_radar_daemon.py --once --force
```

## 集合竞价探针

集合竞价探针会在 `09:15-09:25` 采样自定义板块成分股实时行情，保存原始快照，并在 `09:20` 后按板块竞价强度推送企业微信提醒。

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
- `web/data/auction_snapshots/YYYYMMDD.json`：每次采样的原始行情和当次预警板块。

盘中雷达页面会读取当天快照，并在顶部展示最新的集合竞价预警板块和锚定股。

评分口径：
- 板块竞价均涨、红盘率、强竞价个股数量。
- 板块竞价成交额相对近 5 日日均成交额的比例。
- 锚定股的竞价涨幅、竞价成交额、相对近 5 日成交额占比。

## 企业微信通知

企业微信机器人配置放在本地 `.env`：

```text
WECOM_WEBHOOK_URL=...
```

示例模板见 `.env.example`。

手动触发一次盘中通知：

```powershell
python .\scripts\notify_intraday_radar.py --top 80
```

## 主要脚本

- `scripts/update_daily_data.py`：统一调度日更和盘中快刷
- `scripts/validate_web_data.py`：校验前端依赖的数据文件
- `scripts/build_custom_board_data.py`：生成自定义板块数据
- `scripts/fetch_kpl_probe.py`：抓取开盘啦原始数据
- `scripts/build_kpl_plate_stock_links.py`：生成板块个股关联
- `scripts/build_kpl_web_data.py`：生成开盘啦前端数据
- `scripts/build_ths_limit_mapping.py`：生成同花顺/东财增强映射
- `scripts/intraday_radar_engine.py`：盘中雷达计算逻辑
- `scripts/intraday_radar_daemon.py`：盘中守护刷新与通知节流
- `scripts/auction_probe.py`：集合竞价采样、板块超预期评分与企业微信提醒
- `scripts/notify_intraday_radar.py`：盘中雷达通知拼装
- `scripts/notify_wecom.py`：企业微信发送封装
- `scripts/refresh_latest_after_close.py`：收盘后自动补刷新
- `scripts/serve_custom_boards.py`：本地可编辑服务

## 数据文件

前端核心数据：

- `web/data/custom_boards.json`
- `web/data/custom_boards_config.json`
- `web/data/custom_board_membership.json`
- `web/data/custom_board_labels.json`
- `web/data/kpl_dashboard.json`
- `web/data/kpl/index.json`
- `web/data/kpl/history/*.json`
- `web/data/trades.json`
- `web/data/positions.json`

## 已做的清理

本次已经移除了仓库里没有页面入口、也没有代码引用的前端孤儿文件：

- `web/custom-decision.css`
- `web/custom-decision.js`
- `web/custom-swing-plus.css`
- `web/custom-swing-plus.js`
- `web/custom-ui-fix.css`
