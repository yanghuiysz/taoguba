# 同花顺资金净流入接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用免费同花顺全市场即时资金流替换失效的东方财富逐股资金流刷新，并在自定义板块中按同日、可核验覆盖率展示“资金净流入（同花顺口径）”。

**Architecture:** 新建独立的同花顺资金快照模块，负责全市场单次获取、中文金额解析、校验和按交易日缓存。`build_custom_board_data.py` 只消费标准化快照并继续输出现有 `mainNetInflow` 兼容字段；前端和校验器负责展示来源、日期、覆盖率并拒绝把缺失值当作 0。

**Tech Stack:** Python 3.11、AKShare、pandas、JSON、原生 JavaScript、现有脚本式测试框架。

---

## 文件结构

- Create: `scripts/ths_fund_flow.py` — 同花顺请求、金额解析、标准化、校验和快照缓存。
- Create: `scripts/test_ths_fund_flow.py` — 数据转换、匹配、缓存及失败保护测试。
- Modify: `scripts/build_custom_board_data.py` — 使用同花顺按日快照构建资金流映射，写入来源和覆盖率。
- Modify: `scripts/update_daily_data.py` — 收盘完整日更启用同花顺快照；盘中快速路径不重复抓取。
- Modify: `scripts/validate_web_data.py` — 校验资金日期、来源、覆盖率和空值语义。
- Modify: `web/custom.js` — 文案改为“资金净流入”，显示同花顺口径与覆盖状态。
- Modify: `web/custom-swing.js` — 波段页资金列改名并保持空值为暂无。
- Modify: `README.md` — 记录数据来源、更新时间、缓存位置和口径限制。

### Task 1: 同花顺金额解析与行标准化

**Files:**
- Create: `scripts/ths_fund_flow.py`
- Create: `scripts/test_ths_fund_flow.py`

- [ ] **Step 1: 写金额解析失败测试**

```python
from ths_fund_flow import parse_amount_yuan


def test_parse_amount_yuan_supports_chinese_units_and_missing_values():
    assert parse_amount_yuan("1.25亿") == 125_000_000.0
    assert parse_amount_yuan("-7200.36万") == -72_003_600.0
    assert parse_amount_yuan("1350") == 1350.0
    assert parse_amount_yuan("--") is None
    assert parse_amount_yuan(None) is None
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `python .\scripts\test_ths_fund_flow.py`

Expected: FAIL with `ModuleNotFoundError: No module named 'ths_fund_flow'`.

- [ ] **Step 3: 实现金额解析**

```python
from __future__ import annotations

from typing import Any


def parse_amount_yuan(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text in {"--", "-", "None", "nan"}:
        return None
    multiplier = 1.0
    if text.endswith("亿"):
        multiplier = 100_000_000.0
        text = text[:-1]
    elif text.endswith("万"):
        multiplier = 10_000.0
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None
```

- [ ] **Step 4: 增加标准化行的失败测试**

```python
from ths_fund_flow import normalize_ths_rows


def test_normalize_ths_rows_uses_six_digit_codes_and_yuan_amounts():
    rows = normalize_ths_rows(
        [{
            "股票代码": 21,
            "股票简称": "深科技",
            "流入资金": "2亿",
            "流出资金": "1.5亿",
            "净额": "5000万",
            "成交额": "8亿",
        }],
        "2026-07-15",
    )
    assert rows == [{
        "date": "2026-07-15",
        "code": "000021",
        "name": "深科技",
        "inflow": 200_000_000.0,
        "outflow": 150_000_000.0,
        "mainNetInflow": 50_000_000.0,
        "turnover": 800_000_000.0,
        "source": "ths_stock_fund_flow_individual",
    }]
```

- [ ] **Step 5: 实现标准化并运行测试**

```python
def normalize_code(value: Any) -> str:
    digits = "".join(char for char in str(value or "") if char.isdigit())
    return digits[-6:].zfill(6) if digits else ""


def normalize_ths_rows(records: list[dict[str, Any]], trade_date: str) -> list[dict[str, Any]]:
    normalized = []
    for record in records:
        code = normalize_code(record.get("股票代码"))
        net = parse_amount_yuan(record.get("净额"))
        if not code or net is None:
            continue
        normalized.append({
            "date": trade_date,
            "code": code,
            "name": str(record.get("股票简称") or code),
            "inflow": parse_amount_yuan(record.get("流入资金")),
            "outflow": parse_amount_yuan(record.get("流出资金")),
            "mainNetInflow": net,
            "turnover": parse_amount_yuan(record.get("成交额")),
            "source": "ths_stock_fund_flow_individual",
        })
    return normalized
```

Run: `python .\scripts\test_ths_fund_flow.py`

Expected: PASS.

- [ ] **Step 6: 提交解析模块**

```powershell
git add scripts/ths_fund_flow.py scripts/test_ths_fund_flow.py
git commit -m "feat: normalize THS fund flow rows"
```

### Task 2: 全市场获取、校验与按日快照

**Files:**
- Modify: `scripts/ths_fund_flow.py`
- Modify: `scripts/test_ths_fund_flow.py`

- [ ] **Step 1: 写快照复用和失败保护测试**

```python
import json
import tempfile
from pathlib import Path

from ths_fund_flow import load_or_fetch_snapshot


def test_load_or_fetch_snapshot_reuses_valid_same_day_cache():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "20260715" / "all.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({
            "date": "2026-07-15",
            "source": "ths_stock_fund_flow_individual",
            "rows": [{"date": "2026-07-15", "code": "000021", "mainNetInflow": 1.0}],
        }), encoding="utf-8")
        calls = []
        payload = load_or_fetch_snapshot("20260715", Path(tmp), lambda: calls.append(True))
        assert calls == []
        assert payload["rows"][0]["code"] == "000021"


