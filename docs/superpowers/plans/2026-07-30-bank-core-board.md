# Bank Core Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one 12-stock `银行` board whose combined performance represents the defensive and active sides of the A-share banking sector.

**Architecture:** Extend the existing declarative board configuration without changing page or builder code. Use six large state-owned banks, two leading nationwide joint-stock banks, two active joint-stock banks, and two representative regional banks; then run the existing intraday-aware daily pipeline and validate 12/12 market and fund-flow coverage.

**Tech Stack:** JSON, Python 3.11, existing `scripts/update_daily_data.py`, `scripts/validate_web_data.py`, and unittest suite

---

### Task 1: Confirm the Representative Candidate Set

**Files:**
- Read: `docs/superpowers/specs/2026-07-30-bank-core-board-design.md`
- Read: `web/data/custom_boards_config.json`

- [ ] **Step 1: Verify current names, listing status, and banking classification**

Use the latest CSI Bank index factsheet, exchange disclosures, or company disclosures to verify these 12 code/name pairs:

```text
601398 工商银行    601939 建设银行    601288 农业银行
601988 中国银行    601328 交通银行    601658 邮储银行
600036 招商银行    601166 兴业银行    000001 平安银行
600919 江苏银行    002142 宁波银行    600926 杭州银行
```

- [ ] **Step 2: Verify structural representation**

Confirm exactly 12 unique codes: six large state-owned banks, three nationwide joint-stock banks（招商银行、兴业银行、平安银行）, and three active/representative regional-growth exposures through江苏银行、宁波银行、杭州银行. Confirm no ST or suspended security is included.

### Task 2: Add the Bank Board Configuration

**Files:**
- Modify: `web/data/custom_boards_config.json`

- [ ] **Step 1: Run the pre-change assertion**

```powershell
@'
import json
from pathlib import Path
d = json.loads(Path('web/data/custom_boards_config.json').read_text(encoding='utf-8'))
matches = [b for b in d['boards'] if b.get('code') == 'yinhang']
assert len(matches) == 1
assert len(matches[0]['stocks']) == 12
'@ | python -
```

Expected: FAIL because `yinhang` does not yet exist.

- [ ] **Step 2: Append the board object**

Add the following object to the `boards` array:

```json
{
  "code": "yinhang",
  "name": "银行",
  "stocks": [
    {"code": "601398", "name": "工商银行"},
    {"code": "601939", "name": "建设银行"},
    {"code": "601288", "name": "农业银行"},
    {"code": "601988", "name": "中国银行"},
    {"code": "601328", "name": "交通银行"},
    {"code": "601658", "name": "邮储银行"},
    {"code": "600036", "name": "招商银行"},
    {"code": "601166", "name": "兴业银行"},
    {"code": "000001", "name": "平安银行"},
    {"code": "600919", "name": "江苏银行"},
    {"code": "002142", "name": "宁波银行"},
    {"code": "600926", "name": "杭州银行"}
  ]
}
```

- [ ] **Step 3: Verify the configuration invariants**

```powershell
@'
import json
from pathlib import Path
d = json.loads(Path('web/data/custom_boards_config.json').read_text(encoding='utf-8'))
matches = [b for b in d['boards'] if b.get('code') == 'yinhang']
assert len(matches) == 1
b = matches[0]
assert b['name'] == '\u94f6\u884c'
assert len(b['stocks']) == 12
assert len({s['code'] for s in b['stocks']}) == 12
assert all(len(s['code']) == 6 and s['code'].isdigit() and s['name'] for s in b['stocks'])
print('bank config OK: 12 unique stocks')
'@ | python -
```

Expected: `bank config OK: 12 unique stocks`.

- [ ] **Step 4: Commit configuration and plan**

```powershell
git add web/data/custom_boards_config.json docs/superpowers/plans/2026-07-30-bank-core-board.md
git commit -m "feat: add bank core board"
```

### Task 3: Generate and Validate Bank Data

**Files:**
- Modify: `web/data/custom_boards.json`
- Modify/Create: `web/data/custom_boards/history/*.json`
- Modify: `web/data/custom_boards/index.json`
- Modify: `web/data/full_a_turnover_top20.json`

- [ ] **Step 1: Generate the latest trading-day snapshot with intraday coverage**

```powershell
python .\scripts\update_daily_data.py --date 20260730 --intraday-custom --full-during-trading --custom-sleep 0
```

Expected: `Boards: 25`, `errors: 0`, and `Daily data update complete.` If an optional market-wide ranking source fails, its existing fallback may be used; bank-board generation itself must report all member rows.

- [ ] **Step 2: Run standard validation and the full automated suite**

```powershell
python .\scripts\validate_web_data.py
python -m unittest discover -s scripts -p "test_*.py"
```

Expected: validation exit code 0 with 25 configured/generated boards; 25 tests pass with zero failures.

- [ ] **Step 3: Verify 12/12 generated coverage**

```powershell
@'
import json
from pathlib import Path
d = json.loads(Path('web/data/custom_boards.json').read_text(encoding='utf-8'))
matches = [b for b in d['boards'] if b.get('code') == 'yinhang']
assert len(matches) == 1
b = matches[0]
assert d.get('date') == '2026-07-30'
assert b.get('stockCount') == 12
assert b.get('availableStockCount') == 12
assert len(b.get('stocks', [])) == 12
assert b.get('latestFundFlowStockCount') == 12
print('generated bank board OK: date=2026-07-30, stocks=12, available=12, fundFlow=12')
'@ | python -
```

Expected: the printed 12/12 success line.

- [ ] **Step 4: Commit and push generated data to main**

```powershell
git add -A -- web/data
git commit -m "data: build bank board snapshots"
git push origin main
```

Expected: `main -> main`; `output/` and `tmp/` remain untracked and uncommitted.
