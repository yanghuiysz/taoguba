"""
企业微信群机器人通知模块
支持：文本、Markdown、图文卡片消息

用法:
  from scripts.notify_wecom import WeComNotifier

  notifier = WeComNotifier()
  notifier.send_markdown("## 板块雷达\n> **半导体** 涨3.2%")

推荐方式（自动读取 .env 文件，无需手动设置环境变量）:
  在项目根目录创建 .env 文件，内容：
    WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY
  然后直接运行：python scripts/notify_wecom.py --once
"""

from __future__ import annotations

import json
import os
import sys
import time
import base64
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error


# ── 自动加载 .env 文件（无需第三方库）─────────────────────────────────────
def _load_env_file(env_path: Path) -> None:
    """从 .env 文件读取环境变量（仅设置当前未设置的项）"""
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value


_ROOT = Path(__file__).resolve().parents[1]
_load_env_file(_ROOT / ".env")

DEFAULT_WEBHOOK_URL = os.environ.get("WECOM_WEBHOOK_URL", "")


# ── 工具函数 ────────────────────────────────────────────────────────────────
def fmt_chg(chg: float) -> str:
    """涨跌幅颜色标注（A股红涨绿跌）"""
    if chg > 0:
        return f'<font color="red">+{chg:.2f}%</font>'
    elif chg < 0:
        return f'<font color="green">{chg:.2f}%</font>'
    return f"{chg:.2f}%"


def fmt_amount(amount: float) -> str:
    """成交额格式化"""
    if amount >= 1e8:
        return f"{amount / 1e8:.1f}亿"
    if amount >= 1e4:
        return f"{amount / 1e4:.0f}万"
    return f"{amount:.0f}"


