# AI Application Core Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one 20-stock `AI应用` board containing ten fundamental leaders and ten high-heat application stocks, then generate and publish the latest dashboard data.

**Architecture:** Extend only the declarative custom-board configuration; retain the existing page and data-builder behavior. Run the existing intraday-aware daily pipeline for 2026-07-31 and verify that all 20 members have current quote and fund-flow data.

**Tech Stack:** UTF-8 JSON, Python 3.11, existing daily-data scripts, pytest, unittest

## Global Constraints

- The board code is exactly `aiyingyong` and the display name is exactly `AI应用`.
- The board contains exactly 20 unique A-share codes: ten fundamental and ten high-heat application names.
- Do not add chip, server, computing-rental, optical-module, liquid-cooling, robot-body, or robot-component stocks.
- Work directly on `main` as previously authorized; keep `output/` and `tmp/` untracked.

---

### Task 1: Add and Verify the AI Application Configuration

**Files:**
- Modify: `web/data/custom_boards_config.json`
- Read: `docs/superpowers/specs/2026-07-31-ai-application-board-design.md`
- Create: `docs/superpowers/plans/2026-07-31-ai-application-board.md`

**Interfaces:**
- Consumes: existing `boards: list[dict]` JSON structure
- Produces: one unique board object with `code`, `name`, and `stocks`

- [ ] **Step 1: Verify the board is initially absent**

```powershell
@'
import json
from pathlib import Path
d=json.loads(Path('web/data/custom_boards_config.json').read_text(encoding='utf-8'))
b=[x for x in d['boards'] if x.get('code')=='aiyingyong']
assert len(b)==1 and len(b[0]['stocks'])==20
'@ | python -
```

Expected: assertion failure because the board does not exist.

- [ ] **Step 2: Append the board object**

```json
{
  "code": "aiyingyong",
  "name": "AI应用",
  "stocks": [
    {"code": "688111", "name": "金山办公"},
    {"code": "002230", "name": "科大讯飞"},
    {"code": "600588", "name": "用友网络"},
    {"code": "600570", "name": "恒生电子"},
    {"code": "300033", "name": "同花顺"},
    {"code": "601360", "name": "三六零"},
    {"code": "300418", "name": "昆仑万维"},
    {"code": "002410", "name": "广联达"},
    {"code": "300253", "name": "卫宁健康"},
    {"code": "688615", "name": "合合信息"},
    {"code": "300058", "name": "蓝色光标"},
    {"code": "300624", "name": "万兴科技"},
    {"code": "300229", "name": "拓尔思"},
    {"code": "300364", "name": "中文在线"},
    {"code": "301171", "name": "易点天下"},
    {"code": "000681", "name": "视觉中国"},
    {"code": "688365", "name": "光云科技"},
    {"code": "688369", "name": "致远互联"},
    {"code": "300785", "name": "值得买"},
    {"code": "002555", "name": "三七互娱"}
  ]
}
```

- [ ] **Step 3: Verify configuration invariants**

```powershell
@'
import json
from pathlib import Path
d=json.loads(Path('web/data/custom_boards_config.json').read_text(encoding='utf-8'))
m=[x for x in d['boards'] if x.get('code')=='aiyingyong']
assert len(m)==1
b=m[0]
assert b['name']=='AI\u5e94\u7528'
assert len(b['stocks'])==20
assert len({s['code'] for s in b['stocks']})==20
assert all(len(s['code'])==6 and s['code'].isdigit() and s['name'] for s in b['stocks'])
print('AI application config OK: 20 unique stocks')
'@ | python -
```

Expected: the 20-stock success line and total configured boards equals 26.

- [ ] **Step 4: Commit the configuration and plan**

```powershell
git add web/data/custom_boards_config.json docs/superpowers/plans/2026-07-31-ai-application-board.md
git commit -m "feat: add AI application core board"
```

### Task 2: Generate, Test, and Publish the Latest Data

**Files:**
- Modify: `web/data/custom_boards.json`
- Modify/Create: `web/data/custom_boards/history/*.json`
- Modify: `web/data/custom_boards/index.json`
- Modify: `web/data/full_a_turnover_top20.json`

**Interfaces:**
- Consumes: `aiyingyong` configuration from Task 1 and external quote/fund-flow sources
- Produces: generated board with `stockCount`, `availableStockCount`, `latestFundFlowStockCount`, and `stocks`

- [ ] **Step 1: Generate the 2026-07-31 intraday snapshot**

```powershell
python .\scripts\update_daily_data.py --date 20260731 --intraday-custom --full-during-trading --custom-sleep 0
```

Expected: 26 boards, zero custom-board errors, and daily update completion. Optional full-market turnover ranking may use its existing fallback.

- [ ] **Step 2: Verify 20/20 AI application coverage**

```powershell
@'
import json
from pathlib import Path
d=json.loads(Path('web/data/custom_boards.json').read_text(encoding='utf-8'))
b=next(x for x in d['boards'] if x.get('code')=='aiyingyong')
assert d['date']=='2026-07-31'
assert b['stockCount']==20
assert b['availableStockCount']==20
assert b['latestFundFlowStockCount']==20
assert len(b['stocks'])==20
print('AI application generated data OK: 20/20/20')
'@ | python -
```

- [ ] **Step 3: Run standard and automated validation**

```powershell
python .\scripts\validate_web_data.py
python -m pytest scripts/test_ths_fund_flow_validation.py -q
python -m unittest discover -s scripts -p "test_*.py"
```

Expected: all commands exit 0; generated/configured board count is 26.

- [ ] **Step 4: Commit and push generated data**

```powershell
git add -A -- web/data
git commit -m "data: build AI application board snapshots"
git push origin main
```

Expected: `main -> main`; `output/` and `tmp/` remain untracked.

