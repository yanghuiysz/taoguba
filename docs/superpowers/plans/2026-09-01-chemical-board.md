# Chemical Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `化工` custom board containing the 18 approved chemical-sector stocks.

**Architecture:** Extend the existing JSON board configuration and let the current custom-board builder and frontend consume it without new special cases. Add a focused regression test for exact membership, then regenerate only the latest board payload.

**Tech Stack:** JSON configuration, Python tests, existing custom-board build and validation scripts.

## Global Constraints

- Work directly on the current branch.
- Preserve all unrelated working-tree changes.
- Board code is `huagong`; board name is `化工`.
- Membership is exactly the approved 18-stock list with unique stock codes.
- Do not backfill or rewrite historical board snapshots.

---

### Task 1: Lock the chemical board contract with a failing test

**Files:**
- Create: `scripts/test_chemical_board_config.py`
- Read: `web/data/custom_boards_config.json`

**Interfaces:**
- Consumes: JSON object with top-level `boards[]`.
- Produces: Regression assertions for board identity and exact stock membership.

- [ ] **Step 1: Write the failing test**

Create a test that loads the configuration, selects `code == "huagong"`, and asserts its name and exact ordered `(code, name)` list.

- [ ] **Step 2: Run test to verify it fails**

Run: `python scripts/test_chemical_board_config.py`

Expected: FAIL because `huagong` does not exist.

- [ ] **Step 3: Add the minimal configuration**

Append one board object containing the approved 18 stocks to `web/data/custom_boards_config.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python scripts/test_chemical_board_config.py`

Expected: PASS with `chemical board config ok`.

### Task 2: Generate and validate the latest payload

**Files:**
- Modify through generator: `web/data/custom_boards.json`
- Potentially modify through generator: `web/data/custom_board_membership.json`

**Interfaces:**
- Consumes: `web/data/custom_boards_config.json`.
- Produces: Latest frontend payload containing `huagong`.

- [ ] **Step 1: Run the existing custom-board builder for the latest date**

Use the existing builder with the current/latest date and without historical backfill.

- [ ] **Step 2: Verify generated membership**

Confirm `custom_boards.json` contains exactly one `huagong` board with 18 stocks.

- [ ] **Step 3: Run full relevant verification**

Run the chemical configuration test and `python scripts/validate_web_data.py`; report any upstream-data warnings separately from structural failures.