# ── 通知器 ─────────────────────────────────────────────────────────────────
class WeComNotifier:
    def __init__(self, webhook_url: str = "", timeout: int = 10) -> None:
        self.webhook_url = webhook_url or DEFAULT_WEBHOOK_URL
        self.timeout = timeout
        if not self.webhook_url:
            print(
                "[WeComNotifier] WARNING: webhook_url 未设置，"
                "请传入参数、设置环境变量 WECOM_WEBHOOK_URL，或在 .env 文件中配置",
                file=sys.stderr,
            )

    def _post(self, payload: dict) -> bool:
        if not self.webhook_url:
            print("[WeComNotifier] 跳过发送：webhook_url 为空", file=sys.stderr)
            return False
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.webhook_url,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                if result.get("errcode") == 0:
                    return True
                print(
                    f"[WeComNotifier] 发送失败: errcode={result.get('errcode')}, "
                    f"errmsg={result.get('errmsg')}",
                    file=sys.stderr,
                )
                return False
        except urllib.error.URLError as exc:
            print(f"[WeComNotifier] 网络请求失败: {exc}", file=sys.stderr)
            return False
        except Exception as exc:
            print(f"[WeComNotifier] 未知错误: {exc}", file=sys.stderr)
            return False

    def send_text(self, content: str, mentioned_list: Optional[list] = None) -> bool:
        payload: dict = {"msgtype": "text", "text": {"content": content}}
        if mentioned_list:
            payload["text"]["mentioned_list"] = mentioned_list
        return self._post(payload)

    def send_markdown(self, content: str) -> bool:
        return self._post({"msgtype": "markdown", "markdown": {"content": content}})

    def send_news(self, title: str, description: str, url: str, picurl: str = "") -> bool:
        article: dict = {"title": title, "description": description, "url": url}
        if picurl:
            article["picurl"] = picurl
        return self._post({"msgtype": "news", "news": {"articles": [article]}})

    def send_image(self, image_path: str | Path) -> bool:
        path = Path(image_path)
        if not path.exists():
            print(f"[WeComNotifier] 图片不存在: {path}", file=sys.stderr)
            return False
        try:
            content = path.read_bytes()
        except Exception as exc:
            print(f"[WeComNotifier] 读取图片失败: {exc}", file=sys.stderr)
            return False

        payload = {
            "msgtype": "image",
            "image": {
                "base64": base64.b64encode(content).decode("utf-8"),
                "md5": hashlib.md5(content).hexdigest(),
            },
        }
        return self._post(payload)

    # ── 两段式板块推送 ──────────────────────────────────────────────────
    def send_board_radar(self, boards: list[dict], top_n: int = 10) -> tuple[bool, bool]:
        """发送两部分板块观察消息，返回 (盘中雷达结果, 波段观察结果)

        第一部分「盘中雷达」：按涨幅排序前N，显示均涨、红盘率、成交额
        第二部分「热门板块波段观察」：按高位率排序，显示新高率/近高率/近3天均涨趋势
        """
        if not boards:
            return False, False

        now_str = datetime.now().strftime("%m/%d %H:%M")

        # ── 第一部分：盘中雷达（按涨幅排序）─────────────────────────────
        by_change = sorted(boards, key=lambda x: x.get("change_pct", 0), reverse=True)[:top_n]
        lines1 = [f"## 盘中雷达  {now_str}"]
        lines1.append("> 按板块均涨排序，红涨绿跌")
        lines1.append("")
        for i, b in enumerate(by_change, 1):
            name = b.get("name", "未知")
            chg = b.get("change_pct", 0)
            up_ratio = b.get("up_ratio", 0)
            amount = b.get("amount", 0)
            lines1.append(
                f"> {i}. **{name}** {fmt_chg(chg)}  "
                f"红盘{up_ratio:.0f}%  {fmt_amount(amount)}"
            )

        ok1 = self.send_markdown("\n".join(lines1))

        # ── 第二部分：热门板块波段观察（按高位率排序）─────────────────────
        # 高位综合分 = high100_rate * 2 + nearHigh100_rate（新高权重更高）
        by_high = sorted(
            boards,
            key=lambda x: x.get("high100_rate", 0) * 2 + x.get("nearHigh100_rate", 0),
            reverse=True,
        )[:top_n]

        lines2 = [f"## 热门板块波段观察  {now_str}"]
        lines2.append("> 按百日新高率+近高率排序，高位率越高说明板块越强势")

        for i, b in enumerate(by_high, 1):
            name = b.get("name", "未知")
            high_rate = b.get("high100_rate", 0)
            near_rate = b.get("nearHigh100_rate", 0)
            # 取最近3天趋势
            trend = b.get("trend", [])
            recent = trend[-3:] if len(trend) >= 3 else trend

            # 近3天均涨趋势字符串
            trend_str = ""
            for t in recent:
                chg = t.get("averageChange", 0)
                if chg > 0:
                    trend_str += f'<font color="red">+{chg:.1f}</font>'
                elif chg < 0:
                    trend_str += f'<font color="green">{chg:.1f}</font>'
                else:
                    trend_str += f"{chg:.1f}"
                trend_str += " / "

            if trend_str:
                trend_str = trend_str.rstrip(" / ")

            # 高位率标注
            if high_rate >= 20:
                flag = "🔥"
            elif high_rate >= 10:
                flag = "⚡"
            elif near_rate >= 30:
                flag = "💫"
            elif near_rate >= 10:
                flag = "✨"
            else:
                flag = ""

            lines2.append(
                f"> {i}. **{name}** {flag}\n"
                f">    新高率{high_rate:.0f}%  近高率{near_rate:.0f}%  "
                f"近3日趋势：{trend_str or '-'}"
            )

        ok2 = self.send_markdown("\n".join(lines2))
        return ok1, ok2