def test_load_or_fetch_snapshot_does_not_overwrite_cache_when_fetch_fails():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        try:
            load_or_fetch_snapshot("20260715", root, lambda: (_ for _ in ()).throw(RuntimeError("offline")))
        except RuntimeError as exc:
            assert str(exc) == "offline"
        else:
            raise AssertionError("fetch failure must propagate")
        assert not (root / "20260715" / "all.json").exists()
```

- [ ] **Step 2: 运行测试并确认函数不存在**

Run: `python .\scripts\test_ths_fund_flow.py`

Expected: FAIL importing `load_or_fetch_snapshot`.

- [ ] **Step 3: 实现请求与快照缓存**

```python
import json
from pathlib import Path
from typing import Callable

import akshare as ak


def fetch_ths_records() -> list[dict[str, Any]]:
    frame = ak.stock_fund_flow_individual(symbol="即时")
    return frame.to_dict(orient="records")


def snapshot_path(root: Path, trade_date: str) -> Path:
    return root / trade_date.replace("-", "") / "all.json"


def snapshot_is_valid(payload: dict[str, Any], trade_date: str, minimum_rows: int = 3000) -> bool:
    rows = payload.get("rows")
    return (
        payload.get("date") == trade_date
        and payload.get("source") == "ths_stock_fund_flow_individual"
        and isinstance(rows, list)
        and len(rows) >= minimum_rows
    )


