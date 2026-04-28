(function installCustomDecisionView() {
  if (window.__customDecisionViewInstalled) return;
  window.__customDecisionViewInstalled = true;

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

  function average(values) {
    const valid = values.map(safeNumber).filter((value) => value !== null);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function compoundReturn(values) {
    const valid = values.map(safeNumber).filter((value) => value !== null);
    if (!valid.length) return null;
    return (valid.reduce((product, value) => product * (1 + value / 100), 1) - 1) * 100;
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

  function rows(board) {
    if (typeof trendValues === 'function') return trendValues(board);
    return (board?.trend || []).filter((row) => row?.averageChange !== null && row?.averageChange !== undefined);
  }

  function selectedIndex(trendRows) {
    if (!trendRows.length) return -1;
    if (state?.sortDate) {
      const index = trendRows.findIndex((row) => row.date === state.sortDate);
      if (index >= 0) return index;
    }
    return trendRows.length - 1;
  }

  function rowsToSelected(board, days) {
    const trendRows = rows(board);
    const end = selectedIndex(trendRows);
    if (end < 0) return [];
    return trendRows.slice(Math.max(0, end - days + 1), end + 1);
  }

  function boardChange(board, row) {
    if (!row) return null;
    const displayAverage = typeof rowDisplayAverageChange === 'function' ? rowDisplayAverageChange(board, row) : null;
    const parsedDisplay = safeNumber(displayAverage);
    if (parsedDisplay !== null) return parsedDisplay;
    return safeNumber(row.averageChange);
  }

  function indexChange(date) {
    if (typeof marketIndexRowByDate === 'function') return safeNumber(marketIndexRowByDate(date)?.changePercent);
    const trend = state?.data?.marketIndex?.trend || [];
    return safeNumber(trend.find((row) => row.date === date)?.changePercent);
  }

  function redRate(row) {
    if (typeof rowRedRate === 'function') return rowRedRate(row);
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) return null;
    return stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
  }

  function rowTurnoverValue(row) {
    if (typeof rowTotalTurnover === 'function') return rowTotalTurnover(row);
    return safeNumber(row?.totalTurnover ?? row?.totalAmount);
  }

  function stockTurnoverValue(stock) {
    if (typeof stockTurnover === 'function') return stockTurnover(stock);
    return safeNumber(stock?.turnover ?? stock?.amount);
  }

  function maxDrawdown(changes) {
    let value = 1;
    let peak = 1;
    let dd = 0;
    for (const change of changes) {
      const parsed = safeNumber(change);
      if (parsed === null) continue;
      value *= 1 + parsed / 100;
      peak = Math.max(peak, value);
      if (peak > 0) dd = Math.max(dd, (peak - value) / peak * 100);
    }
    return dd;
  }

  function trendMetricFromChanges(changes) {
    const valid = changes.map(safeNumber).filter((value) => value !== null);
    const latest = valid.at(-1) ?? null;
    const ma5 = average(valid.slice(-5));
    const ma10 = average(valid.slice(-10));
    const ma20 = valid.length >= 20 ? average(valid.slice(-20)) : null;
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

  function pullbackMetric(change, turnover, avgTurnover) {
    const ratio = turnover !== null && avgTurnover ? turnover / avgTurnover : null;
    if (change !== null && change < 0 && ratio !== null && ratio <= 0.85) return { label: '缩量回踩', score: 92, ratio };
    if (change !== null && change < 0 && ratio !== null && ratio <= 1.05) return { label: '正常回踩', score: 68, ratio };
    if (change !== null && change < 0 && ratio !== null && ratio > 1.25) return { label: '放量下跌', score: 18, ratio };
    if (change !== null && change >= 0 && ratio !== null && ratio >= 1.05) return { label: '放量修复', score: 78, ratio };
    return { label: '无明显回踩', score: 52, ratio };
  }

  function boardDecisionMetric(board) {
    const recent3 = rowsToSelected(board, 3);
    const recent5 = rowsToSelected(board, 5);
    const recent10 = rowsToSelected(board, 10);
    const recent20 = rowsToSelected(board, 20);
    const latestRow = recent20.at(-1) || null;
    const latestChange = boardChange(board, latestRow);
    const return5 = compoundReturn(recent5.map((row) => boardChange(board, row)));
    const return10 = compoundReturn(recent10.map((row) => boardChange(board, row)));
    const index5 = compoundReturn(recent5.map((row) => indexChange(row.date)));
    const index10 = compoundReturn(recent10.map((row) => indexChange(row.date)));
    const excess5 = return5 !== null && index5 !== null ? return5 - index5 : null;
    const excess10 = return10 !== null && index10 !== null ? return10 - index10 : null;
    const redRate5 = average(recent5.map(redRate));
    const changes10 = recent10.map((row) => boardChange(board, row));
    const drawdown10 = maxDrawdown(changes10);
    const upDays5 = changes10.slice(-5).filter((value) => safeNumber(value) !== null && Number(value) > 0).length;
    const valid5 = changes10.slice(-5).filter((value) => safeNumber(value) !== null).length;
    const turnoverNow = latestRow ? rowTurnoverValue(latestRow) : null;
    const avgTurnover5 = average(recent5.map(rowTurnoverValue));
    const turnoverRatio = turnoverNow !== null && avgTurnover5 ? turnoverNow / avgTurnover5 : null;
    const upDayScore = valid5 ? upDays5 / valid5 * 100 : 0;

    const heatScore = clampValue(
      0.22 * scoreRange(return5, -3, 8)
      + 0.18 * scoreRange(return10, -5, 15)
      + 0.22 * scoreRange(excess10, -4, 10)
      + 0.16 * scoreRange(redRate5, 35, 85)
      + 0.10 * upDayScore
      + 0.07 * scoreRange(turnoverRatio, 0.75, 1.6)
      + 0.05 * (100 - scoreRange(drawdown10, 4, 16)),
      0,
      100,
    );

    const trend = trendMetricFromChanges(recent20.map((row) => boardChange(board, row)));
    const pullback = pullbackMetric(latestChange, turnoverNow, average(recent10.slice(0, -1).map(rowTurnoverValue)));
    const positionScore = Math.round(0.65 * trend.score + 0.35 * pullback.score);
    const decisionScore = Math.round(0.60 * heatScore + 0.40 * positionScore);

    let status = '趋势走弱';
    if (heatScore >= 76 && (excess5 ?? 0) >= 1.5 && (return5 ?? 0) >= 3 && (redRate5 ?? 0) >= 60) status = '主升';
    else if (heatScore >= 62 && (latestChange ?? 0) < 0 && (excess10 ?? 0) > 1 && (redRate5 ?? 0) >= 45 && drawdown10 <= 9) status = '良性回踩';
    else if (heatScore >= 60 && (latestChange ?? 0) > 0 && drawdown10 >= 3 && (excess10 ?? 0) > 1) status = '二波观察';
    else if (heatScore >= 55 && (return5 ?? 0) > 0 && (excess5 ?? 0) >= 0) status = '启动';
    else if (heatScore >= 45 && drawdown10 >= 8) status = '高位震荡';
    else if (heatScore < 35 || ((excess5 ?? 0) < -1 && (latestChange ?? 0) < 0)) status = '热度退潮';

    const action = actionFor({ decisionScore, status, trend, pullback, excess10 });
    return {
      board,
      latestRow,
      latestChange,
      return5,
      return10,
      excess5,
      excess10,
      redRate5,
      drawdown10,
      turnoverRatio,
      heatScore,
      trend,
      pullback,
      positionScore,
      decisionScore,
      status,
      action,
    };
  }

  function toneFor(text, score = 0) {
    if (String(text).includes('风险') || String(text).includes('退潮') || String(text).includes('放量下跌')) return 'risk';
    if (String(text).includes('主升') || String(text).includes('均线多头') || score >= 80) return 'strong';
    if (String(text).includes('良性') || String(text).includes('缩量') || score >= 65) return 'test';
    if (String(text).includes('二波') || String(text).includes('修复')) return 'turn';
    if (String(text).includes('弱')) return 'weak';
    return 'watch';
  }

  function actionFor(metric) {
    if (metric.status === '热度退潮' || metric.pullback.label === '放量下跌') return { label: '暂时回避', tone: 'risk' };
    if (metric.decisionScore >= 78 && ['主升', '良性回踩', '二波观察'].includes(metric.status) && ['均线多头', '趋势保持'].includes(metric.trend.label)) {
      if (['缩量回踩', '正常回踩'].includes(metric.pullback.label)) return { label: '重点低吸观察', tone: 'strong' };
      if (metric.pullback.label === '放量修复') return { label: '持有/等回踩', tone: 'turn' };
      return { label: '重点跟踪', tone: 'strong' };
    }
    if (metric.decisionScore >= 62 && ['启动', '良性回踩', '二波观察'].includes(metric.status)) return { label: '加入观察', tone: 'test' };
    if (metric.status === '高位震荡') return { label: '降低追涨', tone: 'risk' };
    return { label: '普通观察', tone: 'watch' };
  }

  function macdTone(label, score) {
    const text = String(label || '');
    if (text.includes('死叉') || text.includes('绿柱扩张') || score <= 35) return 'risk';
    if (text.includes('金叉') || text.includes('红柱扩张') || text.includes('零轴上') || score >= 75) return 'strong';
    if (text.includes('收敛') || score >= 55) return 'test';
    return 'watch';
  }

  function stockItems(board) {
    return (board?.stocks || []).map((stock) => {
      const items = rowsToSelected(board, 20).map((row) => {
        const found = (row.stocks || []).find((item) => String(item.code || '') === String(stock.code || ''));
        return found ? { row, stock: found } : null;
      }).filter(Boolean);
      const changes = items.map((item) => safeNumber(item.stock.changePercent));
      const ret5 = compoundReturn(changes.slice(-5));
      const ret10 = compoundReturn(changes.slice(-10));
      const boardRet5 = compoundReturn(items.slice(-5).map((item) => boardChange(board, item.row)));
      const boardRet10 = compoundReturn(items.slice(-10).map((item) => boardChange(board, item.row)));
      const rel5 = ret5 !== null && boardRet5 !== null ? ret5 - boardRet5 : null;
      const rel10 = ret10 !== null && boardRet10 !== null ? ret10 - boardRet10 : null;
      const drawdown = maxDrawdown(changes.slice(-10));
      const latest = items.at(-1)?.stock || null;
      const closes = items.map((item) => safeNumber(item.stock.close)).filter((value) => value !== null);
      const latestClose = closes.at(-1) ?? null;
      const ma5 = closes.length >= 5 ? average(closes.slice(-5)) : null;
      const ma10 = closes.length >= 10 ? average(closes.slice(-10)) : null;
      const ma20 = closes.length >= 20 ? average(closes.slice(-20)) : null;
      let trendScore = 0;
      if (latestClose !== null && ma5 !== null && latestClose >= ma5) trendScore += 30;
      if (ma5 !== null && ma10 !== null && ma5 >= ma10) trendScore += 35;
      if (ma10 !== null && ma20 !== null && ma10 >= ma20) trendScore += 25;
      if (safeNumber(latest?.changePercent) !== null && Number(latest.changePercent) > 0) trendScore += 10;
      let trendLabel = '趋势不足';
      if (trendScore >= 85) trendLabel = '均线多头';
      else if (trendScore >= 60) trendLabel = '趋势保持';
      else if (trendScore >= 40) trendLabel = '震荡修复';
      else if (trendScore > 0) trendLabel = '趋势偏弱';

      const latestTurnover = latest ? stockTurnoverValue(latest) : null;
      const prevTurnover = average(items.slice(-6, -1).map((item) => stockTurnoverValue(item.stock)));
      const pullback = pullbackMetric(safeNumber(latest?.changePercent), latestTurnover, prevTurnover);
      const relScore = scoreRange(average([rel5, rel10]), -5, 10);
      const drawdownScore = 100 - scoreRange(drawdown, 4, 18);
      const macdScore = safeNumber(latest?.macdScore) ?? 50;
      const macdLabel = latest?.macdLabel || 'MACD暂无';
      const resilienceScore = clampValue(
        0.40 * relScore
        + 0.23 * drawdownScore
        + 0.16 * trendScore
        + 0.11 * pullback.score
        + 0.10 * macdScore,
        0,
        100,
      );
      let action = '普通观察';
      if (resilienceScore >= 78 && ['均线多头', '趋势保持'].includes(trendLabel) && pullback.label !== '放量下跌') action = '优先观察';
      else if (resilienceScore >= 65 && pullback.label !== '放量下跌') action = '可观察';
      else if (pullback.label === '放量下跌' || trendLabel === '趋势偏弱' || macdScore <= 30) action = '谨慎';
      return {
        code: stock.code,
        name: stock.name || stock.code,
        rel5,
        rel10,
        drawdown,
        trendLabel,
        trendScore,
        pullback,
        macdLabel,
        macdScore,
        resilienceScore,
        action,
      };
    }).sort((a, b) => b.resilienceScore - a.resilienceScore);
  }

  function conclusion(metric) {
    const base = `${metric.board.name}当前为${metric.status}，波段综合分${fmt(metric.decisionScore, 0)}。`;
    if (metric.action.label === '重点低吸观察') return `${base}热度和趋势都较好，且回踩相对健康，适合重点看板块内韧性股。`;
    if (metric.action.label === '持有/等回踩') return `${base}板块正在修复，已有仓位可跟踪，没仓位不宜过急追高。`;
    if (metric.action.label === '暂时回避') return `${base}出现退潮或放量下跌特征，先不要当成良性回踩。`;
    if (metric.action.label === '降低追涨') return `${base}波动变大，适合等回踩确认，不适合追高。`;
    return `${base}可以放入观察池，继续等待趋势和量价进一步确认。`;
  }

  function metricCard(title, value, sub, klass = '') {
    return `<div class="decision-metric"><span>${title}</span><strong class="${klass}">${value}</strong><small>${sub}</small></div>`;
  }

  function renderDecisionPanel(board) {
    const metric = boardDecisionMetric(board);
    const stocks = stockItems(board).slice(0, 10);
    return `
      <section class="card section-card decision-panel">
        <div class="decision-score-card">
          <div>
            <h2>${board.name} · 波段决策</h2>
            <p>${conclusion(metric)}</p>
            <div class="decision-badges">
              <span class="decision-badge ${toneFor(metric.status, metric.heatScore)}">${metric.status}</span>
              <span class="decision-badge ${toneFor(metric.trend.label, metric.trend.score)}">${metric.trend.label}</span>
              <span class="decision-badge ${toneFor(metric.pullback.label, metric.pullback.score)}">${metric.pullback.label}</span>
              <span class="decision-action ${metric.action.tone}">${metric.action.label}</span>
            </div>
          </div>
          <div class="decision-score-number">${fmt(metric.decisionScore, 0)}</div>
        </div>

        <div class="decision-metrics">
          ${metricCard('热度分', fmt(metric.heatScore, 0), '5/10日强度')}
          ${metricCard('10日超额', fmtPercent(metric.excess10), '板块 - 指数', changeClass(metric.excess10))}
          ${metricCard('5日红盘率', metric.redRate5 === null ? '暂无' : fmtPercent(metric.redRate5, 0), '内部扩散')}
          ${metricCard('趋势确认', metric.trend.label, `趋势分 ${fmt(metric.trend.score, 0)}`)}
          ${metricCard('回踩状态', metric.pullback.label, `量比 ${metric.pullback.ratio === null ? '暂无' : fmt(metric.pullback.ratio, 2)}`)}
          ${metricCard('10日回撤', fmtPercent(metric.drawdown10), '波段风险')}
        </div>

        <div class="decision-section-title">
          <strong>韧性股 Top 10</strong>
          <span>只保留决策需要的核心列</span>
        </div>
        <div class="table-wrap decision-stock-table">
          <table>
            <thead>
              <tr>
                <th>排名</th><th>股票</th><th>韧性分</th><th>5日相对板块</th><th>趋势</th><th>MACD</th><th>回踩</th><th>操作标签</th>
              </tr>
            </thead>
            <tbody>
              ${stocks.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${item.name}</strong><br><span class="code">${item.code}</span></td>
                  <td><strong>${fmt(item.resilienceScore, 0)}</strong></td>
                  <td class="${changeClass(item.rel5)}">${fmtPercent(item.rel5)}</td>
                  <td><span class="decision-badge ${toneFor(item.trendLabel, item.trendScore)}">${item.trendLabel}</span></td>
                  <td><span class="decision-badge ${macdTone(item.macdLabel, item.macdScore)}">${item.macdLabel}</span></td>
                  <td><span class="decision-badge ${toneFor(item.pullback.label, item.pullback.score)}">${item.pullback.label}</span></td>
                  <td><span class="decision-action ${item.action === '优先观察' ? 'strong' : item.action === '可观察' ? 'test' : item.action === '谨慎' ? 'risk' : 'watch'}">${item.action}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <details class="decision-fold">
          <summary>展开明细口径</summary>
          <p>波段综合分 = 热度分 60% + 位置分 40%。热度分看5/10日强度、10日超额、红盘率、量能和回撤；位置分看趋势确认与缩量回踩。个股韧性分看相对板块强度、回撤、趋势和回踩状态。</p>
        </details>
      </section>
    `;
  }

  function overviewBuckets() {
    const metrics = (state?.data?.boards || []).map(boardDecisionMetric).filter((metric) => metric.latestRow);
    return {
      hot: metrics.filter((item) => ['主升', '启动', '二波观察'].includes(item.status)).sort((a, b) => b.decisionScore - a.decisionScore).slice(0, 8),
      pullback: metrics.filter((item) => item.status === '良性回踩').sort((a, b) => b.decisionScore - a.decisionScore).slice(0, 8),
      risk: metrics.filter((item) => ['高位震荡', '趋势走弱', '热度退潮'].includes(item.status)).sort((a, b) => a.decisionScore - b.decisionScore).slice(0, 8),
    };
  }

  function boardItem(metric) {
    return `
      <button class="decision-board-item" data-board-code="${metric.board.code}" type="button">
        <span><strong>${metric.board.name}</strong><small>${metric.status} · ${metric.trend.label} · ${metric.pullback.label}</small></span>
        <span class="decision-badge ${toneFor(metric.status, metric.decisionScore)}">${fmt(metric.decisionScore, 0)}</span>
      </button>
    `;
  }

  function renderDecisionOverview() {
    const buckets = overviewBuckets();
    return `
      <section class="card section-card decision-overview-panel">
        <div class="section-head">
          <div><h2>今日波段决策总览</h2><p class="muted">只保留主线、良性回踩、风险退潮三类，点击板块直接进入波段决策。</p></div>
          <span class="count-pill">简化版</span>
        </div>
        <div class="decision-overview-grid">
          <div class="pool-card primary"><div class="pool-title"><strong>主线/启动</strong><span>${buckets.hot.length}</span></div>${buckets.hot.map(boardItem).join('') || '<div class="pool-empty">暂无</div>'}</div>
          <div class="pool-card"><div class="pool-title"><strong>良性回踩</strong><span>${buckets.pullback.length}</span></div>${buckets.pullback.map(boardItem).join('') || '<div class="pool-empty">暂无</div>'}</div>
          <div class="pool-card risk"><div class="pool-title"><strong>风险/退潮</strong><span>${buckets.risk.length}</span></div>${buckets.risk.map(boardItem).join('') || '<div class="pool-empty">暂无</div>'}</div>
        </div>
      </section>
    `;
  }

  function ensureSwingTabName() {
    document.querySelectorAll('[data-detail-tab="swing"]').forEach((button) => {
      button.textContent = '波段决策';
    });
  }

  function enhance() {
    if (enhancing || typeof state === 'undefined') return;
    const pane = document.querySelector('.detail-pane');
    if (!pane) return;
    enhancing = true;
    document.body.classList.add('decision-mode');
    try {
      ensureSwingTabName();
      pane.querySelectorAll('.decision-panel, .decision-overview-panel').forEach((node) => node.remove());
      if (state.detailTab === 'overview') {
        const anchor = pane.querySelector('.detail-tabs-card');
        if (anchor) anchor.insertAdjacentHTML('afterend', renderDecisionOverview());
      }
      if (state.detailTab === 'swing') {
        const board = typeof activeBoard === 'function' ? activeBoard() : null;
        if (board) pane.insertAdjacentHTML('beforeend', renderDecisionPanel(board));
      }
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

  document.addEventListener('click', (event) => {
    const item = event.target.closest?.('.decision-board-item');
    if (item && typeof state !== 'undefined') {
      state.selectedCode = item.dataset.boardCode || state.selectedCode;
      state.detailTab = 'swing';
      if (typeof render === 'function') render();
      scheduleEnhance();
    }
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
