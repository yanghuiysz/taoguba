from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import intraday_radar_daemon as daemon


class AfterCloseRefreshTest(unittest.TestCase):
    def test_after_close_refresh_starts_at_configured_time(self) -> None:
        self.assertFalse(
            daemon.should_run_after_close_refresh(
                datetime(2026, 6, 25, 15, 29), "15:30"
            )
        )
        self.assertTrue(
            daemon.should_run_after_close_refresh(
                datetime(2026, 6, 25, 15, 30), "15:30"
            )
        )

    def test_after_close_refresh_skips_weekends(self) -> None:
        self.assertFalse(
            daemon.should_run_after_close_refresh(
                datetime(2026, 6, 27, 15, 30), "15:30"
            )
        )

    def test_failed_refresh_does_not_record_completion_and_can_retry(self) -> None:
        with (
            patch.object(daemon, "run_after_close_refresh", side_effect=[False, True]) as refresh,
            patch.object(daemon, "save_last_closing_refresh_date") as save,
        ):
            self.assertFalse(
                daemon.attempt_after_close_refresh("20260731", Path("daemon.log"))
            )
            save.assert_not_called()
            self.assertTrue(
                daemon.attempt_after_close_refresh("20260731", Path("daemon.log"))
            )
            save.assert_called_once_with("20260731")
            self.assertEqual(refresh.call_count, 2)


if __name__ == "__main__":
    unittest.main()