def load_or_fetch_snapshot(
    trade_date: str,
    root: Path,
    fetcher: Callable[[], list[dict[str, Any]]] = fetch_ths_records,
    force: bool = False,
    minimum_rows: int = 3000,
) -> dict[str, Any]:
    formatted = f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}" if "-" not in trade_date else trade_date
    path = snapshot_path(root, formatted)
    if path.exists() and not force:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if snapshot_is_valid(cached, formatted, minimum_rows):
            return cached
    rows = normalize_ths_rows(fetcher(), formatted)
    payload = {"date": formatted, "source": "ths_stock_fund_flow_individual", "rows": rows}
    if not snapshot_is_valid(payload, formatted, minimum_rows):
        raise ValueError(f"THS fund flow coverage too low: {len(rows)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
```

- [ ] **Step 4: 让小样本测试显式使用低阈值并运行测试**

测试中的 `load_or_fetch_snapshot` 调用传入 `minimum_rows=1`，再运行：

Run: `python .\scripts\test_ths_fund_flow.py`

Expected: PASS.

- [ ] **Step 5: 提交快照功能**

```powershell
git add scripts/ths_fund_flow.py scripts/test_ths_fund_flow.py
git commit -m "feat: cache daily THS fund flow snapshots"
```

### Task 3: 将同花顺快照接入自定义板块构建

**Files:**
- Modify: `scripts/build_custom_board_data.py`
- Create: `scripts/test_ths_fund_flow_integration.py`

- [ ] **Step 1: 写代码匹配和同日保护失败测试**

```python
from build_custom_board_data import ths_fund_flow_map


def test_ths_fund_flow_map_matches_codes_and_rejects_another_date():
    payload = {
        "date": "2026-07-15",
        "source": "ths_stock_fund_flow_individual",
        "rows": [
            {"date": "2026-07-15", "code": "000021", "mainNetInflow": 5.0},
            {"date": "2026-07-14", "code": "000034", "mainNetInflow": 6.0},
        ],
    }
    result = ths_fund_flow_map(payload, {"000021", "000034"}, "2026-07-15")
    assert result["000021"][0]["mainNetInflow"] == 5.0
    assert result["000034"] == []
```

- [ ] **Step 2: 运行测试并确认辅助函数不存在**

Run: `python .\scripts\test_ths_fund_flow_integration.py`

Expected: FAIL importing `ths_fund_flow_map`.

- [ ] **Step 3: 实现快照映射并替换默认资金源**

在 `build_custom_board_data.py` 中导入 `load_or_fetch_snapshot`，增加：

```python
THS_FUND_FLOW_CACHE_DIR = Path("data/custom_fund_flow_ths")


def ths_fund_flow_map(payload: dict[str, Any], codes: set[str], date: str) -> dict[str, list[dict[str, Any]]]:
    target = format_date(date)
    result = {code: [] for code in codes}
    for row in payload.get("rows") or []:
        code = normalize_stock_code(row.get("code"))
        if code in result and row.get("date") == target:
            result[code] = [row]
    return result
```

将完整构建路径中的原 `build_fund_flow_map(...)` 调用替换为：

```python
snapshot = load_or_fetch_snapshot(
    args.date,
    args.ths_fund_flow_cache_dir,
    force=args.refresh_fund_flow,
)
fund_flows = ths_fund_flow_map(snapshot, set(codes), args.date)
```

新增参数：

```python
parser.add_argument("--ths-fund-flow-cache-dir", type=Path, default=THS_FUND_FLOW_CACHE_DIR)
```

保留旧的东方财富函数用于读取既有历史，不再作为新交易日默认刷新源。

- [ ] **Step 4: 在输出中写入来源字段**

个股日行写入：

```python
"fundFlowSource": fund_flow.get("source") if fund_flow else None,
```

板块日行写入：

```python
"fundFlowSource": "ths_stock_fund_flow_individual" if main_net_inflows else None,
```

- [ ] **Step 5: 运行集成测试和现有资金流测试**

Run:

```powershell
python .\scripts\test_ths_fund_flow_integration.py
python .\scripts\test_fund_flow_freshness.py
```

Expected: both PASS.

- [ ] **Step 6: 提交构建接入**

```powershell
git add scripts/build_custom_board_data.py scripts/test_ths_fund_flow_integration.py
git commit -m "feat: build board fund flow from THS snapshot"
```

### Task 4: 日更调度与数据校验

**Files:**
- Modify: `scripts/update_daily_data.py`
- Modify: `scripts/validate_web_data.py`
- Create: `scripts/test_ths_fund_flow_validation.py`

- [ ] **Step 1: 写覆盖率校验失败测试**

```python
from validate_web_data import validate_fund_flow_row


def test_validate_fund_flow_row_flags_wrong_date_and_accepts_missing_amount():
    assert validate_fund_flow_row({
        "date": "2026-07-15",
        "mainNetInflow": None,
        "fundFlowLatestDate": None,
        "fundFlowStockCount": 0,
        "stockCount": 21,
    }) == []
    errors = validate_fund_flow_row({
        "date": "2026-07-15",
        "mainNetInflow": 10.0,
        "fundFlowLatestDate": "2026-07-14",
        "fundFlowStockCount": 21,
        "stockCount": 21,
    })
    assert "fund flow date mismatch" in errors
```

- [ ] **Step 2: 运行测试并确认校验函数不存在**

Run: `python .\scripts\test_ths_fund_flow_validation.py`

Expected: FAIL importing `validate_fund_flow_row`.

- [ ] **Step 3: 实现校验并接入主验证流程**

```python
def validate_fund_flow_row(row: dict[str, Any]) -> list[str]:
    errors = []
    amount = row.get("mainNetInflow")
    flow_date = row.get("fundFlowLatestDate")
    if amount is not None and flow_date != row.get("date"):
        errors.append("fund flow date mismatch")
    count = row.get("fundFlowStockCount")
    total = row.get("stockCount")
    if isinstance(count, (int, float)) and isinstance(total, (int, float)) and count > total:
        errors.append("fund flow coverage exceeds stock count")
    return errors
```

遍历板块最新趋势行，将错误加入现有验证失败列表。

- [ ] **Step 4: 确认调度行为**

保持 `update_daily_data.py` 的盘中 `--intraday-fast` 路径不调用全市场资金接口；收盘完整日更继续调用 `build_custom_board_data.py`，由同日有效快照自动复用。

在收盘日志中确认一次完整日更只出现一次：

```text
THS fund flow snapshot: 5000+/5000+ for YYYY-MM-DD
```

- [ ] **Step 5: 运行校验测试**

Run:

```powershell
python .\scripts\test_ths_fund_flow_validation.py
python .\scripts\validate_web_data.py
```

Expected: PASS and `Custom board data OK`.

- [ ] **Step 6: 提交调度和校验**

```powershell
git add scripts/update_daily_data.py scripts/validate_web_data.py scripts/test_ths_fund_flow_validation.py
git commit -m "test: validate THS fund flow freshness"
```

### Task 5: 页面口径与空值展示

**Files:**
- Modify: `web/custom.js`
- Modify: `web/custom-swing.js`
- Modify: `scripts/test_null_fund_flow_rendering.js`

- [ ] **Step 1: 扩展前端文案失败测试**

```javascript
const fs = require('fs');

for (const path of ['web/custom.js', 'web/custom-swing.js']) {
  const source = fs.readFileSync(path, 'utf8');
  if (source.includes('主力净流入')) {
    throw new Error(`${path} must not label THS net flow as main fund flow`);
  }
}
```

- [ ] **Step 2: 运行测试并确认旧文案导致失败**

Run: `node .\scripts\test_null_fund_flow_rendering.js`

Expected: FAIL mentioning `主力净流入`.

- [ ] **Step 3: 修改页面文案和覆盖提示**

将表头及卡片统一改为：

```text
资金净流入
```

将说明统一为：

```javascript
const fundFlowSourceText = (row) => (
  row?.fundFlowSource === 'ths_stock_fund_flow_individual'
    ? '同花顺口径'
    : '资金来源暂无'
);
```

详情摘要展示：

```text
资金净流入 2.35亿（同花顺口径，07-15，覆盖 18/21）
```

缺失值继续使用 `暂无`，不引入 `?? 0`。

- [ ] **Step 4: 运行前端测试和语法检查**

Run:

```powershell
node .\scripts\test_null_fund_flow_rendering.js
node --check .\web\custom.js
node --check .\web\custom-swing.js
```

Expected: all exit 0.

- [ ] **Step 5: 提交页面调整**

```powershell
git add web/custom.js web/custom-swing.js scripts/test_null_fund_flow_rendering.js
git commit -m "fix: label THS values as net fund flow"
```

### Task 6: 文档、真实数据刷新与最终验证

**Files:**
- Modify: `README.md`
- Generated: `data/custom_fund_flow_ths/YYYYMMDD/all.json`
- Generated/Modify: `web/data/custom_boards.json`

- [ ] **Step 1: 更新 README 数据口径**

增加以下内容：

```markdown
### 资金净流入

收盘完整日更通过 AKShare 的同花顺个股资金流接口一次获取全市场数据，
缓存到 `data/custom_fund_flow_ths/YYYYMMDD/all.json`。页面展示的是同花顺口径的
资金净额，不等同于机构、量化或大单资金。仅同日数据参与板块合计，缺失显示“暂无”。
```

- [ ] **Step 2: 运行完整收盘刷新**

Run:

```powershell
python .\scripts\update_daily_data.py --date 20260715 --intraday-custom --full-during-trading
```

Expected:

- 同花顺快照标准化行数不少于 3000；
- 自定义板块构建完成；
- 无资金日期错配错误。

- [ ] **Step 3: 验证实际覆盖率和非零值**

运行一个只读检查，使用 `custom_board_history.load_custom_board_payload` 载入拆分历史，断言：

```python
latest_rows = [board["trend"][-1] for board in payload["boards"] if board.get("trend")]
assert any((row.get("fundFlowStockCount") or 0) > 0 for row in latest_rows)
assert any(row.get("mainNetInflow") not in (None, 0) for row in latest_rows)
assert all(
    row.get("fundFlowLatestDate") in (None, row.get("date"))
    for row in latest_rows
)
```

- [ ] **Step 4: 运行完整相关验证**

Run:

```powershell
python .\scripts\test_ths_fund_flow.py
python .\scripts\test_ths_fund_flow_integration.py
python .\scripts\test_ths_fund_flow_validation.py
python .\scripts\test_fund_flow_freshness.py
node .\scripts\test_null_fund_flow_rendering.js
node --check .\web\custom.js
node --check .\web\custom-swing.js
python .\scripts\validate_web_data.py
git diff --check
```

Expected: all commands exit 0; no test failures or whitespace errors.

- [ ] **Step 5: 提交文档和最终接入**

```powershell
git add README.md
git commit -m "docs: document THS net fund flow source"
```

不自动提交生成数据，除非仓库现有约定要求提交对应的 `web/data` 日更文件。
