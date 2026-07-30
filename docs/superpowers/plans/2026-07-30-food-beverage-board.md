# Food Beverage Core Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one 25-stock `食品饮料` core board and regenerate the dashboard data for the latest trading date.

**Architecture:** Extend the existing declarative board list in `web/data/custom_boards_config.json`; do not change page or data-builder code. Use the existing daily update pipeline to derive board history, fund flow, technical indicators, and membership output, then verify both configuration invariants and generated data.

**Tech Stack:** JSON, Python 3.11, existing `scripts/update_daily_data.py` and `scripts/validate_web_data.py`

---

### Task 1: Confirm the Candidate Set

**Files:**
- Read: `web/data/custom_boards_config.json`
- Read: `docs/superpowers/specs/2026-07-30-food-beverage-board-design.md`

- [ ] **Step 1: Verify current security names and listing status**

Check authoritative exchange or company disclosure sources for the 25 A-share code/name pairs below. Replace a candidate only if its name, listing status, or food-and-beverage classification is no longer valid.

```text
600519 贵州茅台    000858 五粮液      000568 泸州老窖
600809 山西汾酒    000596 古井贡酒    600600 青岛啤酒
600132 重庆啤酒    000729 燕京啤酒    605499 东鹏饮料
600887 伊利股份    002946 新乳业      600597 光明乳业
603288 海天味业    603027 千禾味业    600305 恒顺醋业
600298 安琪酵母    002847 盐津铺子    603517 绝味食品
300783 三只松鼠    002991 甘源食品    000895 双汇发展
603345 安井食品    002507 涪陵榨菜    001215 千味央厨
603043 广州酒家
```

- [ ] **Step 2: Verify portfolio balance**

Confirm the set has exactly 25 unique codes and covers all six required directions: five baijiu, four beer/soft-drink, three dairy, four condiment/ingredient, four snack-food, and five food-processing companies.

### Task 2: Add the Declarative Board Configuration

**Files:**
- Modify: `web/data/custom_boards_config.json`

- [ ] **Step 1: Run a pre-change assertion and verify it fails**

Run:

```powershell
@'
import json
from pathlib import Path
d = json.loads(Path('web/data/custom_boards_config.json').read_text(encoding='utf-8'))
matches = [b for b in d['boards'] if b.get('code') == 'shipinyinliao']
assert len(matches) == 1
assert len(matches[0]['stocks']) == 25
'@ | python -
```

Expected: FAIL because `shipinyinliao` is not present.

- [ ] **Step 2: Append the board object**

Add this object to the `boards` array, preserving UTF-8 JSON formatting:

```json
{
  "code": "shipinyinliao",
  "name": "食品饮料",
  "stocks": [
    {"code": "600519", "name": "贵州茅台"},
    {"code": "000858", "name": "五粮液"},
    {"code": "000568", "name": "泸州老窖"},
    {"code": "600809", "name": "山西汾酒"},
    {"code": "000596", "name": "古井贡酒"},
    {"code": "600600", "name": "青岛啤酒"},
    {"code": "600132", "name": "重庆啤酒"},
    {"code": "000729", "name": "燕京啤酒"},
    {"code": "605499", "name": "东鹏饮料"},
    {"code": "600887", "name": "伊利股份"},
    {"code": "002946", "name": "新乳业"},
    {"code": "600597", "name": "光明乳业"},
    {"code": "603288", "name": "海天味业"},
    {"code": "603027", "name": "千禾味业"},
    {"code": "600305", "name": "恒顺醋业"},
    {"code": "600298", "name": "安琪酵母"},
    {"code": "002847", "name": "盐津铺子"},
    {"code": "603517", "name": "绝味食品"},
    {"code": "300783", "name": "三只松鼠"},
    {"code": "002991", "name": "甘源食品"},
    {"code": "000895", "name": "双汇发展"},
    {"code": "603345", "name": "安井食品"},
    {"code": "002507", "name": "涪陵榨菜"},
    {"code": "001215", "name": "千味央厨"},
    {"code": "603043", "name": "广州酒家"}
  ]
}
```

- [ ] **Step 3: Run configuration assertions**

Run:

```powershell
@'
import json
from pathlib import Path
d = json.loads(Path('web/data/custom_boards_config.json').read_text(encoding='utf-8'))
matches = [b for b in d['boards'] if b.get('code') == 'shipinyinliao']
assert len(matches) == 1
b = matches[0]
assert b['name'] == '食品饮料'
assert len(b['stocks']) == 25
assert len({s['code'] for s in b['stocks']}) == 25
assert all(len(s['code']) == 6 and s['code'].isdigit() and s['name'] for s in b['stocks'])
print('food beverage config OK: 25 unique stocks')
'@ | python -
```

Expected: `food beverage config OK: 25 unique stocks`.

- [ ] **Step 4: Commit the configuration**

```powershell
git add web/data/custom_boards_config.json
git commit -m "feat: add food beverage core board"
```

### Task 3: Regenerate and Validate Dashboard Data

**Files:**
- Modify: `web/data/custom_boards.json`
- Modify/Create: `web/data/custom_boards/history/*.json`
- Modify: `web/data/custom_boards/index.json`
- Modify: `web/data/custom_board_membership.json`

- [ ] **Step 1: Refresh the latest trading-date data**

Run for the current dashboard trading date:

```powershell
python .\scripts\update_daily_data.py --date 20260730 --full-during-trading
```

Expected: completion with `errors: 0` and `Daily data update complete.` If an external source fails, preserve the configuration change and report the exact missing refresh instead of substituting live data for a different date.

- [ ] **Step 2: Run the standard validation**

Run:

```powershell
python .\scripts\validate_web_data.py
```

Expected: exit code 0; custom board validation reports 24 configured/generated boards.

- [ ] **Step 3: Verify generated board membership**

Run:

```powershell
@'
import json
from pathlib import Path
d = json.loads(Path('web/data/custom_boards.json').read_text(encoding='utf-8'))
matches = [b for b in d['boards'] if b.get('code') == 'shipinyinliao']
assert len(matches) == 1
b = matches[0]
rows = b.get('trend', [])
assert rows
latest = rows[-1]
assert latest.get('stockCount') == 25
assert len(latest.get('stocks', [])) == 25
print(f"generated food beverage board OK: date={latest.get('date')}, stocks=25")
'@ | python -
```

Expected: `generated food beverage board OK: date=2026-07-30, stocks=25`.

- [ ] **Step 4: Review generated-file scope**

Run:

```powershell
git status --short
git diff --stat
```

Expected: configuration and generated custom-board data are changed; unrelated pre-existing workspace changes remain untouched.

