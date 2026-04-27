(function installCustomResonancePanel() {
  if (window.__customResonancePanelInstalled) return;
  window.__customResonancePanelInstalled = true;

  const RESONANCE_TAB = 'resonance';
  let scheduled = false;
  let enhancing = false;

  function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

  function getRedRate(row) {
    if (typeof rowRedRate === 'function') return rowRedRate(row);
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) return null;
    return stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
  }

  function getBoardLabel(board, date) {
    if (typeof boardLabelFor !== 'function') return '暂无';
    return boardLabelFor(board, date)?.label || '暂无';
  }

  function calcDirectionScore(indexPct, boardPct) {
    if (indexPct >= 0 && boardPct >= 0) return 30;
    if (indexPct < 0 && boardPct >= 0) return 20;
    return 0;
  }

  function calcExcessScore(excessPct) {
    if (excessPct >= 2) return 30;
    if (excessPct >= 1) return 20;
    if (excessPct >= 0) return 10;
    return 0;
  }

  function calcIndexEnvScore(indexPct) {
    if (indexPct >= 1) return 20;
    if (indexPct >= 0.3) return 15;
    if (indexPct > 0) return 10;
    return 0;
  }

  function calcDiffusionScore(redRate) {
    const parsed = safeNumber(redRate);
    if (parsed === null) return 0;
    if (parsed >= 80) return 20;
    if (parsed >= 60) return 15;
    if (parsed >= 50) return 10;
    return 0;
  }

  function calcLabel(indexPct, boardPct, excessPct, score) {
    if (indexPct >= 0 && boardPct >= 0 && excessPct >= 2 && score >= 80) return '强共振';
    if (indexPct >= 0 && boardPct >= 0 && excessPct >= 0) return '弱共振';
    if (indexPct < 0 && boardPct > 0 && excessPct >= 1) return '逆势强';
    if (indexPct >= 0 && boardPct >= 0 && excessPct < 0) return '被动跟随';
    if (indexPct >= 0 && boardPct < 0) return '负背离';
    if (indexPct < 0 && boardPct < 0) return '共振杀跌';
    return '无明显共振';
  }

  function toneFor(label) {
    return {
      强共振: 'strong',
      弱共振: 'test',
      逆势强: 'turn',
      被动跟随: 'mixed',
      负背离: 'divergence',
      共振杀跌: 'weak',
      无明显共振: 'watch',
    }[label] || 'watch';
  }

  function conclusionFor(item) {
    if (!item) return '暂无共振结论。';
    if (item.label === '强共振') return '指数环境支持，板块明显跑赢指数，属于更舒服的主动走强。';
    if (item.label === '弱共振') return '板块与指数同向修复，且略强于指数，可继续观察持续性。';
    if (item.label === '逆势强') return '指数不配合但板块独立走强，次日重点看能否在指数修复时继续加强。';
    if (item.label === '被动跟随') return '指数上涨带动板块上涨，但板块弱于指数，主动性一般。';
    if (item.label === '负背离') return '指数修复时板块没有跟随，说明资金认可度不足。';
    if (item.label === '共振杀跌') return '指数和板块同步走弱，短线风险偏高。';
    return '板块与指数之间没有形成清晰共振。';
  }

  function buildResonanceItem(board, row) {
    if (typeof buildIndexResonanceItem === 'function') {
      const item = buildIndexResonanceItem(board, row);
      return item ? { ...item, boardLabel: getBoardLabel(board, row.date) } : null;
    }
    if (!board || !row?.date) return null;
    const indexRow = getIndexRow(row.date);
    const boardPct = getBoardChange(board, row);
    const indexPct = safeNumber(indexRow?.changePercent);
    if (boardPct === null || indexPct === null) return null;

    const redRate = getRedRate(row);
    const excessPct = boardPct - indexPct;
    const directionScore = calcDirectionScore(indexPct, boardPct);
    const excessScore = calcExcessScore(excessPct);
    const indexEnvScore = calcIndexEnvScore(indexPct);
    const diffusionScore = calcDiffusionScore(redRate);
    const score = directionScore + excessScore + indexEnvScore + diffusionScore;
    const label = calcLabel(indexPct, boardPct, excessPct, score);

    return {
      date: row.date,
      boardPct,
      indexPct,
      excessPct,
      redRate,
      directionScore,
      excessScore,
      indexEnvScore,
      volumeScore: 0,
      diffusionScore,
      score,
      resonanceScore: score,
      label,
      tone: toneFor(label),
      boardLabel: getBoardLabel(board, row.date),
      conclusion: conclusionFor({ label }),
    };
  }

  function resonanceSeries(board) {
    if (typeof indexResonanceSeries === 'function') {
      return indexResonanceSeries(board).map((item) => ({
        ...item,
        boardLabel: getBoardLabel(board, item.date),
      }));
    }
    return getTrendRows(board)
      .map((row) => buildResonanceItem(board, row))
      .filter(Boolean);
  }

  function resonanceSummary(series) {
    const labels = ['强共振', '弱共振', '逆势强', '被动跟随', '负背离', '共振杀跌', '无明显共振'];
    return labels.map((label) => ({
      label,
      count: series.filter((item) => item.label === label).length,
      tone: toneFor(label),
    }));
  }

  function currentItem(series) {
    return series.find((item) => item.date === state?.sortDate) || series.at(-1) || null;
  }

  function renderScoreParts(item) {
    const parts = [
      ['方向', item.directionScore, 25],
      ['超额', item.excessScore, 30],
      ['指数', item.indexEnvScore, 15],
      ['量能', item.volumeScore ?? 0, 20],
      ['扩散', item.diffusionScore, 10],
    ];
    return `
      <div class="resonance-score-parts">
        ${parts.map(([name, score, total]) => `
          <div class="resonance-score-part">
            <span>${name}</span>
            <strong>${fmt(score, 0)}/${total}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderTable(series) {
    const rows = [...series].reverse();
    if (!rows.length) return '<div class="empty">暂无板块与指数共振数据</div>';
    return `
      <div class="table-wrap resonance-table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>板块涨幅</th>
              <th>${state?.data?.marketIndex?.name || '指数'}涨幅</th>
              <th>超额强度</th>
              <th>红盘率</th>
              <th>共振分</th>
              <th>共振标签</th>
              <th>板块标签</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => `
              <tr>
                <td>${fmtDate(item.date)}</td>
                <td class="${changeClass(item.boardPct)}">${fmtPercent(item.boardPct)}</td>
                <td class="${changeClass(item.indexPct)}">${fmtPercent(item.indexPct)}</td>
                <td class="${changeClass(item.excessPct)}">${fmtPercent(item.excessPct)}</td>
                <td>${item.redRate === null ? '暂无' : fmtPercent(item.redRate, 0)}</td>
                <td><strong>${fmt(item.score, 0)}</strong></td>
                <td><span class="resonance-badge ${item.tone}">${item.label}</span></td>
                <td>${item.boardLabel}</td>
                <td class="resonance-conclusion-cell">${item.conclusion}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPanelHtml(board) {
    const series = resonanceSeries(board);
    const current = currentItem(series);
    const indexName = state?.data?.marketIndex?.name || '指数';
    const setup = typeof boardSetup === 'function' ? boardSetup(board, state?.sortDate) : null;
    const mainline = setup?.mainline || null;
    const recent = setup?.recentResonance || (typeof recentIndexResonance === 'function' ? recentIndexResonance(board, state?.sortDate, 5) : null);

    if (!current) {
      return `
        <section class="card section-card resonance-panel">
          <div class="section-head">
            <div>
              <h2>${board?.name || '板块'} · 指数共振</h2>
              <p class="muted">缺少板块或指数涨跌幅数据，暂时无法计算共振。</p>
            </div>
          </div>
        </section>
      `;
    }

    const summary = resonanceSummary(series);
    return `
      <section class="card section-card resonance-panel">
        <div class="section-head">
          <div>
            <h2>${board.name} · 指数共振</h2>
            <p class="muted">
              对比指数：${indexName}。核心看今日共振分、近5日放量确认和窗口超额，避免要求每天都必须共振。
            </p>
          </div>
          <span class="resonance-badge ${mainline?.tone || current.tone}">${mainline?.label || current.label}</span>
        </div>

        <div class="resonance-metrics">
          <div class="setup-metric">
            <span>主线状态</span>
            <strong class="state-chip ${mainline?.tone || 'watch'}">${mainline?.label || '暂无'}</strong>
            <small>${mainline?.detail || '缺少主线状态判断'}</small>
          </div>
          <div class="setup-metric">
            <span>近5日确认</span>
            <strong class="state-chip ${recent?.tone || 'watch'}">${recent?.label || '暂无'}</strong>
            <small>${recent?.detail || '缺少窗口共振数据'}</small>
          </div>
          <div class="setup-metric">
            <span>今日共振分</span>
            <strong class="state-chip ${current.tone}">${fmt(current.score, 0)} · ${current.label}</strong>
            <small>${current.indexVolumeExpanded ? '指数放量' : '指数未放量'} · 超额 ${fmtPercent(current.excessPct)}</small>
          </div>
          <div class="setup-metric">
            <span>板块涨幅</span>
            <strong class="${changeClass(current.boardPct)}">${fmtPercent(current.boardPct)}</strong>
            <small>正宗股平均涨幅</small>
          </div>
          <div class="setup-metric">
            <span>指数涨幅</span>
            <strong class="${changeClass(current.indexPct)}">${fmtPercent(current.indexPct)}</strong>
            <small>${indexName}</small>
          </div>
          <div class="setup-metric">
            <span>超额强度</span>
            <strong class="${changeClass(current.excessPct)}">${fmtPercent(current.excessPct)}</strong>
            <small>板块涨幅 - 指数涨幅</small>
          </div>
          <div class="setup-metric">
            <span>红盘率</span>
            <strong>${current.redRate === null ? '暂无' : fmtPercent(current.redRate, 0)}</strong>
            <small>板块内部扩散</small>
          </div>
        </div>

        <div class="resonance-current-note">
          <strong>当前结论：</strong>${current.conclusion}
        </div>

        ${renderScoreParts(current)}

        <div class="resonance-summary">
          ${summary.map((item) => `
            <span class="count-pill resonance-summary-pill ${item.tone}">${item.label} ${item.count}</span>
          `).join('')}
        </div>

        ${renderTable(series)}
      </section>
    `;
  }

  function ensureTab() {
    const tabs = document.querySelector('.detail-tabs');
    if (!tabs) return;
    let tab = tabs.querySelector('[data-detail-tab="resonance"]');
    if (!tab) {
      tab = document.createElement('button');
      tab.className = 'detail-tab-btn';
      tab.dataset.detailTab = RESONANCE_TAB;
      tab.textContent = '指数共振';
      const trendTab = tabs.querySelector('[data-detail-tab="trend"]');
      if (trendTab?.nextSibling) {
        tabs.insertBefore(tab, trendTab.nextSibling);
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
    pane.querySelectorAll('.resonance-panel').forEach((node) => node.remove());
    if (state?.detailTab !== RESONANCE_TAB) return;

    const board = typeof activeBoard === 'function' ? activeBoard() : null;
    if (!board) return;
    pane.insertAdjacentHTML('beforeend', renderPanelHtml(board));
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

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-detail-tab="resonance"]');
    if (!button || typeof state === 'undefined') return;
    state.detailTab = RESONANCE_TAB;
    if (typeof render === 'function') render();
    scheduleEnhance();
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
