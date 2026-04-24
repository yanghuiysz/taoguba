# Topic data dashboard

This project builds local dashboards for:

- Kaipanla plate strength and inferred plate-stock links.
- Custom boards with recent average stock performance.

The legacy public topic feed has been removed from the code and tracked data.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Daily Update

Start each update from the latest remote code, then refresh the current trading
day. The `--intraday-custom` switch overlays realtime quotes for custom-board
stocks and the Shanghai Composite index, so same-day rows do not wait on the
daily history source to finish publishing.

```powershell
git pull --ff-only origin main
$date = Get-Date -Format yyyyMMdd
python .\scripts\update_daily_data.py --date $date --intraday-custom
```

Useful switches:

```powershell
python .\scripts\update_daily_data.py --date $date --intraday-custom --skip-kpl
python .\scripts\update_daily_data.py --date $date --skip-external --intraday-custom
python .\scripts\update_daily_data.py --date $date --skip-custom
python .\scripts\update_daily_data.py --date $date --strict-external --intraday-custom
python .\scripts\update_daily_data.py --date $date --strict-custom --intraday-custom
```

By default, optional enrichment steps keep the dashboard loadable if a third-party
package or source is unavailable:

- `build_ths_limit_mapping.py` is optional; KPL data still loads without it.
- `build_custom_board_data.py` is optional when an existing
  `web/data/custom_boards.json` is present.
- `scripts/validate_web_data.py` runs at the end and fails if required frontend
  JSON files are missing or invalid.

Daily web snapshots are saved here:

```text
web/data/kpl/history/YYYYMMDD.json
web/data/kpl/index.json
web/data/kpl_dashboard.json
web/data/custom_boards.json
```

After checking the generated data, commit and push the changed JSON files:

```powershell
git status --short
git add web/data/kpl_dashboard.json web/data/kpl/index.json web/data/kpl/history/$date.json web/data/custom_boards.json
git commit -m "Update daily data for $date"
git push origin main
```

## Scripts

```text
scripts/update_daily_data.py              # one-command daily update
scripts/fetch_kpl_probe.py                # Kaipanla public plate and stock endpoints -> data/kpl_probe/YYYYMMDD
scripts/build_kpl_plate_stock_links.py    # inferred KPL plate/stock links -> data/kpl_linked/YYYYMMDD
scripts/build_kpl_web_data.py             # KPL dashboard JSON + dated history snapshot
scripts/build_ths_limit_mapping.py        # Tonghuashun concepts x Eastmoney limit-up pool enrichment
scripts/build_custom_board_data.py        # custom board history plus optional realtime stock/index overlay
scripts/validate_web_data.py              # validate required web/data JSON files
scripts/serve_custom_boards.py            # editable local server for custom board definitions
```

## View The Dashboard

Serve the workspace and open `web/`:

```powershell
python -m http.server 8765
```

Then visit `http://127.0.0.1:8765/web/`.

The main page includes:

- `web/kpl.html` for Kaipanla plate strength.
- `web/custom.html` for custom boards.

## Custom Boards

Edit board definitions in:

```text
web/data/custom_boards_config.json
```

Build the custom board data:

```powershell
python .\scripts\build_custom_board_data.py --date $date --intraday
```

Use `--intraday` during trading days or shortly after close. It keeps the latest
custom-board stock rows and `marketIndex` current even when the daily history
API has not published every same-day record yet.

To edit custom boards from the page, run the editable local server instead of the static server:

```powershell
python .\scripts\serve_custom_boards.py --port 8765
```

Edits update `web/data/custom_boards_config.json` and rebuild `web/data/custom_boards.json`.

## Notes

- Only collect data publicly available without authentication.
- Keep request rates low.
