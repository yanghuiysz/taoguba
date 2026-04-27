(function installCustomSwingPanel() {
  if (window.__customSwingPanelInstalled) return;
  window.__customSwingPanelInstalled = true;

  const SWING_TAB = 'swing';
  let scheduled = false;
  let enhancing = false;

  function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function scoreRange(value, min, max) {
    const parsed = safeNumber(value);
    if (parsed === null) return 0;
    return clampValue((parsed - min) / (max - min) * 100, 0, 100);
  }

  function fmt(value, digits = 2) {
    if (typeof number === 'function') return number(value, digits);
    const parsed = safeNumber(value);
    return parsed === null ? '暂无' : parsed.toFixed(digits);
  }

  function fmtPercent(value, digits = 2) {
    const parsed = safeNumber(value);
    return parsed === null ? '暂无' : `${fmt(parsed, digits)}%`;
  }

  function fmtDate(date) {
    if (typeof shortDate === 'function') return shortDate(date);
    return date ? String(date).slice(5) : '暂无';
  }

  function changeClass(value) {
    if (typeof signedClass === 'function') return signedClass(value);
    return Number(value) >= 0 ? 'rise' : 'fall';
  }

  function getTrendRows(board) {
    if (typeof trendValues === 'function') return trendValues(board);
    return (board?.trend || []).filter((row) => row?.averageChange !== null && row?.averageChange !== undefined);
  }

  function getSelectedIndex(rows) {
    if (!rows.length) return -1;
    if (state?.sortDate) {
      const index = rows.findIndex((row) => row.date === state.sortDate);
      if (index >= 0) return index;
    }
    return rows.length - 1;
  }

  function rowsToSelected(board, days) {
    const rows = getTrendRows(board);
    const end = getSelectedIndex(rows);
    if (end < 0) return [];
    return rows.slice(Math.max(0, end - days + 1), end + 1);
  }

  function getBoardChange(board, row) {
    if (!row) return null;
    const displayAverage = typeof rowDisplayAverageChange === 'function'
      ? rowDisplayAverageChange(board, row)
      : null;
    const parsedDisplayAverage = safeNumber(displayAverage);
    if (parsedDisplayAverage !== null) return parsedDisplayAverage;
    return safeNumber(row.averageChange);
  }

  function getIndexRow(date) {
    if (typeof marketIndexRowByDate === 'function') return marketIndexRowByDate(date);
    const trend = state?.data?.marketIndex?.trend || [];
    return trend.find((row) => row.date === date) || null;
  }

  function getIndexChange(date) {
    return safeNumber(getIndexRow(date)?.changePercent);
  }

  function getRedRate(row) {
    if (typeof rowRedRate === 'function') return rowRedRate(row);
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) return null;
    return stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
  }

  function getRowTurnover(row) {
    if (typeof rowTotalTurnover === 'function') return rowTotalTurnover(row);
    return safeNumber(row?.totalTurnover ?? row?.totalAmount);
  }

  function compoundReturn(values) {
    const valid = values
      .map((value) => safeNumber(value))
      .filter((value) => value !== null);
    if (!valid.length) return null;
    return (valid.reduce((product, value) => product * (1 + value / 100), 1) - 1) * 100;
  }

  function average(values) {
    const valid = values
      .map((value) => safeNumber(value))
      .filter((value) => value !== null);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function maxDrawdownFromChanges(changes) {
    let value = 1;
    let peak = 1;
    let maxDrawdown = 0;
    for (const change of changes) {
      const parsed = safeNumber(change);
      if (parsed === null) continue;
      value *= 1 + parsed / 100;
      peak = Math.max(peak, value);
      if (peak > 0) {
        maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100);
      }
    }
    return maxDrawdown;
  }

  function boardWindowMetric(board, days) {
    const rows = rowsToSelected(board, days);
    const boardReturns = rows.map((row) => getBoardChange(board, row));
    const indexReturns = rows.map((row) => getIndexChange(row.date));
    return {
      rows,
      boardReturn: compoundReturn(boardReturns),
      indexReturn: compoundReturn(indexReturns),
      redRate: average(rows.map(getRedRate)),
      turnover: rows.length ? getRowTurnover(rows.at(-1)) : null,
      avgTurnover: average(rows.map(getRowTurnover)),
      maxDrawdown: maxDrawdownFromChanges(boardReturns),
      upDays: boardReturns.filter((value) => safeNumber(value) !== null && Number(value) > 0).length,
      validDays: boardReturns.filter((value) => safeNumber(value) !== null).length,
    };
  }

  function boardStatus(metric) {
    const latestChange = metric.latestChange ?? 0;
    const r5 = metric.return5 ?? 0;
    const excess5 = metric.excess5 ?? 0;
    const excess10 = metric.excess10 ?? 0;
    const redRate = metric.redRate5 ?? 0;
    const drawdown10 = metric.drawdown10 ?? 0;

    if (metric.heatScore >= 76 && excess5 >= 1.5 && r5 >= 3 && redRate >= 60) return '主升';
    if (metric.heatScore >= 62 && latestChange < 0 && excess10 > 1 && redRate >= 45 && drawdown10 <= 9) return '良性回踩';
    if (metric.heatScore >= 60 && latestChange > 0 && drawdown10 >= 3 && excess10 > 1) return '二波观察';
    if (metric.heatScore >= 55 && r5 > 0 && excess5 >= 0) return '启动';
    if (metric.heatScore >= 45 && drawdown10 >= 8) return '高位震荡';
    if (metric.heatScore < 35 || (excess5 < -1 && latestChange < 0)) return '热度退潮';
    return '趋势走弱';
  }

  function statusTone(status) {
    return {
      主升: 'strong',
      良性回踩: 'test',
      二波观察: 'turn',
      启动: 'watch',
      高位震荡: 'mixed',
      趋势走弱: 'weak',
      热度退潮: 'divergence',
    }[status] || 'watch';
  }

  function statusConclusion(metric) {
    if (metric.status === '主升') return '板块近 5 日、10 日持续跑赢指数，内部扩散较好，适合作为波段主线继续跟踪。';
    if (metric.status === '良性回踩') return '板块短线有回踩，但中期超额仍在，适合观察板块内抗跌、缩量回踩的韧性个股。';
    if (metric.status === '二波观察') return '板块经历回撤后重新转强，适合观察是否形成第二波上攻。';
    if (metric.status === '启动') return '板块开始走强，但持续性还需要更多交易日验证。';
    if (metric.status === '高位震荡') return '板块热度尚在但波动变大，适合降低追涨欲望，等待更舒服的位置。';
    if (metric.status === '热度退潮') return '板块开始跑输指数或热度明显下降，波段上应谨慎。';
    return '板块趋势偏弱，暂不适合作为波段主线。';
  }

  function swingMetric(board) {
    const rows = getTrendRows(board);
    const selectedIndex = getSelectedIndex(rows);
    const latestRow = selectedIndex >= 0 ? rows[selectedIndex] : null;
    const window3 = boardWindowMetric(board, 3);
    const window5 = boardWindowMetric(board, 5);
    const window10 = boardWindowMetric(board, 10);

    const latestChange = getBoardChange(board, latestRow);
    const return3 = window3.boardReturn;
    const return5 = window5.boardReturn;
    const return10 = window10.boardReturn;
    const index5 = window5.indexReturn;
    const index10 = window10.indexReturn;
    const excess5 = return5 !== null && index5 !== null ? return5 - index5 : null;
    const excess10 = return10 !== null && index10 !== null ? return10 - index10 : null;
    const redRate5 = window5.redRate;
    const turnoverRatio = window5.avgTurnover && window5.turnover
      ? window5.turnover / window5.avgTurnover
      : null;
    const upDayScore = window5.validDays ? window5.upDays / window5.validDays * 100 : 0;

    const heatScore = (
      0.22 * scoreRange(return5, -3, 8)
      + 0.18 * scoreRange(return10, -5, 15)
      + 0.22 * scoreRange(excess10, -4, 10)
      + 0.16 * scoreRange(redRate5, 35, 85)
      + 0.10 * upDayScore
      + 0.07 * scoreRange(turnoverRatio, 0.75, 1.6)
      + 0.05 * (100 - scoreRange(window10.maxDrawdown, 4, 16))
    );

    const metric = {
      board,
      latestRow,
      latestChange,
      return3,
      return5,
      return10,
      index5,
      index10,
      excess5,
      excess10,
      redRate5,
      turnoverRatio,
      drawdown10: window10.maxDrawdown,
      upDays5: window5.upDays,
      validDays5: window5.validDays,
      heatScore: clampValue(heatScore, 0, 100),
    };
    metric.status = boardStatus(metric);
    metric.tone = statusTone(metric.status);
    metric.conclusion = statusConclusion(metric);
    return metric;
  }

  function stockRows(board, stockCode, limitDays = 10) {
    return rowsToSelected(board, limitDays)
      .map((row) => {
        const stock = (row.stocks || []).find((item) => String(item.code || '') === String(stockCode || ''));
        return stock ? { row, stock } : null;
      })
      .filter(Boolean);
  }

  function stockReturn(items, limitDays) {
    const part = items.slice(Math.max(0, items.length - limitDays));
    return compoundReturn(part.map((item) => item.stock.changePercent));
  }

  function boardReturnForItems(board, items, limitDays) {
    const part = items.slice(Math.max(0, items.length - limitDays));
    return compoundReturn(part.map((item) => getBoardChange(board, item.row)));
  }

  function stockDefenseScore(board, items) {
    const downDays = items.filter((item) => {
      const boardChange = getBoardChange(board, item.row);
      return boardChange !== null && boardChange < 0 && safeNumber(item.stock.changePercent) !== null;
    });
    if (!downDays.length) return 60;
    const defense = average(downDays.map((item) => getBoardChange(board, item.row) - Number(item.stock.changePercent)));
    return 100 - scoreRange(defense, -3, 3);
  }

  function stockReboundScore(board, items) {
    const reboundDays = items.filter((item, index) => {
      if (index === 0) return false;
      const prevBoardChange = getBoardChange(board, items[index - 1].row);
      const boardChange = getBoardChange(board, item.row);
      return prevBoardChange !== null && prevBoardChange < 0 && boardChange !== null && boardChange > 0;
    });
    if (!reboundDays.length) return 55;
    const rebound = average(reboundDays.map((item) => {
      const stockChange = safeNumber(item.stock.changePercent);
      const boardChange = getBoardChange(board, item.row);
      return stockChange !== null && boardChange !== null ? stockChange - boardChange : null;
    }));
    return scoreRange(rebound, -2, 5);
  }

  function stockResilienceRows(board) {
    const stockList = board?.stocks || [];
    const boardMetric = swingMetric(board);
    return stockList.map((stock) => {
      const items = stockRows(board, stock.code, 10);
      const ret5 = stockReturn(items, 5);
      const ret10 = stockReturn(items, 10);
      const boardRet5 = boardReturnForItems(board, items, 5);
      const boardRet10 = boardReturnForItems(board, items, 10);
      const rel5 = ret5 !== null && boardRet5 !== null ? ret5 - boardRet5 : null;
      const rel10 = ret10 !== null && boardRet10 !== null ? ret10 - boardRet10 : null;
      const drawdown = maxDrawdownFromChanges(items.map((item) => item.stock.changePercent));
      const defenseScore = stockDefenseScore(board, items);
      const reboundScore = stockReboundScore(board, items);
      const latestChange = items.length ? safeNumber(items.at(-1).stock.changePercent) : null;
      const relScore = scoreRange(average([rel5, rel10]), -5, 10);
      const drawdownScore = 100 - scoreRange(drawdown, 4, 18);
      const trendScore = (
        0.55 * scoreRange(ret5, -3, 8)
        + 0.25 * scoreRange(ret10, -5, 15)
        + 0.20 * scoreRange(latestChange, -3, 5)
      );
      const score = (
        0.38 * relScore
        + 0.24 * drawdownScore
        + 0.18 * defenseScore
        + 0.10 * reboundScore
        + 0.10 * trendScore
      );
      return {
        code: stock.code,
        name: stock.name || stock.code,
        ret5,
        ret10,
        rel5,
        rel10,
        drawdown,
        defenseScore,
        reboundScore,
        latestChange,
        score: clampValue(score, 0, 100),
        status: score >= 78 ? '韧性强' : score >= 65 ? '可观察' : score >= 50 ? '一般' : '偏弱',
        boardStatus: boardMetric.status,
      };
    })
      .filter((item) => safeNumber(item.score) !== null)
      .sort((a, b) => b.score - a.score);
  }

  function renderMetricCards(metric) {
    const cards = [
      ['热度分', fmt(metric.heatScore, 0), metric.status],
      ['5日涨幅', fmtPercent(metric.return5), '板块短期表现'],
      ['10日超额', fmtPercent(metric.excess10), '相对指数强弱'],
      ['5日红盘率', metric.redRate5 === null ? '暂无' : fmtPercent(metric.redRate5, 0), '内部扩散'],
      ['10日回撤', fmtPercent(metric.drawdown10), '波段波动风险'],
      ['量能比', metric.turnoverRatio === null ? '暂无' : fmt(metric.turnoverRatio, 2), '当前/5日均额'],
    ];
    return `
      <div class="swing-metrics">
        ${cards.map(([title, value, sub]) => `
          <div class="setup-metric">
            <span>${title}</span>
            <strong>${value}</strong>
            <small>${sub}</small>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderStockTable(board) {
    const rows = stockResilienceRows(board).slice(0, 12);
    if (!rows.length) return '<div class="empty">暂无韧性股数据</div>';
    return `
      <div class="table-wrap swing-table-wrap">
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>股票</th>
              <th>5日涨幅</th>
              <th>10日涨幅</th>
              <th>5日相对板块</th>
              <th>10日相对板块</th>
              <th>最大回撤</th>
              <th>韧性分</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>
                  <strong>${item.name}</strong>
                  <br><span class="code">${item.code}</span>
                </td>
                <td class="${changeClass(item.ret5)}">${fmtPercent(item.ret5)}</td>
                <td class="${changeClass(item.ret10)}">${fmtPercent(item.ret10)}</td>
                <td class="${changeClass(item.rel5)}">${fmtPercent(item.rel5)}</td>
                <td class="${changeClass(item.rel10)}">${fmtPercent(item.rel10)}</td>
                <td>${fmtPercent(item.drawdown)}</td>
                <td><strong>${fmt(item.score, 0)}</strong></td>
                <td><span class="swing-badge ${item.score >= 78 ? 'strong' : item.score >= 65 ? 'test' : item.score >= 50 ? 'watch' : 'weak'}">${item.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSwingPanel(board) {
    const metric = swingMetric(board);
    return `
      <section class="card section-card swing-panel">
        <div class="section-head">
          <div>
            <h2>${board.name} · 波段观察</h2>
            <p class="muted">
              适配 1-2 周持股：先看板块 5/10 日热度与超额收益，再看板块内个股韧性。
            </p>
          </div>
          <span class="swing-badge ${metric.tone}">${metric.status} · ${fmt(metric.heatScore, 0)}分</span>
        </div>

        ${renderMetricCards(metric)}

        <div class="swing-current-note">
          <strong>波段结论：</strong>${metric.conclusion}
        </div>

        <div class="swing-section-title">
          <strong>板块内韧性股排行</strong>
          <span>看谁相对板块更强、回撤更小、修复更快</span>
        </div>
        ${renderStockTable(board)}
      </section>
    `;
  }

  function allBoardSwingMetrics() {
    return (state?.data?.boards || [])
      .map((board) => swingMetric(board))
      .filter((metric) => metric?.latestRow);
  }

  function renderBoardMiniList(items) {
    if (!items.length) return '<div class="pool-empty">暂无匹配板块</div>';
    return items.map((metric) => `
      <button class="pool-item swing-board-jump" data-code="${metric.board.code}" data-board-code="${metric.board.code}" data-target-tab="swing" type="button">
        <span>
          <strong>${metric.board.name}</strong>
          <small>${metric.status} · 5日 ${fmtPercent(metric.return5)} · 10日超额 ${fmtPercent(metric.excess10)}</small>
        </span>
        <span class="pool-score ${metric.tone}">${fmt(metric.heatScore, 0)}</span>
      </button>
    `).join('');
  }

  function renderOverviewPanel() {
    const metrics = allBoardSwingMetrics();
    const hot = [...metrics]
      .filter((item) => ['主升', '启动', '二波观察'].includes(item.status))
      .sort((a, b) => b.heatScore - a.heatScore);
    const pullback = [...metrics]
      .filter((item) => item.status === '良性回踩')
      .sort((a, b) => b.heatScore - a.heatScore);
    const risk = [...metrics]
      .filter((item) => ['高位震荡', '趋势走弱', '热度退潮'].includes(item.status))
      .sort((a, b) => a.heatScore - b.heatScore);

    return `
      <section class="card section-card swing-overview-panel">
        <div class="section-head">
          <div>
            <h2>热门板块波段观察</h2>
            <p class="muted">按 5/10 日持续性、超额收益、扩散度和回撤识别波段主线。</p>
          </div>
          <span class="count-pill">波段版</span>
        </div>
        <div class="setup-pools swing-pools">
          <div class="pool-card primary">
            <div class="pool-title"><strong>主线/启动</strong><span>${hot.length}</span></div>
            ${renderBoardMiniList(hot)}
          </div>
          <div class="pool-card">
            <div class="pool-title"><strong>良性回踩</strong><span>${pullback.length}</span></div>
            ${renderBoardMiniList(pullback)}
          </div>
          <div class="pool-card risk">
            <div class="pool-title"><strong>风险/退潮</strong><span>${risk.length}</span></div>
            ${renderBoardMiniList(risk)}
          </div>
        </div>
      </section>
    `;
  }

  function ensureTab() {
    const tabs = document.querySelector('.detail-tabs');
    if (!tabs) return;
    let tab = tabs.querySelector(`[data-detail-tab="${SWING_TAB}"]`);
    if (!tab) {
      tab = document.createElement('button');
      tab.className = 'detail-tab-btn';
      tab.dataset.detailTab = SWING_TAB;
      tab.textContent = '波段观察';
      const resonanceTab = tabs.querySelector('[data-detail-tab="resonance"]');
      const trendTab = tabs.querySelector('[data-detail-tab="trend"]');
      if (resonanceTab) {
        resonanceTab.after(tab);
      } else if (trendTab) {
        trendTab.after(tab);
      } else {
        tabs.appendChild(tab);
      }
    }
    tabs.querySelectorAll('.detail-tab-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.detailTab === state?.detailTab);
    });
  }

  function ensurePanel() {
    const pane = document.querySelector('.detail-pane');
    if (!pane) return;

    if (state?.detailTab === 'overview') {
      if (pane.querySelector('.swing-overview-panel')) return;
      pane.querySelectorAll('.swing-panel').forEach((node) => node.remove());
      const anchor = pane.querySelector('.detail-tabs-card');
      const html = renderOverviewPanel();
      if (anchor) {
        anchor.insertAdjacentHTML('afterend', html);
      } else {
        pane.insertAdjacentHTML('afterbegin', html);
      }
      return;
    }

    if (state?.detailTab !== SWING_TAB) {
      pane.querySelectorAll('.swing-panel, .swing-overview-panel').forEach((node) => node.remove());
      return;
    }
    if (pane.querySelector('.swing-panel')) return;
    pane.querySelectorAll('.swing-overview-panel').forEach((node) => node.remove());
    const board = typeof activeBoard === 'function' ? activeBoard() : null;
    if (!board) return;
    pane.insertAdjacentHTML('beforeend', renderSwingPanel(board));
  }

  function enhance() {
    if (enhancing) return;
    if (typeof state === 'undefined') return;
    enhancing = true;
    try {
      ensureTab();
      ensurePanel();
    } finally {
      enhancing = false;
    }
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  function jumpToSwingBoard(jump) {
    if (!jump || typeof state === 'undefined') return;
    state.selectedCode = jump.dataset.boardCode || jump.dataset.code || state.selectedCode;
    state.detailTab = jump.dataset.targetTab || SWING_TAB;
    if (typeof render === 'function') render();
    scheduleEnhance();
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const jump = event.target.closest?.('.swing-board-jump');
    if (!jump) return;
    event.preventDefault();
    jumpToSwingBoard(jump);
  }, true);

  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.(`[data-detail-tab="${SWING_TAB}"]`);
    if (tab && typeof state !== 'undefined') {
      state.detailTab = SWING_TAB;
      if (typeof render === 'function') render();
      scheduleEnhance();
      return;
    }

    const jump = event.target.closest?.('.swing-board-jump');
    if (jump) jumpToSwingBoard(jump);
  }, true);

  const startObserver = () => {
    const root = document.querySelector('#app');
    if (!root) return;
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(root, { childList: true, subtree: true });
    scheduleEnhance();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}());
