# Core Stock Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight high-recognition stocks as nine pure-core board memberships without changing existing memberships.

**Architecture:** Treat `custom_boards_config.json` as the board membership source and `custom_board_membership.json` as the classification source. Add matching records to both, rebuild the existing derived board data, and verify exact membership deltas plus the standard data validator.

**Tech Stack:** JSON, Python 3, existing custom-board build and validation scripts.

---

## File map

- Modify `web/data/custom_boards_config.json`: authoritative board member lists.
- Modify `web/data/custom_board_membership.json`: authoritative `pure_core` classifications.
- Regenerate `web/data/custom_boards.json` and applicable history/index files through the existing builder.

### Task 1: Add an exact-delta regression check

**Files:**
- Test: inline read-only Python check against `web/data/custom_boards_config.json` and `web/data/custom_board_membership.json`

- [ ] **Step 1: Run the pre-change check and confirm it fails**

```powershell
@'
import json
from pathlib import Path

expected = {
    "xinpianbandaoti": {"688008", "688981", "688012", "688072"},
    "suanli": {"688256", "688041"},
    "pcb": {"600183"},
    "guangfu": {"300274"},
    "chuneng": {"300274"},
}
config = json.loads(Path("web/data/custom_boards_config.json").read_text(encoding="utf-8-sig"))
membership = json.loads(Path("web/data/custom_board_membership.json").read_text(encoding="utf-8-sig"))
boards = {board["code"]: {stock["code"] for stock in board["stocks"]} for board in config["boards"]}
labels = {(row["boardCode"], row["stockCode"], row["status"]) for row in membership["overrides"]}
for board_code, stock_codes in expected.items():
    for stock_code in stock_codes:
        assert stock_code in boards[board_code], (board_code, stock_code, "missing config")
        assert (board_code, stock_code, "pure_core") in labels, (board_code, stock_code, "missing label")
'@ | python -
```

Expected: assertion failure for at least the first missing relationship.

### Task 2: Update both authoritative files

**Files:**
- Modify: `web/data/custom_boards_config.json`
- Modify: `web/data/custom_board_membership.json`

- [ ] **Step 1: Append the nine board-member relationships**

Add these exact stock objects to the corresponding `stocks` arrays while preserving all existing entries:

```json
{
  "xinpianbandaoti": [
    {"code": "688008", "name": "澜起科技"},
    {"code": "688981", "name": "中芯国际"},
    {"code": "688012", "name": "中微公司"},
    {"code": "688072", "name": "拓荆科技"}
  ],
  "suanli": [
    {"code": "688256", "name": "寒武纪"},
    {"code": "688041", "name": "海光信息"}
  ],
  "pcb": [{"code": "600183", "name": "生益科技"}],
  "guangfu": [{"code": "300274", "name": "阳光电源"}],
  "chuneng": [{"code": "300274", "name": "阳光电源"}]
}
```

- [ ] **Step 2: Add matching pure-core overrides**

For each relationship above, append an override with these fields and board-specific names:

```json
{
  "boardCode": "xinpianbandaoti",
  "boardName": "芯片半导体",
  "stockCode": "688008",
  "stockName": "澜起科技",
  "status": "pure_core",
  "label": "正宗核心",
  "note": "高成交辨识度核心股，按本次核心股覆盖审查纳入",
  "suggestedKeep": "是",
  "primaryDriverBoard": "芯片半导体",
  "source": "local-turnover-review-20260717"
}
```

Create one complete record for every relationship in the preceding JSON mapping. Set `boardCode`, `boardName`, `stockCode`, `stockName`, and `primaryDriverBoard` from that mapping; retain the five literal values `pure_core`, `正宗核心`, `高成交辨识度核心股，按本次核心股覆盖审查纳入`, `是`, and `local-turnover-review-20260717` in every record. For 阳光电源, create two distinct records whose `primaryDriverBoard` values are 光伏 and 储能.

- [ ] **Step 3: Run the exact-delta check again**

Run the complete Python check from Task 1.

Expected: exit code 0 with no assertion output.

- [ ] **Step 4: Verify uniqueness and unchanged unrelated boards**

```powershell
@'
import json
from collections import Counter
from pathlib import Path

config = json.loads(Path("web/data/custom_boards_config.json").read_text(encoding="utf-8-sig"))
for board in config["boards"]:
    codes = [stock["code"] for stock in board["stocks"]]
    duplicates = [code for code, count in Counter(codes).items() if count > 1]
    assert not duplicates, (board["name"], duplicates)
expected_counts = {"芯片半导体": 20, "算力": 24, "PCB": 11, "光伏": 12, "储能": 13}
for board in config["boards"]:
    if board["name"] in expected_counts:
        assert len(board["stocks"]) == expected_counts[board["name"]], (board["name"], len(board["stocks"]))
'@ | python -
```

Expected: exit code 0 with no assertion output.

### Task 3: Rebuild and verify derived data

**Files:**
- Regenerate: `web/data/custom_boards.json`
- Regenerate: relevant `web/data/custom_boards/history/*.json`
- Regenerate: `web/data/custom_boards/index.json` if changed by the builder

- [ ] **Step 1: Inspect the builder command contract**

Run: `python scripts/build_custom_board_data.py --help`

Expected: exit code 0 and documented date/intraday options.

- [ ] **Step 2: Rebuild the current 2026-07-17 board snapshot**

Run: `python scripts/build_custom_board_data.py --date 20260717 --sleep 0`

Expected: exit code 0 and a refreshed current board snapshot. If a market data source is unavailable, record the error and do not hand-edit derived quote data.

- [ ] **Step 3: Run the standard validator**

Run: `python scripts/validate_web_data.py`

Expected: exit code 0 and no validation failures.

- [ ] **Step 4: Run final repository checks**

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.

- [ ] **Step 5: Review scope**

Run: `git diff -- web/data/custom_boards_config.json web/data/custom_board_membership.json web/data/custom_boards.json web/data/custom_boards/index.json web/data/custom_boards/history/20260717.json`

Expected: the two authoritative files show only the nine additions; generated files reflect the new members without unrelated manual edits.
