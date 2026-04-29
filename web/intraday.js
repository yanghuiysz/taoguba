(function initIntradayRadar() {
  const app = document.querySelector("#intraday-app");
  const DATA_URL = "./data/custom_boards.json";

  const state = {
    data: null,
    error: "",
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

  function boardWindow(board, days) {
    const rows = selectedRows(board, days);
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

    if (metric.heatScore >= 76 && excess5 >= 1.5 && r5 >= 3 && redRate5 >= 60) return "主升";
    if (metric.heatScore >= 55 && latestChange < 0 && excess10 > 1 && redRate5 >= 45 && drawdown10 <= 9) return "良性回踩";
    if (metric.heatScore >= 60 && latestChange > 0 && drawdown10 >= 3 && excess10 > 1) return "二波观察";
    if (metric.heatScore >= 55 && latestChange >= 0 && r5 > 0 && excess5 >= 0) return "启动";
    if (metric.heatScore >= 45 && drawdown10 >= 8) return "高位震荡";
    if (metric.heatScore < 35 || (excess5 < -1 && latestChange < 0)) return "热度退潮";
    return "趋势走弱";
  }

  function statusTone(status) {
    return {
      主升: "strong",
      良性回踩: "test",
      二波观察: "turn",
      启动: "watch",
      高位震荡: "mixed",
      趋势走弱: "weak",
      热度退潮: "divergence",
    }[status] || "watch";
  }

  function boardMetric(board) {
    const rows = trendRows(board);
    const latestRow = rows.at(-1) || null;
    const window5 = boardWindow(board, 5);
    const window10 = boardWindow(board, 10);
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

  function opportunityRows() {
    const candidateStatuses = new Set(["启动", "良性回踩"]);
    return (state.data?.boards || [])
      .map(boardMetric)
      .filter((metric) => candidateStatuses.has(metric.status))
      .flatMap((metric) => stockResilienceRows(metric.board).slice(0, 8).map((stock) => {
        const latestChange = safeNumber(stock.latestChange) ?? 0;
        const rel5 = safeNumber(stock.rel5) ?? 0;
        const rel10 = safeNumber(stock.rel10) ?? 0;
        const boardPullback = metric.status === "良性回踩";
        const reboundInPullback = boardPullback && latestChange >= 0 && rel5 >= 0;
        const strongInStart = metric.status === "启动" && latestChange >= 1 && rel5 >= 0;
        const opportunityScore = clamp(
          0.38 * (safeNumber(stock.score) ?? 0)
          + 0.20 * scoreRange(rel5, -2, 6)
          + 0.14 * scoreRange(rel10, -4, 10)
          + 0.12 * scoreRange(latestChange, -2, 6)
          + 0.10 * (safeNumber(stock.macdScore) ?? 50)
          + 0.06 * metric.heatScore,
          0,
          100,
        );
        let signal = "观察";
        if (reboundInPullback) signal = "回踩承接";
        else if (strongInStart) signal = "启动前排";
        else if (stock.score >= 78 && rel5 >= 0) signal = "韧性前排";
        return { board: metric.board, boardMetric: metric, stock, signal, opportunityScore };
      }))
      .filter((item) =>
        item.opportunityScore >= 62
        && (item.stock.score >= 65 || item.stock.latestChange >= 1 || item.stock.rel5 >= 1)
        && !String(item.stock.macdLabel || "").includes("死叉"))
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 80);
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
    const startupCount = rows.filter((item) => item.boardMetric.status === "启动").length;
    const pullbackCount = rows.filter((item) => item.boardMetric.status === "良性回踩").length;
    const latestDate = latestDataDate();
    const updatedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });

    app.innerHTML = `
      <section class="card section-card swing-overview-panel">
        <div class="section-head">
          <div>
            <h2>盘中机会雷达</h2>
            <p class="muted">聚焦启动和良性回踩板块里相对更强、承接更好的个股。</p>
          </div>
          <span class="count-pill">交易日 ${shortDate(latestDate)}</span>
        </div>

        <div class="intraday-summary">
          <div class="setup-metric"><span>机会数</span><strong>${rows.length}</strong><small>当前入选</small></div>
          <div class="setup-metric"><span>启动前排</span><strong>${startupCount}</strong><small>板块启动信号</small></div>
          <div class="setup-metric"><span>回踩承接</span><strong>${pullbackCount}</strong><small>良性回踩信号</small></div>
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
                  <th>板块</th>
                  <th>状态</th>
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
                    <td><span class="swing-badge ${item.boardMetric.tone}">${item.boardMetric.status}</span></td>
                    <td class="intraday-stock-cell"><strong>${item.stock.name}</strong><span class="code">${item.stock.code}</span></td>
                    <td class="${signedClass(item.stock.latestChange)}">${percent(item.stock.latestChange)}</td>
                    <td class="${signedClass(item.stock.rel5)}">${percent(item.stock.rel5)}</td>
                    <td class="${signedClass(item.stock.rel10)}">${percent(item.stock.rel10)}</td>
                    <td><span class="swing-badge ${macdTone(item.stock.macdLabel, item.stock.macdScore)}">${item.stock.macdLabel}</span></td>
                    <td>${item.stock.highStatus || "暂无"}</td>
                    <td><span class="swing-badge intraday-signal ${item.signal === "回踩承接" ? "test" : item.signal === "启动前排" ? "strong" : "watch"}">${item.signal}</span></td>
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
    render();
  }

  load();
}());
