(function installCustomResonancePanel() {
  if (window.__customResonancePanelInstalled) return;
  window.__customResonancePanelInstalled = true;

  const RESONANCE_TAB = 'resonance';
  const STYLE_ID = 'custom-resonance-panel-style';
  let scheduled = false;
  let enhancing = false;
  let linkedBoardCode = null;
  let resonanceCache = null;

  function effectiveLinkedBoardCode() {
    return linkedBoardCode || null;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .resonance-panel .resonance-metrics,
      .resonance-panel .resonance-current-note,
      .resonance-panel .resonance-score-parts {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

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

  function getCache() {
    if (
      !resonanceCache
      || resonanceCache.data !== state?.data
      || resonanceCache.sortDate !== state?.sortDate
      || resonanceCache.membership !== state?.membership
    ) {
      resonanceCache = {
        data: state?.data,
        sortDate: state?.sortDate,
        membership: state?.membership,
        rowsByDate: null,
        rankedByDate: null,
        datesAsc: null,
        indexDetails: new Map(),
        indexRows: null,
        marketStates: new Map(),
        boardCodes: new Map(),
        maxIndexAbs: null,
        topRows: new Map(),
      };
    }
    return resonanceCache;
  }

  function indexRowsByDate() {
    const cache = getCache();
    if (cache.indexRows) return cache.indexRows;
    cache.indexRows = new Map((state?.data?.marketIndex?.trend || []).map((row) => [row.date, row]));
    return cache.indexRows;
  }

  function getIndexRowFast(date) {
    return indexRowsByDate().get(date) || getIndexRow(date);
  }

  function marketStateForDate(date) {
    const cache = getCache();
    if (cache.marketStates.has(date)) return cache.marketStates.get(date);
    const stateForDate = typeof marketVolumePriceState === 'function'
      ? marketVolumePriceState(date)
      : null;
    cache.marketStates.set(date, stateForDate);
    return stateForDate;
  }

  function displayCodesForBoard(board) {
    const cache = getCache();
    const key = String(board?.code || '');
    if (cache.boardCodes.has(key)) return cache.boardCodes.get(key);
    let codes = null;
    if (typeof displayStockCodes === 'function') {
      codes = displayStockCodes(board);
    }
    if (!(codes instanceof Set)) {
      codes = new Set((board?.stocks || []).map((stock) => String(stock.code || '')).filter(Boolean));
    }
    cache.boardCodes.set(key, codes);
    return codes;
  }

  function boardChangeForMatrix(board, row) {
    const codes = displayCodesForBoard(board);
    if (!codes.size) return safeNumber(row?.averageChange);
    const stocks = (row?.stocks || []).filter((stock) =>
      codes.has(String(stock.code || ''))
      && safeNumber(stock.changePercent) !== null);
    if (!stocks.length) return safeNumber(row?.averageChange);
    return stocks.reduce((sum, stock) => sum + Number(stock.changePercent || 0), 0) / stocks.length;
  }

  function buildMatrixResonanceItem(board, row) {
    if (!board || !row?.date) return null;
    const indexRow = getIndexRowFast(row.date);
    const boardPct = boardChangeForMatrix(board, row);
    const indexPct = safeNumber(indexRow?.changePercent);
    if (boardPct === null || indexPct === null) return null;

    const redRate = getRedRate(row);
    const excessPct = boardPct - indexPct;
    const marketState = marketStateForDate(row.date);
    const indexVolumeExpanded = marketState?.amountDirection === 'expand';
    const directionScore = indexPct >= 0 && boardPct >= 0 ? 25 : (indexPct < 0 && boardPct >= 0 ? 16 : 0);
    const excessScore = excessPct >= 2 ? 30 : (excessPct >= 1 ? 22 : (excessPct >= 0 ? 12 : 0));
    const indexEnvScore = indexPct >= 1 ? 15 : (indexPct >= 0.3 ? 11 : (indexPct >= 0 ? 7 : 0));
    const volumeScore = indexVolumeExpanded && indexPct >= 0 && boardPct >= 0 ? 20 : (indexVolumeExpanded ? 8 : 0);
    const diffusionScore = redRate === null ? 0 : (redRate >= 75 ? 10 : (redRate >= 60 ? 7 : (redRate >= 50 ? 4 : 0)));
    const score = directionScore + excessScore + indexEnvScore + volumeScore + diffusionScore;
    return {
      date: row.date,
      boardPct,
      indexPct,
      excessPct,
      redRate,
      directionScore,
      excessScore,
      indexEnvScore,
      volumeScore,
      diffusionScore,
      score,
      resonanceScore: score,
      indexVolumeExpanded,
      marketState,
    };
  }

  function sortedResonanceRows(rows) {
    return [...(rows || [])]
      .filter((item) => safeNumber(item.boardPct) !== null)
      .sort((a, b) =>
        Number(b.boardPct) - Number(a.boardPct)
        || Number(b.score ?? -999999) - Number(a.score ?? -999999)
        || Number(b.excessPct ?? -999999) - Number(a.excessPct ?? -999999)
        || String(a.boardName || '').localeCompare(String(b.boardName || ''), 'zh-Hans-CN'));
  }

  function boardRowsByDate() {
    const cache = getCache();
    if (cache.rowsByDate) return cache.rowsByDate;
    const byDate = new Map();
    for (const board of state?.data?.boards || []) {
      for (const rowItem of getTrendRows(board)) {
        const item = buildMatrixResonanceItem(board, rowItem);
        if (!item) continue;
        const row = {
          ...item,
          boardCode: board.code,
          boardName: board.name,
        };
        const rows = byDate.get(item.date) || [];
        rows.push(row);
        byDate.set(item.date, rows);
      }
    }
    cache.rowsByDate = byDate;
    return byDate;
  }

  function rankedRowsByDate() {
    const cache = getCache();
    if (cache.rankedByDate) return cache.rankedByDate;
    const ranked = new Map();
    for (const [date, rows] of boardRowsByDate()) {
      ranked.set(date, sortedResonanceRows(rows));
    }
    cache.rankedByDate = ranked;
    return ranked;
  }

  function resonanceDatesAsc() {
    const cache = getCache();
    if (cache.datesAsc) return cache.datesAsc;
    cache.datesAsc = typeof trendDatesAsc === 'function'
      ? trendDatesAsc()
      : [...boardRowsByDate().keys()].sort((a, b) => String(a).localeCompare(String(b)));
    return cache.datesAsc;
  }

  function bestBoardByDate() {
    const winners = new Map();
    for (const [date, rows] of rankedRowsByDate()) {
      const best = rows[0] || null;
      if (best) winners.set(date, best);
    }
    return winners;
  }

  function indexDetail(date) {
    const cache = getCache();
    if (cache.indexDetails.has(date)) return cache.indexDetails.get(date);
    const row = getIndexRow(date);
    const change = safeNumber(row?.changePercent);
    const detail = {
      change,
      label: row?.label || '暂无',
      close: safeNumber(row?.close),
    };
    cache.indexDetails.set(date, detail);
    return detail;
  }

  function scoreTone(score) {
    const parsed = safeNumber(score);
    if (parsed === null) return 'empty';
    if (parsed >= 75) return 'hot';
    if (parsed >= 65) return 'warm';
    if (parsed >= 55) return 'watch';
    if (parsed >= 45) return 'cool';
    return 'cold';
  }

  function changeTone(value) {
    const parsed = safeNumber(value);
    if (parsed === null) return 'empty';
    if (parsed >= 5) return 'hot';
    if (parsed >= 3) return 'warm';
    if (parsed >= 1) return 'watch';
    if (parsed >= 0) return 'cool';
    return 'cold';
  }

  function findBoardByCode(code) {
    return (state?.data?.boards || []).find((board) => String(board.code) === String(code)) || null;
  }

  function boardRankInRows(rows, boardCode) {
    const index = (rows || []).findIndex((item) => String(item.boardCode) === String(boardCode));
    return index >= 0 ? { rank: index + 1, item: rows[index] } : null;
  }

  function maxIndexAbs() {
    const cache = getCache();
    if (cache.maxIndexAbs !== null) return cache.maxIndexAbs;
    const values = resonanceDatesAsc()
      .map((date) => Math.abs(indexDetail(date).change ?? 0))
      .filter((value) => Number.isFinite(value));
    cache.maxIndexAbs = Math.max(1, ...values);
    return cache.maxIndexAbs;
  }

  function dailyTopBoards(limit = 10) {
    const cache = getCache();
    const linkedCode = effectiveLinkedBoardCode() || '';
    const cacheKey = `${limit}|${linkedCode}`;
    if (cache.topRows.has(cacheKey)) return cache.topRows.get(cacheKey);
    const dates = resonanceDatesAsc();
    const rankedByDate = rankedRowsByDate();
    const maxAbs = maxIndexAbs();
    const rows = [...dates].reverse().map((date) => {
      const allRows = rankedByDate.get(date) || [];
      const detail = indexDetail(date);
      const marketState = marketStateForDate(date);
      const isToday = String(date) === String(state?.sortDate || state?.data?.date || '');
      const isVolumeRise = marketState?.priceDirection === 'rise' && marketState?.amountDirection === 'expand';
      const isIndexRise = safeNumber(detail.change) !== null && Number(detail.change) >= 0;
      return {
        date,
        index: {
          ...detail,
          marketLabel: marketState?.label || detail.label,
          special: isToday,
          specialTone: isToday && isVolumeRise ? 'volume-rise' : (isToday && isIndexRise ? 'today-rise' : 'today'),
        },
        indexWidth: Math.max(4, Math.min(100, Math.abs(detail.change ?? 0) / maxAbs * 100)),
        boards: allRows.slice(0, limit),
        linked: linkedCode ? boardRankInRows(allRows, linkedCode) : null,
      };
    });
    cache.topRows.set(cacheKey, rows);
    return rows;
  }

  function refreshPanelOnly() {
    const pane = document.querySelector('.detail-pane');
    const existing = pane?.querySelector('.resonance-panel');
    if (!pane || !existing || state?.detailTab !== RESONANCE_TAB) return false;
    existing.outerHTML = renderPanelHtml();
    return true;
  }

  function syncSidebarSelection(boardCode) {
    document.querySelectorAll('.board-button').forEach((button) => {
      button.classList.toggle('active', String(button.dataset.code) === String(boardCode));
    });
  }

  function renderBoardChip(board, index, options = {}) {
    const activeCode = effectiveLinkedBoardCode();
    const isLinked = activeCode && String(board.boardCode) === String(activeCode);
    const rank = options.rank ?? index + 1;
    return `
      <button
        class="resonance-board-chip ${changeTone(board.boardPct)}${isLinked ? ' linked' : ''}${options.outsideTop ? ' outside-top' : ''}${options.pinned ? ' pinned' : ''}"
        type="button"
        data-board-code="${board.boardCode}"
        title="${board.boardName} 涨跌幅 ${fmtPercent(board.boardPct)} / 共振分 ${fmt(board.score, 0)}分"
      >
        <span>${rank}</span>
        <strong>${board.boardName}</strong>
        <em>${fmtPercent(board.boardPct)}</em>
      </button>
    `;
  }

  function renderTopBoardList(row) {
    if (!row.boards.length && !row.linked) return '<span class="resonance-empty-cell">暂无</span>';
    const html = row.boards.map((board, index) => renderBoardChip(board, index));
    if (row.linked && !row.boards.some((board) => String(board.boardCode) === String(row.linked.item.boardCode))) {
      html.push(renderBoardChip(row.linked.item, row.linked.rank - 1, {
        outsideTop: true,
        pinned: true,
        rank: row.linked.rank,
      }));
    }
    return html.join('');
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
    const rows = dailyTopBoards(10);
    if (!rows.length) return '<div class="empty">暂无板块与指数共振数据</div>';
    return `
      <div class="resonance-matrix${effectiveLinkedBoardCode() ? ' has-link' : ''}">
        <div class="resonance-matrix-head">
          <span>日期</span>
          <span>${state?.data?.marketIndex?.name || '指数'}涨跌幅</span>
          <span>当天涨跌幅最高 10 个板块</span>
        </div>
        ${rows.map((row) => `
          <div class="resonance-day-row">
            <div class="resonance-date">${fmtDate(row.date)}</div>
            <div class="resonance-index-bar-cell${row.index.special ? ` ${row.index.specialTone}` : ''}">
              <div class="resonance-index-value">
                <strong class="${changeClass(row.index.change)}">${fmtPercent(row.index.change)}</strong>
                ${row.index.special ? `<span class="resonance-index-special">${row.index.marketLabel || '今日'}</span>` : ''}
              </div>
              <div class="resonance-index-bar-track" aria-hidden="true">
                <span
                  class="resonance-index-bar ${changeClass(row.index.change)}${row.index.special ? ` ${row.index.specialTone}` : ''}"
                  style="width: ${row.indexWidth}%"
                ></span>
              </div>
            </div>
            <div class="resonance-top-board-list">
              ${renderTopBoardList(row)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderPanelHtml(board) {
    const indexName = state?.data?.marketIndex?.name || '指数';
    const rows = dailyTopBoards(10);
    const linkedBoard = effectiveLinkedBoardCode() ? findBoardByCode(effectiveLinkedBoardCode()) : null;
    return `
      <section class="card section-card resonance-panel">
        <div class="section-head">
          <div>
            <h2>指数共振</h2>
            <p class="muted">每行一天，只看 ${indexName} 涨跌幅，以及当天涨跌幅最高的 10 个自定义板块。</p>
          </div>
          <div class="resonance-head-actions">
            ${linkedBoard ? `
              <span class="resonance-linked-label">关联：${linkedBoard.name}</span>
              <button class="resonance-clear-link" type="button">取消</button>
            ` : ''}
            <span class="count-pill">${rows.length} 日</span>
          </div>
        </div>
        ${renderTable()}
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
    const stack = pane.querySelector('.stack') || pane;
    const existing = stack.querySelector('.resonance-panel');
    if (state?.detailTab !== RESONANCE_TAB) {
      stack.querySelectorAll('.resonance-panel').forEach((node) => node.remove());
      return;
    }
    if (existing) return;

    if (stack.classList?.contains('stack')) {
      [...stack.children].forEach((child) => {
        if (!child.classList?.contains('detail-tabs-card')) child.remove();
      });
    }
    stack.insertAdjacentHTML('beforeend', renderPanelHtml());
  }

  function activateResonanceView() {
    state.detailTab = RESONANCE_TAB;
    ensureStyles();
    ensureTab();
    ensurePanel();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'dashboard:resize' }, '*');
    }
  }

  function enhance() {
    if (enhancing) return;
    if (typeof state === 'undefined') return;
    enhancing = true;
    try {
      ensureStyles();
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
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    activateResonanceView();
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.resonance-board-chip[data-board-code]');
    if (!button || typeof state === 'undefined') return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    linkedBoardCode = button.dataset.boardCode;
    state.detailTab = RESONANCE_TAB;
    if (!refreshPanelOnly()) {
      activateResonanceView();
    }
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.resonance-clear-link');
    if (!button || typeof state === 'undefined') return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    linkedBoardCode = null;
    state.detailTab = RESONANCE_TAB;
    if (!refreshPanelOnly()) {
      activateResonanceView();
    }
  });

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
