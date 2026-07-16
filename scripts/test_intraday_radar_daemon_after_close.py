from __future__ import annotations

from datetime import datetime

from intraday_radar_daemon import should_run_after_close_refresh


def test_after_close_refresh_starts_at_configured_time() -> None:
    assert not should_run_after_close_refresh(datetime(2026, 6, 25, 15, 29), "15:30")
    assert should_run_after_close_refresh(datetime(2026, 6, 25, 15, 30), "15:30")


def test_after_close_refresh_skips_weekends() -> None:
    assert not should_run_after_close_refresh(datetime(2026, 6, 27, 15, 30), "15:30")


if __name__ == "__main__":
    test_after_close_refresh_starts_at_configured_time()
    test_after_close_refresh_skips_weekends()
