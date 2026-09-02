import json
from pathlib import Path


CONFIG_PATH = Path(__file__).resolve().parents[1] / "web" / "data" / "custom_boards_config.json"

EXPECTED_STOCKS = [
    ("600309", "万华化学"),
    ("600989", "宝丰能源"),
    ("600426", "华鲁恒升"),
    ("002648", "卫星化学"),
    ("600160", "巨化股份"),
    ("600096", "云天化"),
    ("600141", "兴发集团"),
    ("002493", "荣盛石化"),
    ("600352", "浙江龙盛"),
    ("600486", "扬农化工"),
    ("002601", "龙佰集团"),
    ("000408", "藏格矿业"),
    ("002440", "闰土股份"),
    ("002165", "红宝丽"),
    ("600227", "赤天化"),
    ("603077", "和邦生物"),
    ("002455", "百川股份"),
    ("603980", "吉华集团"),
]


def test_chemical_board_has_exact_approved_membership():
    payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    matches = [board for board in payload["boards"] if board.get("code") == "huagong"]

    assert len(matches) == 1
    board = matches[0]
    assert board["name"] == "化工"

    actual = [(stock["code"], stock["name"]) for stock in board["stocks"]]
    assert actual == EXPECTED_STOCKS
    assert len({code for code, _ in actual}) == len(actual)


if __name__ == "__main__":
    test_chemical_board_has_exact_approved_membership()
    print("chemical board config ok")
