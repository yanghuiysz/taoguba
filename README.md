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

Refresh Kaipanla data, rebuild plate-stock links, enrich with the Tonghuashun/Eastmoney limit-up mapping, and rebuild custom board data:

```powershell
python .\scripts\update_daily_data.py --date 20260422
```

Useful switches:

```powershell
python .\scripts\update_daily_data.py --date 20260422 --skip-kpl
python .\scripts\update_daily_data.py --date 20260422 --skip-external
python .\scripts\update_daily_data.py --date 20260422 --skip-custom
python .\scripts\update_daily_data.py --date 20260422 --strict-external
python .\scripts\update_daily_data.py --date 20260422 --strict-custom
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

## Scripts

```text
scripts/update_daily_data.py              # one-command daily update
scripts/fetch_kpl_probe.py                # Kaipanla public plate and stock endpoints -> data/kpl_probe/YYYYMMDD
scripts/build_kpl_plate_stock_links.py    # inferred KPL plate/stock links -> data/kpl_linked/YYYYMMDD
scripts/build_kpl_web_data.py             # KPL dashboard JSON + dated history snapshot
scripts/build_ths_limit_mapping.py        # Tonghuashun concepts x Eastmoney limit-up pool enrichment
scripts/build_custom_board_data.py        # custom board average history -> web/data/custom_boards.json
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
python .\scripts\build_custom_board_data.py --date 20260422
```

To edit custom boards from the page, run the editable local server instead of the static server:

```powershell
python .\scripts\serve_custom_boards.py --port 8765
```

Edits update `web/data/custom_boards_config.json` and rebuild `web/data/custom_boards.json`.

## Notes

- Only collect data publicly available without authentication.
- Keep request rates low.
