# 题材数据看板

这个项目用于在本地生成和查看题材数据看板，主要包含：

- 开盘啦板块强度，以及推断出的板块和个股关联。
- 自定义板块的近期平均涨跌、个股表现和板块结构。
- 盘中雷达，用于在交易时间内聚焦启动、良性回踩板块里的机会个股。

旧版公共题材源已经从代码和跟踪数据中移除。

## 环境准备

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 日常更新

每次更新前先拉取远端最新代码，再刷新当前交易日数据。`--intraday-custom`
会把自定义板块个股和上证指数的实时行情覆盖到当天行里，这样当天日线源还没完全发布时，页面也能看到盘中数据。

```powershell
git pull --ff-only origin main
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom
```

如果目标日期是今天，并且命令运行时间在交易时段内
（09:30-11:30 或 13:00-15:05），脚本会自动进入盘中雷达刷新模式：
跳过开盘啦和外部映射，只刷新盘中雷达需要的自定义板块实时数据。
该模式会使用按代码批量请求的快刷路径，不再拉取全市场行情或逐个刷新历史缓存。
如果交易时段内也想强制跑完整日更，加 `--full-during-trading`。

常用参数：

```powershell
python .\scripts\update_daily_data.py --date $date --intraday-custom --skip-kpl
python .\scripts\update_daily_data.py --date $date --skip-external --intraday-custom
python .\scripts\update_daily_data.py --date $date --skip-custom
python .\scripts\update_daily_data.py --date $date --strict-external --intraday-custom
python .\scripts\update_daily_data.py --date $date --strict-custom --intraday-custom
python .\scripts\update_daily_data.py --date $date --intraday-radar-only
python .\scripts\update_daily_data.py --date $date --intraday-custom --full-during-trading
python .\scripts\build_custom_board_data.py --date $date --intraday-fast
```

默认情况下，可选增强步骤失败时会尽量保留已有数据，让看板仍然能打开：

- `build_ths_limit_mapping.py` 是可选步骤，失败时开盘啦数据仍然可用。
- 如果已有 `web/data/custom_boards.json`，`build_custom_board_data.py` 失败时会保留旧数据。
- `scripts/validate_web_data.py` 会在最后运行；如果前端必需的 JSON 缺失或格式错误，会直接失败。

每日生成的前端数据保存在：

```text
web/data/kpl/history/YYYYMMDD.json
web/data/kpl/index.json
web/data/kpl_dashboard.json
web/data/custom_boards.json
```

检查生成数据后，提交并推送变更：

```powershell
git status --short
git add web/data/kpl_dashboard.json web/data/kpl/index.json web/data/kpl/history/$date.json web/data/custom_boards.json
git commit -m "Update daily data for $date"
git push origin main
```

## 脚本说明

```text
scripts/update_daily_data.py              # 一键更新日常数据
scripts/fetch_kpl_probe.py                # 拉取开盘啦公开板块和个股接口 -> data/kpl_probe/YYYYMMDD
scripts/build_kpl_plate_stock_links.py    # 推断开盘啦板块和个股关联 -> data/kpl_linked/YYYYMMDD
scripts/build_kpl_web_data.py             # 生成开盘啦看板 JSON 和日期快照
scripts/build_ths_limit_mapping.py        # 同花顺概念 x 东方财富涨停池增强映射
scripts/build_custom_board_data.py        # 生成自定义板块历史数据，并可叠加实时行情
scripts/validate_web_data.py              # 校验前端需要的 web/data JSON
scripts/serve_custom_boards.py            # 启动可编辑的本地看板服务
```

## 查看页面

启动静态服务后打开 `web/`：

```powershell
python -m http.server 8765
```

访问：

```text
http://127.0.0.1:8765/web/
```

主页面包含：

- `web/kpl.html`：开盘啦板块强度。
- `web/custom.html`：自定义板块。
- `web/intraday.html`：盘中雷达。

需要在页面里编辑自定义板块时，使用可编辑服务，不要用普通静态服务：

```powershell
python .\scripts\serve_custom_boards.py --port 8765
```

## 自定义板块

板块配置文件：

```text
web/data/custom_boards_config.json
```

单独生成自定义板块数据：

```powershell
python .\scripts\build_custom_board_data.py --date $date --intraday
```

交易日盘中或收盘后不久建议使用 `--intraday`。它会保持自定义板块个股行和
`marketIndex` 为最新状态，即使日线历史接口还没有发布完整当天数据。

通过可编辑服务在页面里增删个股时，会更新
`web/data/custom_boards_config.json`，并重新生成
`web/data/custom_boards.json`。

## 注意事项

- 只采集无需登录即可公开访问的数据。
- 保持较低请求频率，避免给第三方数据源造成压力。
