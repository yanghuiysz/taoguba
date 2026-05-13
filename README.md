# 题材数据看板

## 项目简介

这是一个本地题材复盘与盘中观察项目，主要把以下几类信息放到同一套看板里：

- 开盘啦板块数据
- 自定义板块强度与趋势
- 热门板块波段观察
- 盘中机会雷达
- 交易记录与持仓跟踪

项目以本地静态页面和 Python 数据脚本为主，适合日常复盘、盘中快刷和题材节奏观察。

## 项目运行脚本

先准备环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd D:\github\taoguba
```

启动页面：

```powershell
python -m http.server 8765
```

访问：

```text
http://127.0.0.1:8765/web/
```

如果需要在页面里编辑自定义板块，使用：

```powershell
python .\scripts\serve_custom_boards.py --host 127.0.0.1 --port 8765
```

更新当日数据：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
python .\scripts\validate_web_data.py
```

盘中快刷雷达数据：

```powershell
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom --intraday-radar-only --custom-sleep 0
python .\scripts\validate_web_data.py
```

启动盘中自动刷新守护进程：

```powershell
python .\scripts\intraday_radar_daemon.py
```

常用附加脚本：

```text
scripts/intraday_radar_daemon.py      # 盘中定时刷新守护进程
scripts/intraday_radar_engine.py      # 盘中雷达刷新逻辑
scripts/notify_intraday_radar.py      # 盘中雷达通知封装
scripts/notify_wecom.py               # 企业微信通知
start_server.bat                      # 本地启动辅助脚本
```

## 项目功能

### 1. 看板展示

- `web/kpl.html`：查看开盘啦板块强度、板块映射和相关增强数据
- `web/custom.html`：查看自定义板块、趋势变化、波段观察和盘中雷达
- `web/intraday.html`：查看盘中机会雷达
- `web/trades.html`：查看交易记录与持仓变化

### 2. 数据更新

- 支持完整日更，刷新开盘啦数据和自定义板块数据
- 支持盘中快刷，只更新盘中雷达依赖的数据
- 支持数据校验，避免前端读取到缺失或异常 JSON

### 3. 盘中实时刷新

- 支持通过 `intraday_radar_daemon.py` 定时拉取盘中数据
- 自动按交易时段运行，适合盘中持续刷新
- 刷新后页面重新加载即可看到最新结果

### 4. 通知能力

- 支持盘中雷达通知脚本
- 支持企业微信通知
- 可用于把盘中重点板块或信号推送出去

### 5. 交易复盘辅助

- 记录买卖操作
- 结合题材、板块、盘中状态做复盘观察
- 方便把数据更新、盘面观察和交易记录放在同一套流程里
