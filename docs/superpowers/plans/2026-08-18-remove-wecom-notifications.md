# Remove WeCom Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove WeCom notification code while preserving intraday data refresh and auction-probe analysis.

**Architecture:** Remove the two notification-only modules, then simplify each caller so it retains only data production responsibilities. Add static regression checks that reject remaining WeCom identifiers and run the existing functional tests for both workflows.

**Tech Stack:** Python 3.11, `unittest`, repository text validation.

## Global Constraints

- Preserve intraday radar data construction and scheduled refresh.
- Preserve auction data fetching, snapshot persistence, alert calculation, and one-shot execution.
- Do not delete `.env` or unrelated environment configuration.
- Do not commit unrelated existing workspace changes.

---

### Task 1: Lock the removal boundary with a regression test

**Files:**
- Create: `scripts/test_no_wecom_notifications.py`

**Interfaces:**
- Consumes: repository Python and README files.
- Produces: a test that fails while WeCom files or identifiers remain.

- [ ] Add a test asserting `scripts/notify_wecom.py` and `scripts/notify_intraday_radar.py` do not exist.
- [ ] Add a test scanning active Python and README content for `WECOM_WEBHOOK_URL`, `WeComNotifier`, `notify_wecom`, and `notify_intraday_radar`.
- [ ] Run the test and verify it fails because the current notification files and references exist.

### Task 2: Remove notification modules and caller integration

**Files:**
- Delete: `scripts/notify_wecom.py`
- Delete: `scripts/notify_intraday_radar.py`
- Modify: `scripts/intraday_radar_daemon.py`
- Modify: `scripts/auction_probe.py`

**Interfaces:**
- Consumes: existing radar refresh and auction snapshot functions.
- Produces: notification-free command-line workflows with the same data outputs.

- [ ] Delete both notification-only modules.
- [ ] Remove notification scheduling, arguments, subprocess calls, imports, and logs from the radar daemon.
- [ ] Remove notifier imports, `maybe_notify`, webhook arguments, notification switches, and send calls from the auction probe.
- [ ] Run the removal test and focused radar/auction tests.

### Task 3: Remove documentation and verify the repository

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the notification-free workflows from Task 2.
- Produces: documentation that describes only supported behavior.

- [ ] Remove WeCom setup, webhook security notes, notification cadence, and script listings from README.
- [ ] Run the static removal test and a full repository search for remaining identifiers.
- [ ] Run Python syntax checks and the relevant unit-test suite.
- [ ] Run `git diff --check` on all touched files.
