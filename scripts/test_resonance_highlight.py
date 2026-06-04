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
    assert config["highlightDate"] == "2026-06-04"
    assert config["marketNotes"]["2026-05-27"] == ["冲高回落", "科技大跌", "电力逆势上涨"]
    assert config["marketNotes"]["2026-05-28"] == ["低开高走", "科技走强", "缩量"]
    assert config["marketNotes"]["2026-05-29"] == ["高开低走", "双创破位", "巨量踩踏", "科技失血", "防守抱团"]
    assert config["marketNotes"]["2026-06-01"] == ["高开低走", "科技补跌", "缩量"]
    assert config["marketNotes"]["2026-06-02"] == ["指数企稳", "科技引领复苏"]
    assert config["marketNotes"]["2026-06-03"] == ["指数冲高回落", "回暖后", "科技第二次分歧"]
    assert config["marketNotes"]["2026-06-04"] == ["弱势震荡", "缩量普跌", "半导体逆势"]


if __name__ == "__main__":
    test_resonance_highlight_uses_manual_date_only()
    print("resonance highlight date behavior ok")
