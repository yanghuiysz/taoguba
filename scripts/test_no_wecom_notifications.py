import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REMOVED_FILES = (
    ROOT / "scripts" / "notify_wecom.py",
    ROOT / "scripts" / "notify_intraday_radar.py",
    ROOT / ".env.example",
)
FORBIDDEN_IDENTIFIERS = (
    "WECOM_" + "WEBHOOK_URL",
    "WeCom" + "Notifier",
    "notify_" + "wecom",
    "notify_" + "intraday_radar",
)


class NoWeComNotificationsTests(unittest.TestCase):
    def test_notification_only_modules_are_removed(self):
        remaining = [str(path.relative_to(ROOT)) for path in REMOVED_FILES if path.exists()]
        self.assertEqual(remaining, [])

    def test_active_code_and_readme_have_no_wecom_integrations(self):
        files = [ROOT / "README.md"]
        files.extend(
            path for path in (ROOT / "scripts").glob("*.py")
            if path != Path(__file__).resolve()
        )
        matches = []
        for path in files:
            text = path.read_text(encoding="utf-8")
            for identifier in FORBIDDEN_IDENTIFIERS:
                if identifier in text:
                    matches.append(f"{path.relative_to(ROOT)}: {identifier}")
        self.assertEqual(matches, [])


if __name__ == "__main__":
    unittest.main()
