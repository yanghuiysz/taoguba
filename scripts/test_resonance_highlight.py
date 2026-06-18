import json
from pathlib import Path


def test_resonance_highlight_uses_manual_date_only():
    source = Path("web/custom-resonance.js").read_text(encoding="utf-8")
    segment = source[source.index("function dailyTopBoards"):source.index("function refreshPanelOnly")]
    config = json.loads(Path("web/data/custom_resonance_config.json").read_text(encoding="utf-8"))

    assert "state?.data?.date" not in segment
    assert "state?.sortDate" not in segment
    assert "CUSTOM_RESONANCE_CONFIG_URL" in source
    assert "stateConfig.highlightDate" in segment
    assert "marketNotesForDate(date)" in segment
    assert config["highlightDate"] in config["marketNotes"]
    assert all(isinstance(note, str) and note for note in config["marketNotes"][config["highlightDate"]])


def test_resonance_renders_secondary_market_index_in_existing_index_column():
    source = Path("web/custom-resonance.js").read_text(encoding="utf-8")
    data = json.loads(Path("web/data/custom_boards.json").read_text(encoding="utf-8"))

    assert "secondaryMarketIndex" in data
    assert data["secondaryMarketIndex"]["name"] == "创业板指"
    assert "resonance-secondary-index-value" in source
    assert "row.index.secondary" in source
    assert "grid-template-columns: 72px 150px minmax(0, 1fr)" in Path("web/custom-resonance.css").read_text(encoding="utf-8")


if __name__ == "__main__":
    test_resonance_highlight_uses_manual_date_only()
    test_resonance_renders_secondary_market_index_in_existing_index_column()
    print("resonance highlight date behavior ok")