# ── 数据加载 ─────────────────────────────────────────────────────────────────
def load_custom_boards(json_path: Path) -> list[dict]:
    """从 custom_boards.json 加载板块数据，并标准化字段名"""
    if not json_path.exists():
        return []
    try:
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, dict):
            boards = data.get("boards", [])
        elif isinstance(data, list):
            boards = data
        else:
            return []

        result = []
        for b in boards:
            stocks = b.get("stocks", [])
            up_ratio = 0.0
            if stocks:
                # 支持多种涨跌幅字段名
                up_count = sum(
                    1 for s in stocks
                    if (s.get("changePercent") or s.get("latestChangePercent") or 0) > 0
                )
                up_ratio = up_count / len(stocks) * 100

            # 取近3天波段趋势
            trend_raw = b.get("boardNewHighTrend", [])
            trend = []
            for t in (trend_raw[-3:] if len(trend_raw) >= 3 else trend_raw):
                trend.append({
                    "date": t.get("date", ""),
                    "averageChange": t.get("averageChange", 0),
                    "high100Rate": t.get("high100Rate", 0),
                    "nearHigh100Rate": t.get("nearHigh100Rate", 0),
                    "avgDistanceToHigh100": t.get("avgDistanceToHigh100", 0),
                })

            result.append({
                "name": b.get("name", "未知"),
                "change_pct": b.get("latestAverageChange", 0.0),
                "up_ratio": up_ratio,
                "amount": b.get("latestTotalAmount", 0.0),
                "stock_count": b.get("stockCount", 0),
                "high100_rate": b.get("latestHigh100Rate", 0.0),
                "nearHigh100_rate": b.get("latestNearHigh100Rate", 0.0),
                "trend": trend,
            })
        return result
    except Exception as exc:
        print(f"[load_custom_boards] 读取失败: {exc}", file=sys.stderr)
        return []


# ── 5 分钟定时推送循环 ──────────────────────────────────────────────────────────
def is_trading_time(now: Optional[datetime] = None) -> bool:
    """判断是否在 A 股交易时段"""
    now = now or datetime.now()
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return (9 * 60 + 30 <= minutes <= 11 * 60 + 30) or (13 * 60 <= minutes <= 15 * 60 + 5)


def run_5min_loop(webhook_url: str = "", interval: int = 300, force: bool = False) -> None:
    """每 5 分钟推送一次板块雷达（仅在交易时段）"""
    json_path = _ROOT / "web" / "data" / "custom_boards.json"
    notifier = WeComNotifier(webhook_url=webhook_url)

    print(f"[5min-loop] 启动，间隔={interval}s，数据源={json_path}", flush=True)

    while True:
        now = datetime.now()

        if not force and not is_trading_time(now):
            print(f"[{now.strftime('%H:%M')}] 非交易时段，跳过", flush=True)
            time.sleep(60)
            continue

        boards = load_custom_boards(json_path)
        if boards:
            ok1, ok2 = notifier.send_board_radar(boards, top_n=10)
            status = "全部成功" if (ok1 and ok2) else f"盘中雷达{'✓' if ok1 else '✗'}  波段观察{'✓' if ok2 else '✗'}"
            print(
                f"[{now.strftime('%H:%M:%S')}] {status}，板块数={len(boards)}",
                flush=True,
            )
        else:
            print(f"[{now.strftime('%H:%M:%S')}] 未读到板块数据，跳过推送", flush=True)

        time.sleep(interval)


# ── CLI 入口 ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="企业微信板块雷达推送")
    parser.add_argument("--webhook", default="", help="Webhook URL（留空则从 .env / 环境变量读取）")
    parser.add_argument("--interval", type=int, default=300, help="推送间隔秒数，默认 300（5 分钟）")
    parser.add_argument("--force", action="store_true", help="忽略交易时间限制（测试用）")
    parser.add_argument("--once", action="store_true", help="只发送一次就退出")
    parser.add_argument("--test", action="store_true", help="发送一条测试消息")
    args = parser.parse_args()

    notifier = WeComNotifier(webhook_url=args.webhook)

    if args.test:
        print("发送测试消息...")
        ok = notifier.send_markdown(
            "## 企业微信推送测试\n"
            "> 来自题材看板项目\n"
            f"> 时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            "> 状态：<font color=\"green\">连接成功</font>"
        )
        print("发送成功" if ok else "发送失败")
        sys.exit(0 if ok else 1)

    if args.once:
        boards = load_custom_boards(_ROOT / "web" / "data" / "custom_boards.json")
        if boards:
            ok1, ok2 = notifier.send_board_radar(boards, top_n=10)
            print(f"盘中雷达：{'✓' if ok1 else '✗'}  波段观察：{'✓' if ok2 else '✗'}")
        else:
            print("未读到板块数据")
        sys.exit(0)

    run_5min_loop(webhook_url=args.webhook, interval=args.interval, force=args.force)
