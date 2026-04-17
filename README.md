# Taoguba topic-mining probe

从淘股吧公开静态数据中提取题材/概念板块历史行情。

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Fetch public topic history

```powershell
python .\scripts\fetch_ticai_history.py
```

## View the local dashboard

Build the dashboard data:

```powershell
python .\scripts\build_dashboard_data.py
```

Or update it automatically from the public static history feed:

```powershell
python .\scripts\update_dashboard_auto.py
```

Serve the workspace and open `web/`:

```powershell
python -m http.server 8765
```

Then visit `http://127.0.0.1:8765/web/`.

## Daily update

Run one command to refresh the public Taoguba feed, fetch Kaipanla data, build the Kaipanla plate-stock links, enrich them with the Tonghuashun/Eastmoney external limit-up mapping, and save dated snapshots:

```powershell
python .\scripts\update_daily_data.py --date 20260415
```

Useful switches:

```powershell
python .\scripts\update_daily_data.py --date 20260415 --skip-taoguba
python .\scripts\update_daily_data.py --date 20260415 --skip-kpl
python .\scripts\update_daily_data.py --date 20260415 --skip-external
```

Daily snapshots are saved here:

```text
web/data/taoguba/history/YYYYMMDD.json
web/data/taoguba/index.json
web/data/kpl/history/YYYYMMDD.json
web/data/kpl/index.json
```

Formal data scripts:

```text
scripts/update_daily_data.py              # daily one-command entry
scripts/update_dashboard_auto.py          # Taoguba public topic history -> web/data/dashboard.json
scripts/fetch_kpl_probe.py                # Kaipanla public plate and stock endpoints -> data/kpl_probe/YYYYMMDD
scripts/build_kpl_plate_stock_links.py    # KPL plate/stock inferred links -> data/kpl_linked/YYYYMMDD
scripts/build_kpl_web_data.py             # KPL web JSON + history snapshot
scripts/build_ths_limit_mapping.py        # Tonghuashun concepts x Eastmoney limit-up pool enrichment
```

## View the Kaipanla dashboard

Fetch Kaipanla plate and stock data, link stocks to plates, and build the web JSON:

```powershell
python .\scripts\fetch_kpl_probe.py
python .\scripts\build_kpl_plate_stock_links.py --date 20260415 --sort-by strength
python .\scripts\build_kpl_web_data.py --date 20260415
python .\scripts\build_ths_limit_mapping.py --date 20260415
```

The KPL web builder writes both the latest dashboard data and a dated history snapshot. The Tonghuashun/Eastmoney mapper then enriches those JSON files with an external limit-up stock mapping:

```text
web/data/kpl_dashboard.json
web/data/kpl/index.json
web/data/kpl/history/20260415.json
```

The external mapper uses Tonghuashun concept constituents and the Eastmoney limit-up pool. It is a cross-source mapping, not a Kaipanla official plate-detail endpoint.

Serve the workspace and open `web/kpl.html`:

```powershell
python -m http.server 8765
```

Then visit `http://127.0.0.1:8765/web/kpl.html`.

## Custom boards

Edit custom board definitions:

```text
web/data/custom_boards_config.json
```

Build the 15-trading-day average change line for each custom board:

```powershell
python .\scripts\build_custom_board_data.py --date 20260417
```

The builder writes:

```text
web/data/custom_boards.json
```

Then visit `http://127.0.0.1:8765/web/custom.html`, or open the `自定义板块` tab from `web/index.html`.

To edit custom boards from the page, run the editable local server instead of the static server:

```powershell
python .\scripts\serve_custom_boards.py --port 8765
```

The page will show add/remove stock controls when this server is running. Edits update `web/data/custom_boards_config.json` and rebuild `web/data/custom_boards.json`.

## Notes

- Only collect data publicly available without authentication.
- Keep request rates low.
