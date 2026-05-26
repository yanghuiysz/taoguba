from pathlib import Path


def test_resonance_highlight_uses_manual_date_only():
    source = Path("web/custom-resonance.js").read_text(encoding="utf-8")
    segment = source[source.index("function dailyTopBoards"):source.index("function refreshPanelOnly")]
    config = Path("web/data/custom_resonance_config.json").read_text(encoding="utf-8")

    assert "state?.data?.date" not in segment
    assert "state?.sortDate" not in segment
    assert "CUSTOM_RESONANCE_CONFIG_URL" in source
    assert "stateConfig.highlightDate" in segment
    assert '"highlightDate": "2026-05-22"' in config


if __name__ == "__main__":
    test_resonance_highlight_uses_manual_date_only()
    print("resonance highlight date behavior ok")
