"""
盘中机会雷达微信推送
使用企业微信群机器人发送完整的盘中机会雷达数据
"""

from __future__ import annotations
import sys
from datetime import datetime
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))
_ROOT = Path(__file__).resolve().parents[1]

from scripts.intraday_radar_engine import (
    board_metric,
    index_gate,
    opportunity_rows,
    load_radar_data,
    signal_tone,
    transition_label,
    transition_rank,
)


def fmt_chg(chg: float) -> str:
    """涨跌幅颜色标注（A股红涨绿跌）"""
    if chg is None:
        return "-"
    if chg > 0:
        return f'<font color="red">+{chg:.2f}%</font>'
    elif chg < 0:
        return f'<font color="green">{chg:.2f}%</font>'
    return f"{chg:.2f}%"


def fmt_signal(signal: str, tone: str) -> str:
    """信号颜色"""
    colors = {
        "strong": "green",
        "test": "warning",
        "mixed": "red",
        "weak": "red",
        "watch": "info",
        "divergence": "red",
    }
    color = colors.get(tone, "info")
    return f'<font color="{color}">{signal}</font>'


def short_date(date_str: str) -> str:
    """日期缩写，和页面展示保持一致。"""
    return str(date_str or "")[5:] if date_str else "暂无"


def latest_data_date(data: dict) -> str:
    """获取页面使用的最新数据日期。"""
    explicit = data.get("date")
    if explicit:
        return explicit

    dates = []
    for board in data.get("boards", []):
        trend = board.get("trend") or []
        if trend and trend[-1].get("date"):
            dates.append(trend[-1]["date"])
    return sorted(dates)[-1] if dates else ""


def split_markdown_sections(
    header_lines: list[str],
    sections: list[list[str]],
    max_len: int = 2500,
) -> list[str]:
    """按企业微信 markdown 长度限制拆分消息。"""
    messages: list[str] = []
    current_lines = list(header_lines)

    for section in sections:
        candidate_lines = current_lines + [""] + section
        candidate = "\n".join(candidate_lines).strip()
        if len(candidate) <= max_len:
            current_lines = candidate_lines
            continue

        current_message = "\n".join(current_lines).strip()
        if current_message:
            messages.append(current_message)

        current_lines = list(header_lines) + [""] + section

    final_message = "\n".join(current_lines).strip()
    if final_message:
        messages.append(final_message)
    return messages


def grouped_board_sections(rows: list[dict], data: dict) -> list[list[str]]:
    """按变化结论分组，板块下挂对应盘中雷达个股。"""
    boards: dict[str, dict] = {}
    for item in rows:
        board = item["board"]
        board_code = str(board.get("code", ""))
        current_metric = item.get("current_metric", {})
        if current_metric.get("stage") == "退潮段":
            continue

        entry = boards.setdefault(
            board_code,
            {
                "board": board,
                "background_metric": item.get("background_metric", {}),
                "current_metric": current_metric,
                "current_state": item.get("current_state", {}),
                "signal": item.get("signal", "观察"),
                "items": [],
                "max_score": 0.0,
                "max_priority": 0,
            },
        )
        entry["items"].append(item)
        entry["max_score"] = max(entry["max_score"], item.get("opportunity_score", 0))
        entry["max_priority"] = max(entry["max_priority"], item.get("signal_priority", 0))

    grouped: dict[str, list[dict]] = {}
    for board_entry in boards.values():
        board_entry["items"].sort(key=lambda x: -x.get("opportunity_score", 0))
        conclusion = board_entry["current_state"].get("label", "观察")
        grouped.setdefault(conclusion, []).append(board_entry)

    sorted_conclusions = sorted(grouped.keys(), key=lambda label: transition_rank(label))
    sections: list[list[str]] = []
    for conclusion in sorted_conclusions:
        board_entries = grouped[conclusion]
        board_entries.sort(
            key=lambda item: (
                -(item["current_metric"].get("heat_score") or 0),
                -item["max_score"],
                -item["max_priority"],
            )
        )

        header = [
            f"## {fmt_signal(conclusion, signal_tone(conclusion))}  {len(board_entries)}个板块",
        ]
        sections.append(header)

        for idx, board_entry in enumerate(board_entries, 1):
            board = board_entry["board"]
            curr = board_entry["current_metric"]
            metric_chain = []
            for offset in (-3, -2, -1, 0):
                metric = board_metric(data, board, offset=offset)
                if metric and metric.get("stage"):
                    metric_chain.append(metric)

            structure_text = " -> ".join(
                f"**{metric.get('stage', '暂无')}**" for metric in metric_chain
            ) or f"**{curr.get('stage', '暂无')}**"

            block = [
                f"### {idx}. {board.get('name', '未知')}({board.get('code', '')})",
                f"- 板块结构：{structure_text}",
                f"- 变化结论：**{fmt_signal(conclusion, signal_tone(conclusion))}**",
                f"- 今日板块分数：**{curr.get('heat_score', 0):.0f}**",
            ]

            stock_lines = []
            for stock_idx, item in enumerate(board_entry["items"], 1):
                stock = item["stock"]
                stock_lines.append(
                    f"{stock_idx}. **{stock.get('name', '未知')}**({stock.get('code', '')}) "
                    f"{fmt_signal(item.get('signal', '观察'), signal_tone(item.get('signal', '观察')))} "
                    f"分**{item.get('opportunity_score', 0):.0f}**"
                )
            block.append(f"- 盘中雷达个股：{'； '.join(stock_lines)}")
            sections.append(block)

    return sections
