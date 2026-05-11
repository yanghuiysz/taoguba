(function initIntradayRadar() {
  const app = document.querySelector("#intraday-app");
  const DATA_URL = "./data/custom_boards.json";
  const POSITIONS_URL = "./data/positions.json";

  const state = {
    data: null,
    positions: [],
    error: "",
    positionError: "",
    opportunitySort: {
      key: "default",
      direction: "desc",
    },
  };

  const safeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const scoreRange = (value, min, max) => {
    const parsed = safeNumber(value);
    if (parsed === null) return 0;
    return clamp((parsed - min) / (max - min) * 100, 0, 100);
  };

  const number = (value, digits = 2) => {
    const parsed = safeNumber(value);
    return parsed === null ? "暂无" : parsed.toFixed(digits);
  };

  const percent = (value, digits = 2) => {
    const parsed = safeNumber(value);
    return parsed === null ? "暂无" : `${number(parsed, digits)}%`;
  };

  const signedClass = (value) => Number(value) >= 0 ? "rise" : "fall";

  const shortDate = (date) => date ? String(date).slice(5) : "暂无";

  const normalizeCode = (code) => String(code || "").replace(/\D/g, "").padStart(6, "0").slice(-6);

  function postResize() {
    window.parent?.postMessage({ type: "dashboard:resize" }, window.location.origin);
  }

  function trendRows(board) {
    return (board?.trend || []).filter((row) => row?.averageChange !== null && row?.averageChange !== undefined);
  }

  function selectedRows(board, days) {
    const rows = trendRows(board);
    return rows.slice(Math.max(0, rows.length - days));
  }

  function selectedRowsUntil(board, days, endIndex) {
    const rows = trendRows(board);
    if (!rows.length || endIndex < 0) return [];
    const safeEnd = Math.min(endIndex, rows.length - 1);
    return rows.slice(Math.max(0, safeEnd - days + 1), safeEnd + 1);
  }

  function boardChange(row) {
    return safeNumber(row?.displayAverageChange ?? row?.averageChange);
  }

  function indexRowByDate(date) {
    return (state.data?.marketIndex?.trend || []).find((row) => row.date === date) || null;
  }

  function compoundReturn(values) {
    const valid = values.map(safeNumber).filter((value) => value !== null);
    if (!valid.length) return null;
    return (valid.reduce((product, value) => product * (1 + value / 100), 1) - 1) * 100;
  }

  function average(values) {
    const valid = values.map(safeNumber).filter((value) => value !== null);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function maxDrawdown(changes) {
    let value = 1;
    let peak = 1;
    let drawdown = 0;
    changes.forEach((change) => {
      const parsed = safeNumber(change);
      if (parsed === null) return;
      value *= 1 + parsed / 100;
      peak = Math.max(peak, value);
      if (peak > 0) drawdown = Math.max(drawdown, (peak - value) / peak * 100);
    });
    return drawdown;
  }

  function redRate(row) {
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) return null;
    return stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
  }

  function rowTurnover(row) {
    return safeNumber(row?.totalTurnover ?? row?.totalAmount);
  }

  function tradingDates() {
    return [...new Set((state.data?.boards || [])
      .flatMap((board) => trendRows(board).map((row) => row.date))
      .filter(Boolean))]
      .sort();
  }

  function tradingDayAge(entryDate, currentDate) {
    if (!entryDate || !currentDate) return null;
    const dates = tradingDates().filter((date) => date >= entryDate && date <= currentDate);
    return dates.length || null;
  }

  function boardWindow(board, days, endIndex = trendRows(board).length - 1) {
    const rows = selectedRowsUntil(board, days, endIndex);
    const boardReturns = rows.map(boardChange);
    const indexReturns = rows.map((row) => safeNumber(indexRowByDate(row.date)?.changePercent));
    return {
      boardReturn: compoundReturn(boardReturns),
      indexReturn: compoundReturn(indexReturns),
      redRate: average(rows.map(redRate)),
      turnover: rows.length ? rowTurnover(rows.at(-1)) : null,
      avgTurnover: average(rows.map(rowTurnover)),
      drawdown: maxDrawdown(boardReturns),
      upDays: boardReturns.filter((value) => safeNumber(value) !== null && Number(value) > 0).length,
      validDays: boardReturns.filter((value) => safeNumber(value) !== null).length,
    };
  }

  function boardStatus(metric) {
    const latestChange = metric.latestChange ?? 0;
    const r5 = metric.return5 ?? 0;
    const excess5 = metric.excess5 ?? 0;
    const excess10 = metric.excess10 ?? 0;
    const redRate5 = metric.redRate5 ?? 0;
    const drawdown10 = metric.drawdown10 ?? 0;
    const turnoverRatio = metric.turnoverRatio ?? 0;
    const badPullback = latestChange < 0
      && metric.heatScore >= 35
      && (excess5 < -1 || redRate5 < 40 || drawdown10 > 9 || turnoverRatio > 1.25);

    if (metric.heatScore < 35 || (excess10 < -2 && excess5 < -1)) return "热度退潮";
    if (metric.heatScore >= 76 && excess5 >= 1.5 && r5 >= 3 && redRate5 >= 60) return "主升";
    if (metric.heatScore >= 55 && latestChange < 0 && excess10 > 1 && redRate5 >= 45 && drawdown10 <= 9) return "良性回踩";
    if (badPullback) return "恶性回踩";
    if (metric.heatScore >= 60 && latestChange > 0 && drawdown10 >= 3 && excess10 > 1) return "二波观察";
    if (metric.heatScore >= 55 && latestChange >= 0 && r5 > 0 && excess5 >= 0) return "启动";
    if (metric.heatScore >= 45 && drawdown10 >= 8) return "高位震荡";
    return "趋势走弱";
  }

  function statusTone(status) {
    return {
      主升: "strong",
      良性回踩: "test",
      恶性回踩: "weak",
      二波观察: "turn",
      启动: "watch",
      高位震荡: "mixed",
      趋势走弱: "weak",
      热度退潮: "divergence",
    }[status] || "watch";
  }

  function stageForStatus(status) {
    if (["主升", "启动", "二波观察"].includes(status)) return "进攻段";
    if (status === "良性回踩") return "良性回踩";
    if (status === "恶性回踩") return "恶性回踩";
    return "退潮段";
  }

  function boardMetric(board, offset = 0) {
    const rows = trendRows(board);
    const endIndex = rows.length ? Math.max(0, Math.min(rows.length - 1 + offset, rows.length - 1)) : -1;
    const latestRow = endIndex >= 0 ? rows[endIndex] : null;
    const window5 = boardWindow(board, 5, endIndex);
    const window10 = boardWindow(board, 10, endIndex);
    const latestChange = boardChange(latestRow);
    const return5 = window5.boardReturn;
    const return10 = window10.boardReturn;
    const index5 = window5.indexReturn;
    const index10 = window10.indexReturn;
    const excess5 = return5 !== null && index5 !== null ? return5 - index5 : null;
    const excess10 = return10 !== null && index10 !== null ? return10 - index10 : null;
    const turnoverRatio = window5.avgTurnover && window5.turnover ? window5.turnover / window5.avgTurnover : null;
    const upDayScore = window5.validDays ? window5.upDays / window5.validDays * 100 : 0;
    const heatScore = (
      0.22 * scoreRange(return5, -3, 8)
      + 0.18 * scoreRange(return10, -5, 15)
      + 0.22 * scoreRange(excess10, -4, 10)
      + 0.16 * scoreRange(window5.redRate, 35, 85)
      + 0.10 * upDayScore
      + 0.07 * scoreRange(turnoverRatio, 0.75, 1.6)
      + 0.05 * (100 - scoreRange(window10.drawdown, 4, 16))
    );
    const metric = {
      board,
      date: latestRow?.date || "",
      latestRow,
      latestChange,
      return5,
      return10,
      excess5,
      excess10,
      redRate5: window5.redRate,
      turnoverRatio,
      drawdown10: window10.drawdown,
      heatScore: clamp(heatScore, 0, 100),
    };
    metric.status = boardStatus(metric);
    metric.tone = statusTone(metric.status);
    metric.stage = stageForStatus(metric.status);
    return metric;
  }

  function stockRows(board, stockCode, days = 10) {
    return selectedRows(board, days)
      .map((row) => {
        const stock = (row.stocks || []).find((item) => String(item.code || "") === String(stockCode || ""));
        return stock ? { row, stock } : null;
      })
      .filter(Boolean);
  }

  function stockReturn(items, days) {
    return compoundReturn(items.slice(Math.max(0, items.length - days)).map((item) => item.stock.changePercent));
  }

  function boardReturnForItems(items, days) {
    return compoundReturn(items.slice(Math.max(0, items.length - days)).map((item) => boardChange(item.row)));
  }

  function stockDefenseScore(items) {
    const downDays = items.filter((item) => {
      const boardPct = boardChange(item.row);
      return boardPct !== null && boardPct < 0 && safeNumber(item.stock.changePercent) !== null;
    });
    if (!downDays.length) return 60;
    const defense = average(downDays.map((item) => boardChange(item.row) - Number(item.stock.changePercent)));
    return 100 - scoreRange(defense, -3, 3);
  }

  function stockReboundScore(items) {
    const reboundDays = items.filter((item, index) => {
      if (index === 0) return false;
      const prevBoard = boardChange(items[index - 1].row);
      const currentBoard = boardChange(item.row);
      return prevBoard !== null && prevBoard < 0 && currentBoard !== null && currentBoard > 0;
    });
    if (!reboundDays.length) return 55;
    return scoreRange(average(reboundDays.map((item) => {
      const stockPct = safeNumber(item.stock.changePercent);
      const boardPct = boardChange(item.row);
      return stockPct !== null && boardPct !== null ? stockPct - boardPct : null;
    })), -2, 5);
  }

  function macdTone(label, score) {
    const text = String(label || "");
    if (text.includes("死叉") || text.includes("绿柱扩张") || score <= 35) return "weak";
    if (text.includes("金叉") || text.includes("红柱扩张") || text.includes("零轴上") || score >= 75) return "strong";
    if (text.includes("收敛") || score >= 55) return "test";
    return "watch";
  }

  function stockResilienceRows(board) {
    return (board?.stocks || []).map((stock) => {
      const items = stockRows(board, stock.code, 10);
      const ret5 = stockReturn(items, 5);
      const ret10 = stockReturn(items, 10);
      const boardRet5 = boardReturnForItems(items, 5);
      const boardRet10 = boardReturnForItems(items, 10);
      const rel5 = ret5 !== null && boardRet5 !== null ? ret5 - boardRet5 : null;
      const rel10 = ret10 !== null && boardRet10 !== null ? ret10 - boardRet10 : null;
      const latest = items.at(-1)?.stock || null;
      const latestChange = items.length ? safeNumber(latest?.changePercent) : null;
      const macdScore = safeNumber(latest?.macdScore) ?? 50;
      const relScore = scoreRange(average([rel5, rel10]), -5, 10);
      const drawdownScore = 100 - scoreRange(maxDrawdown(items.map((item) => item.stock.changePercent)), 4, 18);
      const trendScore = (
        0.55 * scoreRange(ret5, -3, 8)
        + 0.25 * scoreRange(ret10, -5, 15)
        + 0.20 * scoreRange(latestChange, -3, 5)
      );
      const score = (
        0.34 * relScore
        + 0.22 * drawdownScore
        + 0.16 * stockDefenseScore(items)
        + 0.09 * stockReboundScore(items)
        + 0.09 * trendScore
        + 0.10 * macdScore
      );
      return {
        code: stock.code,
        name: stock.name || stock.code,
        latest,
        ret5,
        ret10,
        rel5,
        rel10,
        latestChange,
        macdLabel: latest?.macdLabel || "MACD暂无",
        macdScore,
        highStatus: latest?.highStatus || stock.latestHighStatus || "",
        score: clamp(score, 0, 100),
      };
    }).sort((a, b) => b.score - a.score);
  }

  function signalTone(signal) {
    if (signal === "良性低吸") return "test";
    if (signal === "转强加仓" || signal === "进攻前排") return "strong";
    if (signal === "恶化否决") return "weak";
    return "watch";
  }

  function intradayState(metric) {
    const latestChange = metric.latestChange ?? 0;
    const excess5 = metric.excess5 ?? 0;
    const redRate5 = metric.redRate5 ?? 0;
    const drawdown10 = metric.drawdown10 ?? 0;
    const turnoverRatio = metric.turnoverRatio ?? 0;
    const badPullback = latestChange < 0
      && (excess5 < -1 || redRate5 < 40 || drawdown10 > 9 || turnoverRatio > 1.25 || metric.status === "恶性回踩");

    if (badPullback) return { label: "恶性回踩", tone: "weak" };
    if (latestChange < 0 && metric.stage !== "退潮段") return { label: "良性回踩", tone: "test" };
    if (latestChange >= 0 && metric.stage === "进攻段") return { label: "盘中转强", tone: "strong" };
    if (metric.stage === "退潮段") return { label: "退潮走弱", tone: "divergence" };
    return { label: "观察", tone: "watch" };
  }

  function buildTradeSignal(backgroundMetric, currentMetric, currentState, stock) {
    const stockScore = safeNumber(stock.score) ?? 0;
    const rel5 = safeNumber(stock.rel5) ?? 0;
    const latestChange = safeNumber(stock.latestChange) ?? 0;
    const qualifiedBackground = backgroundMetric.stage === "进攻段" || backgroundMetric.stage === "良性回踩";
    const todayGoodPullback = currentState.label === "良性回踩";
    const todayAttack = currentState.label === "盘中转强";
    const todayBad = currentState.label === "恶性回踩" || currentState.label === "退潮走弱";
    const stockResilient = stockScore >= 65 || rel5 >= 0 || latestChange >= 0;
    const stockTurnStrong = latestChange >= 1 && rel5 >= 0;

    if (!qualifiedBackground) {
      return { signal: "背景不足", priority: 0 };
    }
    if (todayBad) {
      return { signal: "恶化否决", priority: 1 };
    }
    if (todayGoodPullback && stockTurnStrong) {
      return { signal: "转强加仓", priority: 4 };
    }
    if (todayGoodPullback && stockResilient) {
      return { signal: "良性低吸", priority: 5 };
    }
    if (todayAttack && stockTurnStrong) {
      return { signal: "进攻前排", priority: 3 };
    }
    if (stockScore >= 78 && rel5 >= 0) {
      return { signal: "韧性观察", priority: 2 };
    }
    return { signal: "观察", priority: 0 };
  }

  function opportunityRows() {
    const rows = (state.data?.boards || [])
      .map((board) => ({
        board,
        backgroundMetric: boardMetric(board, -1),
        currentMetric: boardMetric(board),
      }))
      .flatMap(({ board, backgroundMetric, currentMetric }) => stockResilienceRows(board).slice(0, 8).map((stock) => {
        const latestChange = safeNumber(stock.latestChange) ?? 0;
        const rel5 = safeNumber(stock.rel5) ?? 0;
        const rel10 = safeNumber(stock.rel10) ?? 0;
        const currentState = intradayState(currentMetric);
        const tradeSignal = buildTradeSignal(backgroundMetric, currentMetric, currentState, stock);
        const opportunityScore = clamp(
          0.38 * (safeNumber(stock.score) ?? 0)
          + 0.20 * scoreRange(rel5, -2, 6)
          + 0.14 * scoreRange(rel10, -4, 10)
          + 0.12 * scoreRange(latestChange, -2, 6)
          + 0.10 * (safeNumber(stock.macdScore) ?? 50)
          + 0.06 * backgroundMetric.heatScore,
          0,
          100,
        );
        return {
          board,
          backgroundMetric,
          currentMetric,
          currentState,
          stock,
          signal: tradeSignal.signal,
          signalPriority: tradeSignal.priority,
          opportunityScore,
        };
      }))
      .filter((item) =>
        item.signalPriority >= 2
        && item.opportunityScore >= 58
        && (item.stock.score >= 65 || item.stock.latestChange >= 1 || item.stock.rel5 >= 0)
        && !String(item.stock.macdLabel || "").includes("死叉"))
      .slice(0, 80);
    return sortOpportunityRows(rows);
  }

  function sortOpportunityRows(rows) {
    const sorted = [...rows];
    if (state.opportunitySort.key === "board") {
      const direction = state.opportunitySort.direction === "asc" ? 1 : -1;
      return sorted.sort((a, b) => {
        const nameDiff = String(a.board.name || "").localeCompare(String(b.board.name || ""), "zh-Hans-CN");
        if (nameDiff !== 0) return direction * nameDiff;
        return b.signalPriority - a.signalPriority || b.opportunityScore - a.opportunityScore;
      });
    }
    return sorted.sort((a, b) => b.signalPriority - a.signalPriority || b.opportunityScore - a.opportunityScore);
  }

  function sortLabel(key) {
    if (state.opportunitySort.key !== key) return "";
    return state.opportunitySort.direction === "asc" ? " ↑" : " ↓";
  }

  function stockLookup(stockCode) {
    const code = normalizeCode(stockCode);
    const matches = [];
    (state.data?.boards || []).forEach((board) => {
      const rows = trendRows(board);
      const currentRow = rows.at(-1) || null;
      const currentStock = (currentRow?.stocks || []).find((stock) => normalizeCode(stock.code) === code) || null;
      if (!currentStock) return;
      const backgroundMetric = boardMetric(board, -1);
      const currentMetric = boardMetric(board);
      matches.push({
        board,
        stock: currentStock,
        backgroundMetric,
        currentMetric,
        currentState: intradayState(currentMetric),
      });
    });
    return matches.sort((a, b) =>
      b.backgroundMetric.heatScore - a.backgroundMetric.heatScore
      || Math.abs(safeNumber(b.stock.changePercent) ?? 0) - Math.abs(safeNumber(a.stock.changePercent) ?? 0))[0] || null;
  }

  function positionAction(position, context) {
    if (!context) {
      return {
        action: "暂无行情",
        tone: "watch",
        reason: "未在自定义板块数据里匹配到该持仓",
      };
    }
    const cost = safeNumber(position.cost);
    const firstBuyLow = safeNumber(position.firstBuyLow ?? position.divergenceLow);
    const pressure = safeNumber(position.pressure);
    const currentPrice = safeNumber(context.stock.close);
    const profitPct = cost && currentPrice ? (currentPrice / cost - 1) * 100 : null;
    const currentDate = latestDataDate();
    const holdDays = tradingDayAge(position.entryDate, currentDate);
    const weakStock = (safeNumber(context.stock.changePercent) ?? 0) < 0 || (safeNumber(context.stock.macdScore) ?? 50) <= 35;

    if (firstBuyLow !== null && currentPrice !== null && currentPrice < firstBuyLow) {
      return {
        action: "硬止损",
        tone: "weak",
        reason: `跌破第一笔低吸日低点 ${number(firstBuyLow)}`,
        profitPct,
        holdDays,
      };
    }
    if (holdDays !== null && holdDays >= 3 && (profitPct ?? 0) < 3 && context.currentState.label !== "盘中转强") {
      return {
        action: "时间止损",
        tone: "weak",
        reason: `持仓 ${holdDays} 个交易日，修复未达预期`,
        profitPct,
        holdDays,
      };
    }
    if (context.currentState.label === "恶性回踩" || context.currentState.label === "退潮走弱") {
      return {
        action: weakStock ? "减仓/止损观察" : "持有观察",
        tone: weakStock ? "weak" : "watch",
        reason: `${context.currentState.label}，不加仓`,
        profitPct,
        holdDays,
      };
    }
    if (!position.hasTakenHalfProfit && ((profitPct ?? 0) >= 5 || (pressure !== null && currentPrice !== null && currentPrice >= pressure))) {
      return {
        action: "减仓 1/2",
        tone: "strong",
        reason: pressure !== null && currentPrice !== null && currentPrice >= pressure ? `触及压力位 ${number(pressure)}` : `浮盈 ${number(profitPct)}%`,
        profitPct,
        holdDays,
      };
    }
    if (!position.breakevenArmed && (profitPct ?? 0) >= 3) {
      return {
        action: "上移止损",
        tone: "test",
        reason: `浮盈 ${number(profitPct)}%，止损上移至成本 +0.5%`,
        profitPct,
        holdDays,
      };
    }
    if (context.currentState.label === "盘中转强") {
      return {
        action: "持有/加仓观察",
        tone: "strong",
        reason: "盘中转强，观察第二笔条件",
        profitPct,
        holdDays,
      };
    }
    if (context.currentState.label === "良性回踩") {
      return {
        action: "持有观察",
        tone: "test",
        reason: "板块仍是良性回踩，观察承接",
        profitPct,
        holdDays,
      };
    }
    return {
      action: "持有观察",
      tone: "watch",
      reason: "未触发卖出或加仓规则",
      profitPct,
      holdDays,
    };
  }

  function positionRows() {
    return (state.positions || []).map((position) => {
      const context = stockLookup(position.code);
      return {
        position,
        context,
        decision: positionAction(position, context),
      };
    });
  }

  function renderPositionsPanel() {
    if (state.positionError) {
      return `<section class="card section-card positions-card"><div class="empty">持仓读取失败：${state.positionError}</div></section>`;
    }
    const rows = positionRows();
    return `
      <section class="card section-card positions-card">
        <div class="section-head">
          <div>
            <h2>我的持仓操作提醒</h2>
            <p class="muted">按成本保护、动能兑现、逻辑证伪和时间截断给出盘中动作建议。</p>
          </div>
          <span class="count-pill">${rows.length} 只持仓</span>
        </div>
        ${rows.length ? `
          <div class="table-wrap positions-table">
            <table>
              <thead>
                <tr>
                  <th>持仓</th>
                  <th>所属板块</th>
                  <th>今日状态</th>
                  <th>现价/浮盈</th>
                  <th>持仓天数</th>
                  <th>动作建议</th>
                  <th>触发原因</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(({ position, context, decision }) => `
                  <tr>
                    <td><strong>${position.name || context?.stock?.name || normalizeCode(position.code)}</strong><span class="code">${normalizeCode(position.code)}</span></td>
                    <td>${context ? `<strong>${context.board.name}</strong><br><small>${context.backgroundMetric.stage} · ${context.backgroundMetric.status}</small>` : "暂无"}</td>
                    <td>${context ? `<span class="swing-badge ${context.currentState.tone}">${context.currentState.label}</span><br><small>${context.currentMetric.status}</small>` : "暂无"}</td>
                    <td><strong>${context?.stock?.close === undefined ? "暂无" : number(context.stock.close)}</strong><br><small class="${signedClass(decision.profitPct)}">${decision.profitPct === null || decision.profitPct === undefined ? "浮盈暂无" : `浮盈 ${number(decision.profitPct)}%`}</small></td>
                    <td>${decision.holdDays || "暂无"}</td>
                    <td><span class="swing-badge ${decision.tone}">${decision.action}</span></td>
                    <td>${decision.reason}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : '<div class="pool-empty">暂无持仓配置。可在 web/data/positions.json 添加持仓。</div>'}
      </section>
    `;
  }

  function latestDataDate() {
    const explicit = state.data?.date;
    if (explicit) return explicit;
    return (state.data?.boards || [])
      .flatMap((board) => trendRows(board).slice(-1).map((row) => row.date))
      .filter(Boolean)
      .sort()
      .at(-1);
  }

  function render() {
    if (!state.data && !state.error) {
      app.innerHTML = '<section class="card section-card"><div class="empty">正在加载盘中雷达...</div></section>';
      postResize();
      return;
    }
    if (state.error) {
      app.innerHTML = `<section class="card section-card"><div class="empty">加载失败：${state.error}</div></section>`;
      postResize();
      return;
    }

    const rows = opportunityRows();
    const firstBuyCount = rows.filter((item) => item.signal === "良性低吸").length;
    const addBuyCount = rows.filter((item) => item.signal === "转强加仓").length;
    const attackCount = rows.filter((item) => item.signal === "进攻前排").length;
    const latestDate = latestDataDate();
    const backgroundDate = rows[0]?.backgroundMetric?.date || "";
    const updatedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });

    app.innerHTML = `
      ${renderPositionsPanel()}
      <section class="card section-card swing-overview-panel">
        <div class="section-head">
          <div>
            <h2>盘中机会雷达</h2>
            <p class="muted">昨日背景决定候选资格，今日盘中只保留良性低吸、转强加仓和辅助观察，排除恶性回踩与退潮走弱。</p>
          </div>
          <span class="count-pill">背景 ${shortDate(backgroundDate)} / 盘中 ${shortDate(latestDate)}</span>
        </div>

        <div class="intraday-summary">
          <div class="setup-metric"><span>机会数</span><strong>${rows.length}</strong><small>当前入选</small></div>
          <div class="setup-metric"><span>良性低吸</span><strong>${firstBuyCount}</strong><small>第一笔候选</small></div>
          <div class="setup-metric"><span>转强加仓</span><strong>${addBuyCount}</strong><small>第二笔候选</small></div>
          <div class="setup-metric"><span>进攻前排</span><strong>${attackCount}</strong><small>辅助观察</small></div>
          <div class="setup-metric"><span>数据时间</span><strong>${shortDate(latestDate)}</strong><small>${updatedAt} 刷新页面</small></div>
        </div>

        <div class="intraday-toolbar">
          <p class="muted">顶部定时刷新只会重载本页，避免盘中反复刷新其他看板。</p>
          <span class="intraday-time">自动刷新：交易时段每 30 分钟</span>
        </div>

        ${rows.length ? `
          <div class="table-wrap swing-intraday-table intraday-table">
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th><button class="table-sort-btn" type="button" data-sort-key="board">板块${sortLabel("board")}</button></th>
                  <th>昨日背景</th>
                  <th>今日状态</th>
                  <th>个股</th>
                  <th>当前涨幅</th>
                  <th>5日相对</th>
                  <th>10日相对</th>
                  <th>MACD</th>
                  <th>高位</th>
                  <th>信号</th>
                  <th>机会分</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((item, index) => `
                  <tr>
                    <td><strong>${index + 1}</strong></td>
                    <td class="intraday-board-cell"><strong>${item.board.name}</strong><span class="code">${item.board.code}</span></td>
                    <td><span class="swing-badge ${item.backgroundMetric.tone}">${item.backgroundMetric.stage}</span><br><small>${item.backgroundMetric.status}</small></td>
                    <td><span class="swing-badge ${item.currentState.tone}">${item.currentState.label}</span><br><small>${item.currentMetric.status}</small></td>
                    <td class="intraday-stock-cell"><strong>${item.stock.name}</strong><span class="code">${item.stock.code}</span></td>
                    <td class="${signedClass(item.stock.latestChange)}">${percent(item.stock.latestChange)}</td>
                    <td class="${signedClass(item.stock.rel5)}">${percent(item.stock.rel5)}</td>
                    <td class="${signedClass(item.stock.rel10)}">${percent(item.stock.rel10)}</td>
                    <td><span class="swing-badge ${macdTone(item.stock.macdLabel, item.stock.macdScore)}">${item.stock.macdLabel}</span></td>
                    <td>${item.stock.highStatus || "暂无"}</td>
                    <td><span class="swing-badge intraday-signal ${signalTone(item.signal)}">${item.signal}</span></td>
                    <td><strong>${number(item.opportunityScore, 0)}</strong></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : '<div class="pool-empty">暂无盘中机会信号</div>'}
      </section>
    `;
    postResize();
  }

  async function load() {
    render();
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      state.error = "";
    } catch (error) {
      state.error = error.message || String(error);
    }
    try {
      const positionResponse = await fetch(`${POSITIONS_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (positionResponse.ok) {
        const payload = await positionResponse.json();
        state.positions = Array.isArray(payload) ? payload : [];
        state.positionError = "";
      } else if (positionResponse.status === 404) {
        state.positions = [];
        state.positionError = "";
      } else {
        throw new Error(`HTTP ${positionResponse.status}`);
      }
    } catch (error) {
      state.positions = [];
      state.positionError = error.message || String(error);
    }
    render();
  }

  app.addEventListener("click", (event) => {
    const sortButton = event.target.closest?.("[data-sort-key]");
    if (!sortButton) return;
    const key = sortButton.dataset.sortKey;
    if (state.opportunitySort.key === key) {
      state.opportunitySort.direction = state.opportunitySort.direction === "asc" ? "desc" : "asc";
    } else {
      state.opportunitySort = { key, direction: "asc" };
    }
    render();
  });

  load();
}());
