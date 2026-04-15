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

## Notes

- Only collect data publicly available without authentication.
- Keep request rates low.
