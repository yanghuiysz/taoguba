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

## View the Kaipanla dashboard

Fetch Kaipanla plate and stock data, link stocks to plates, and build the web JSON:

```powershell
python .\scripts\fetch_kpl_probe.py
python .\scripts\build_kpl_plate_stock_links.py --date 20260415 --sort-by strength
python .\scripts\build_kpl_web_data.py --date 20260415
```

The last command writes both the latest dashboard data and a dated history snapshot:

```text
web/data/kpl_dashboard.json
web/data/kpl/index.json
web/data/kpl/history/20260415.json
```

Serve the workspace and open `web/kpl.html`:

```powershell
python -m http.server 8765
```

Then visit `http://127.0.0.1:8765/web/kpl.html`.

## Notes

- Only collect data publicly available without authentication.
- Keep request rates low.