def send_intraday_radar(data: dict, notifier, top_n: int = 80) -> tuple[bool, int]:
    """发送盘中机会雷达通知，返回 (是否成功, 机会数)"""
    if not data:
        print("[盘中雷达] 无数据，跳过推送")
        return False, 0

    rows = opportunity_rows(data, limit=top_n)
    if not rows:
        print("[盘中雷达] 无机会信号，跳过推送")
        return False, 0

    now = datetime.now()
    now_str = now.strftime("%m/%d %H:%M")

    latest_date = latest_data_date(data)
    background_date = rows[0].get("background_metric", {}).get("date", "") if rows else ""
    gate = index_gate(data)
    board_sections = grouped_board_sections(rows, data)

    header_lines = [
        f"# 盘中机会雷达 {now_str}",
        "",
        f"> 背景 {short_date(background_date)} / 盘中 {short_date(latest_date)}",
        f"> 指数闸门：**{gate.get('label', '暂无')} {gate.get('score', 0):.0f}分**；{gate.get('action', '暂无操作权限')}；{gate.get('reason', '')}",
        "",
    ]
    sections: list[list[str]] = []
    sections.extend(board_sections)

    messages = split_markdown_sections(header_lines, sections)
    sent = 0
    for idx, message in enumerate(messages, 1):
        if len(messages) > 1:
            title = f"# 盘中机会雷达 {now_str} ({idx}/{len(messages)})"
            message_lines = message.splitlines()
            message_lines[0] = title
            message = "\n".join(message_lines)
        if notifier.send_markdown(message):
            sent += 1

    return sent == len(messages), len(rows)


# ── CLI 入口 ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    from scripts.notify_wecom import WeComNotifier, _ROOT

    parser = argparse.ArgumentParser(description="盘中机会雷达推送")
    parser.add_argument("--webhook", default="", help="Webhook URL")
    parser.add_argument("--top", type=int, default=80, help="最大机会数")
    args = parser.parse_args()

    notifier = WeComNotifier(webhook_url=args.webhook)

    json_path = _ROOT / "web" / "data" / "custom_boards.json"
    data = load_radar_data(json_path)

    if not data:
        print("加载数据失败")
        sys.exit(1)

    ok, count = send_intraday_radar(data, notifier, top_n=args.top)
    print(f"发送{'成功' if ok else '失败'}，共{count}个机会")
    sys.exit(0 if ok else 1)
