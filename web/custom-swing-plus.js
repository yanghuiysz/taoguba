(function installCustomSwingPlusPanel() {
  if (window.__customSwingPlusPanelInstalled) return;
  window.__customSwingPlusPanelInstalled = true;

  let scheduled = false;
  let enhancing = false;

  function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function average(values) {
    const valid = values.map(safeNumber).filter((value) => value !== null);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
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

  function rowsToSelected(board, days = 20) {
    const rows = getTrendRows(board);
    const end = getSelectedIndex(rows);
    if (end < 0) return [];
    return rows.slice(Math.max(0, end - days + 1), end + 1);
  }

  function rowTurnover(row) {
    if (typeof rowTotalTurnover === 'function') return rowTotalTurnover(row);
    return safeNumber(row?.totalTurnover ?? row?.totalAmount);
  }

  function stockTurnoverValue(stock) {
    if (typeof stockTurnover === 'function') return stockTurnover(stock);
    return safeNumber(stock?.turnover ?? stock?.amount);
  }

  function boardChange(board, row) {
    if (!row) return null;
    const displayAverage = typeof rowDisplayAverageChange === 'function'
      ? rowDisplayAverageChange(board, row)
      : null;
    const parsedDisplayAverage = safeNumber(displayAverage);
    if (parsedDisplayAverage !== null) return parsedDisplayAverage;
    return safeNumber(row.averageChange);
  }

  function trendStrengthFromChanges(changes) {
    const ma5 = average(changes.slice(-5));
    const ma10 = average(changes.slice(-10));
    const ma20 = changes.length >= 20 ? average(changes.slice(-20)) : null;
    const latest = safeNumber(changes.at(-1));
    let score = 0;
    if (latest !== null && ma5 !== null && latest >= ma5) score += 30;
    if (ma5 !== null && ma10 !== null && ma5 >= ma10) score += 35;
    if (ma10 !== null && ma20 !== null && ma10 >= ma20) score += 25;
    if (latest !== null && latest > 0) score += 10;
    let label = '趋势不足';
    if (score >= 85) label = '均线多头';
    else if (score >= 60) label = '趋势保持';
    else if (score >= 40) label = '震荡修复';
    else if (score > 0) label = '趋势偏弱';
    return { latest, ma5, ma10, ma20, score, label };
  }

  function boardPullbackMetric(board) {
    const rows = rowsToSelected(board, 10);
    if (!rows.length) return { label: '暂无', score: 0, ratio: null, change: null };
    const latest = rows.at(-1);
    const latestChange = boardChange(board, latest);
    const latestTurnover = rowTurnover(latest);
    const previousTurnovers = rows.slice(0, -1).map(rowTurnover);
    const avgPrevTurnover = average(previousTurnovers);
    const ratio = latestTurnover !== null && avgPrevTurnover ? latestTurnover / avgPrevTurnover : null;

    if (latestChange !== null && latestChange < 0 && ratio !== null && ratio <= 0.85) {
      return { label: '缩量回踩', score: 90, ratio, change: latestChange };
    }
    if (latestChange !== null && latestChange < 0 && ratio !== null && ratio <= 1.05) {
      return { label: '正常回踩', score: 65, ratio, change: latestChange };
    }
    if (latestChange !== null && latestChange < 0 && ratio !== null && ratio > 1.25) {
      return { label: '放量下跌', score: 20, ratio, change: latestChange };
    }
    if (latestChange !== null && latestChange >= 0 && ratio !== null && ratio >= 1.05) {
      return { label: '放量修复', score: 75, ratio, change: latestChange };
    }
    return { label: '无明显回踩', score: 50, ratio, change: latestChange };
  }

  function boardPlusMetric(board) {
    const rows = rowsToSelected(board, 20);
    const changes = rows.map((row) => boardChange(board, row)).filter((value) => value !== null);
    const trend = trendStrengthFromChanges(changes);
    const pullback = boardPullbackMetric(board);
    return {
      trend,
      pullback,
      score: Math.round(0.65 * trend.score + 0.35 * pullback.score),
    };
  }

  function stockRows(board, stockCode, limitDays = 20) {
    return rowsToSelected(board, limitDays)
      .map((row) => {
        const stock = (row.stocks || []).find((item) => String(item.code || '') === String(stockCode || ''));
        return stock ? { row, stock } : null;
      })
      .filter(Boolean);
  }

  function stockTrendMetric(items) {
    const closes = items.map((item) => safeNumber(item.stock.close)).filter((value) => value !== null);
    const changes = items.map((item) => safeNumber(item.stock.changePercent)).filter((value) => value !== null);
    const latestClose = closes.at(-1) ?? null;
    const ma5 = closes.length >= 5 ? average(closes.slice(-5)) : null;
    const ma10 = closes.length >= 10 ? average(closes.slice(-10)) : null;
    const ma20 = closes.length >= 20 ? average(closes.slice(-20)) : null;
    const latestChange = changes.at(-1) ?? null;

    let score = 0;
    if (latestClose !== null && ma5 !== null && latestClose >= ma5) score += 30;
    if (ma5 !== null && ma10 !== null && ma5 >= ma10) score += 35;
    if (ma10 !== null && ma20 !== null && ma10 >= ma20) score += 25;
    if (latestChange !== null && latestChange > 0) score += 10;

    let label = '数据不足';
    if (score >= 85) label = '均线多头';
    else if (score >= 60) label = '趋势保持';
    else if (score >= 40) label = '震荡修复';
    else if (score > 0) label = '趋势偏弱';

    return { latestClose, ma5, ma10, ma20, latestChange, score, label };
  }

  function stockPullbackMetric(items) {
    if (!items.length) return { label: '暂无', score: 0, ratio: null, change: null };
    const latest = items.at(-1);
    const latestChange = safeNumber(latest.stock.changePercent);
    const latestTurnover = stockTurnoverValue(latest.stock);
    const prevTurnovers = items.slice(Math.max(0, items.length - 6), -1).map((item) => stockTurnoverValue(item.stock));
    const avgPrevTurnover = average(prevTurnovers);
    const ratio = latestTurnover !== null && avgPrevTurnover ? latestTurnover / avgPrevTurnover : null;

    if (latestChange !== null && latestChange < 0 && ratio !== null && ratio <= 0.85) {
      return { label: '缩量回踩', score: 92, ratio, change: latestChange };
    }
    if (latestChange !== null && latestChange < 0 && ratio !== null && ratio <= 1.05) {
      return { label: '正常回踩', score: 68, ratio, change: latestChange };
    }
    if (latestChange !== null && latestChange < 0 && ratio !== null && ratio > 1.25) {
      return { label: '放量下跌', score: 18, ratio, change: latestChange };
    }
    if (latestChange !== null && latestChange >= 0 && ratio !== null && ratio >= 1.05) {
      return { label: '放量修复', score: 78, ratio, change: latestChange };
    }
    return { label: '无明显回踩', score: 52, ratio, change: latestChange };
  }

  function tone(score, label = '') {
    if (label.includes('放量下跌')) return 'divergence';
    if (score >= 80) return 'strong';
    if (score >= 65) return 'test';
    if (score >= 50) return 'watch';
    return 'weak';
  }

  function stockPlusRows(board) {
    return (board?.stocks || []).map((stock) => {
      const items = stockRows(board, stock.code, 20);
      const trend = stockTrendMetric(items);
      const pullback = stockPullbackMetric(items);
      const plusScore = Math.round(0.62 * trend.score + 0.38 * pullback.score);
      return {
        code: stock.code,
        name: stock.name || stock.code,
        trend,
        pullback,
        plusScore,
      };
    }).sort((a, b) => b.plusScore - a.plusScore);
  }

  function renderBoardPlus(board) {
    const metric = boardPlusMetric(board);
    const trendTone = tone(metric.trend.score, metric.trend.label);
    const pullbackTone = tone(metric.pullback.score, metric.pullback.label);
    return `
      <div class="swing-plus-grid">
        <div class="setup-metric">
          <span>板块趋势确认</span>
          <strong>${metric.trend.label}</strong>
          <small>趋势分 ${fmt(metric.trend.score, 0)}</small>
        </div>
        <div class="setup-metric">
          <span>板块缩量回踩</span>
          <strong>${metric.pullback.label}</strong>
          <small>量比 ${metric.pullback.ratio === null ? '暂无' : fmt(metric.pullback.ratio, 2)}</small>
        </div>
        <div class="setup-metric">
          <span>当前涨跌</span>
          <strong class="${changeClass(metric.pullback.change)}">${fmtPercent(metric.pullback.change)}</strong>
          <small>用于判断回踩/修复</small>
        </div>
        <div class="setup-metric">
          <span>增强分</span>
          <strong>${fmt(metric.score, 0)}</strong>
          <small>趋势 65% + 回踩 35%</small>
        </div>
      </div>
      <div class="swing-plus-note">
        <strong>增强结论：</strong>
        <span class="swing-plus-badge ${trendTone}">${metric.trend.label}</span>
        <span class="swing-plus-badge ${pullbackTone}">${metric.pullback.label}</span>
        适合结合原有热度分判断：热度高 + 趋势保持 + 缩量回踩，才更接近波段舒服买点。
      </div>
    `;
  }

  function renderStockPlusTable(board) {
    const rows = stockPlusRows(board).slice(0, 12);
    if (!rows.length) return '<div class="empty">暂无趋势与缩量数据</div>';
    return `
      <div class="table-wrap swing-plus-table">
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>股票</th>
              <th>均线趋势</th>
              <th>最新价/MA5</th>
              <th>MA5/MA10</th>
              <th>MA10/MA20</th>
              <th>缩量回踩</th>
              <th>量比</th>
              <th>增强分</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td><strong>${item.name}</strong><br><span class="code">${item.code}</span></td>
                <td><span class="swing-plus-badge ${tone(item.trend.score, item.trend.label)}">${item.trend.label}</span></td>
                <td>${item.trend.latestClose === null || item.trend.ma5 === null ? '暂无' : `${fmt(item.trend.latestClose)} / ${fmt(item.trend.ma5)}`}</td>
                <td>${item.trend.ma5 === null || item.trend.ma10 === null ? '暂无' : `${fmt(item.trend.ma5)} / ${fmt(item.trend.ma10)}`}</td>
                <td>${item.trend.ma10 === null || item.trend.ma20 === null ? '20日不足' : `${fmt(item.trend.ma10)} / ${fmt(item.trend.ma20)}`}</td>
                <td><span class="swing-plus-badge ${tone(item.pullback.score, item.pullback.label)}">${item.pullback.label}</span></td>
                <td>${item.pullback.ratio === null ? '暂无' : fmt(item.pullback.ratio, 2)}</td>
                <td><strong>${fmt(item.plusScore, 0)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="swing-plus-help">说明：20日均线需要至少20个交易日数据；如果当前数据只有15日，会显示“20日不足”，但5日/10日趋势仍可用。</p>
    `;
  }

  function renderPanel(board) {
    return `
      <section class="card section-card swing-plus-panel">
        <div class="section-head">
          <div>
            <h2>${board.name} · 趋势与缩量回踩</h2>
            <p class="muted">增强波段判断：看趋势是否保持，以及回调是否缩量。</p>
          </div>
          <span class="count-pill">增强指标</span>
        </div>
        ${renderBoardPlus(board)}
        ${renderStockPlusTable(board)}
      </section>
    `;
  }

  function enhance() {
    if (enhancing) return;
    if (typeof state === 'undefined' || state.detailTab !== 'swing') return;
    const pane = document.querySelector('.detail-pane');
    if (!pane) return;
    enhancing = true;
    try {
      pane.querySelectorAll('.swing-plus-panel').forEach((node) => node.remove());
      const board = typeof activeBoard === 'function' ? activeBoard() : null;
      if (board) pane.insertAdjacentHTML('beforeend', renderPanel(board));
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
