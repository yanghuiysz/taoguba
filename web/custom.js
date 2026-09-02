const app = document.querySelector('#app');

const TREND_STATS_DISPLAY_DAYS = 15; // 下探趋势统计面板只展示最近N个交易日

const state = {
  data: null,
  fullATurnover: null,
  fullATurnoverCache: new Map(),
  cybTrendStats: null,
  labels: [],
  membership: { overrides: [] },
  selectedCode: null,
  sortMode: 'avg_change',
  sortDate: null,
  fullATurnoverSort: { key: 'displayAmount', direction: 'desc' },
  profitSort: { key: 'profitScore', direction: 'desc' },
  stockListSort: { key: 'displayChangePercent', direction: 'desc' },
  detailTab: 'overview',
  trendInterval: '15',   // 趋势统计粒度: '15'/'30'/'compare'
  editable: false,
  busy: false,
  message: '',
};

const number = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无';
  return Number(value).toFixed(digits);
};

const amountText = (value) => {
  const parsed = Number(value);
  if (value === null || value === undefined || Number.isNaN(parsed)) return '暂无';
  const abs = Math.abs(parsed);
  if (abs >= 100000000) return `${number(parsed / 100000000)}亿`;
  if (abs >= 10000) return `${number(parsed / 10000)}万`;
  return number(parsed, 0);
};

const volumeText = (value) => {
  const parsed = Number(value);
  if (value === null || value === undefined || Number.isNaN(parsed)) return '暂无';
  const abs = Math.abs(parsed);
  if (abs >= 100000000) return `${number(parsed / 100000000)}亿股`;
  if (abs >= 10000) return `${number(parsed / 10000)}万股`;
  return `${number(parsed, 0)}股`;
};

const shortDate = (date) => (date ? String(date).slice(5) : '暂无');

const signedClass = (value) => (Number(value) >= 0 ? 'rise' : 'fall');

const signedValueClass = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '';
  return parsed > 0 ? 'rise' : 'fall';
};

const signedFundFlowText = (value) => {
  const parsed = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed)) return '暂无';
  const prefix = parsed > 0 ? '+' : '';
  const text = `${prefix}${number(parsed / 100000000)}亿`;
  return text;
};

const sortChangeValue = (value) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? -999999 : parsed;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const percentText = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无';
  return `${number(value)}%`;
};

const profitScoreValue = (stock) => {
  const parsed = Number(stock?.profitScore);
  return Number.isFinite(parsed) ? parsed : null;
};

const profitTone = (label, score) => {
  if (label === '盈利加速' || label === '扭亏为盈' || Number(score) >= 80) return 'strong';
  if (label === '盈利改善' || label === '稳定盈利' || label === '周期修复' || Number(score) >= 65) return 'test';
  if (label === '盈利承压' || label === '亏损扩大' || label === '由盈转亏') return 'weak';
  return 'watch';
};

const profitMetricText = (metrics, key, suffix = '%', digits = 1) => {
  const value = metrics?.[key];
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无';
  return suffix ? `${number(value, digits)}${suffix}` : number(value, digits);
};

const sortLabel = (sortState, key) => {
  if (sortState.key !== key) return '';
  return sortState.direction === 'asc' ? ' ↑' : ' ↓';
};

const numericSortValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareNumeric = (a, b, key, direction = 'desc') => {
  const valueA = numericSortValue(a?.[key]);
  const valueB = numericSortValue(b?.[key]);
  if (valueA === null && valueB === null) return 0;
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  const multiplier = direction === 'asc' ? 1 : -1;
  return multiplier * (valueA - valueB);
};

const profitSortValue = (stock, key) => {
  if (key === 'profitScore') return profitScoreValue(stock);
  return numericSortValue(stock?.profitMetrics?.[key]);
};

function sortedProfitRows(board) {
  return boardProfitRank(board).sort((a, b) => {
    const valueA = profitSortValue(a, state.profitSort.key);
    const valueB = profitSortValue(b, state.profitSort.key);
    if (valueA === null && valueB === null) return 0;
    if (valueA === null) return 1;
    if (valueB === null) return -1;
    const multiplier = state.profitSort.direction === 'asc' ? 1 : -1;
    return multiplier * (valueA - valueB)
      || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  });
}

function boardProfitRank(board) {
  const rows = Array.isArray(board?.profitRank) && board.profitRank.length ? board.profitRank : (board?.stocks || []);
  return [...rows].sort((a, b) => {
    const scoreA = profitScoreValue(a);
    const scoreB = profitScoreValue(b);
    if (scoreA === null && scoreB === null) return sortChangeValue(b.latestChangePercent) - sortChangeValue(a.latestChangePercent);
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  });
}

const boolText = (value) => (value === true ? '是' : (value === false ? '否' : '暂无'));

const highStatusTone = (status) => {
  if (status === '百日新高') return 'strong';
  if (status === '近高位') return 'hot';
  if (status === '高位震荡') return 'test';
  if (status === '距离较远') return 'weak';
  return 'watch';
};

const stockTurnover = (stock) => {
  const value = stock?.turnover ?? stock?.amount;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const rowTotalTurnover = (row) => {
  const value = row?.totalTurnover ?? row?.totalAmount;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const rowMainNetInflow = (row) => {
  const value = row?.mainNetInflow;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sidebarBoardFundFlow = (board, date) => {
  const row = (board?.trend || []).find((item) => item.date === date);
  if (row?.fundFlowSource !== 'eastmoney_stock_individual_fund_flow') {
    return { label: '资金暂无', tone: 'missing' };
  }
  const value = rowMainNetInflow(row);
  if (value === null) return { label: '资金暂无', tone: 'missing' };
  const direction = value < 0 ? '主力净流出' : '主力净流入';
  const prefix = value > 0 ? '+' : '';
  return {
    label: `${direction} ${prefix}${amountText(value)}`,
    tone: value < 0 ? 'outflow' : 'inflow',
  };
};

const stockMainNetInflow = (stock) => {
  const value = stock?.mainNetInflow ?? stock?.latestMainNetInflow;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fundFlowDateText = (date, quoteDate) => {
  if (!date) return '资金暂无';
  const short = shortDate(date);
  return quoteDate && date !== quoteDate ? `资金${short}` : short;
};

const fundFlowSourceText = (row) => {
  if (row?.fundFlowSource === 'eastmoney_stock_individual_fund_flow') return '东方财富口径';
  if (row?.fundFlowSource === 'ths_stock_fund_flow_individual') return '同花顺口径';
  return '资金来源暂无';
};

const todayFundFlowCell = (value) => {
  if (value === null || value === undefined || value === '') return '暂无';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '暂无';
  return `<span class="${signedValueClass(parsed)}">${amountText(parsed)}</span>`;
};

const fundFlowCoverageText = (row) => {
  const count = Number(row?.fundFlowStockCount);
  const total = Array.isArray(row?.stocks) ? row.stocks.length : Number(row?.stockCount);
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return '覆盖暂无';
  const warning = count / total < 0.8 ? '，覆盖不足' : '';
  return `覆盖 ${count}/${total}${warning}`;
};

async function fetchJsonNoStore(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}

async function fetchJsonCached(path) {
  const response = await fetch(path, { cache: 'default' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}

function mergeRowsByDate(existing = [], additions = []) {
  const rows = new Map();
  existing.filter((row) => row?.date).forEach((row) => rows.set(String(row.date), row));
  additions.filter((row) => row?.date).forEach((row) => rows.set(String(row.date), row));
  return [...rows.keys()].sort().map((date) => rows.get(date));
}

function hydrateCustomBoardHistory(payload, histories) {
  for (const history of [...histories].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))) {
    ['marketIndex', 'secondaryMarketIndex'].forEach((key) => {
      if (!payload[key] && !history?.[key]) return;
      payload[key] = payload[key] || {};
      payload[key].trend = mergeRowsByDate(payload[key].trend || [], history?.[key]?.trend || []);
    });
    const historyBoards = new Map((history?.boards || []).map((board) => [String(board.code), board]));
    (payload.boards || []).forEach((board) => {
      const historyBoard = historyBoards.get(String(board.code));
      if (!historyBoard) return;
      board.trend = mergeRowsByDate(board.trend || [], historyBoard.trend || []);
      board.boardNewHighTrend = mergeRowsByDate(board.boardNewHighTrend || [], historyBoard.boardNewHighTrend || []);
    });
  }
  return payload;
}

async function loadCustomBoardData(daysOverride = null) {
  const payload = await fetchJsonNoStore('./data/custom_boards.json');
  if (!payload.historyIndex) return payload;
  const index = await fetchJsonNoStore(payload.historyIndex);
  const days = daysOverride || Number(payload.days) || 15;
  const items = Array.isArray(index.items) ? index.items.slice(0, days) : [];
  const histories = await Promise.all(
    [...items]
      .reverse()
      .filter((item) => item?.path)
      .map((item) => fetchJsonCached(item.path)),
  );
  if (payload.intradayPath) {
    try {
      histories.push(await fetchJsonNoStore(payload.intradayPath));
    } catch (error) {
      // Intraday snapshots are runtime-only; archived history is enough when absent.
    }
  }
  return hydrateCustomBoardHistory(payload, histories);
}

async function loadAdditionalCustomBoardHistory(payload, loadedDays) {
  if (!payload?.historyIndex) return payload;
  const index = await fetchJsonNoStore(payload.historyIndex);
  const days = Number(payload.days) || 15;
  const items = Array.isArray(index.items) ? index.items.slice(loadedDays, days) : [];
  if (!items.length) return payload;
  const histories = await Promise.all(
    [...items]
      .reverse()
      .filter((item) => item?.path)
      .map((item) => fetchJsonCached(item.path)),
  );
  return hydrateCustomBoardHistory(payload, histories);
}

const compactDateKey = (date) => String(date || '').replaceAll('-', '');

async function loadFullATurnoverData(date = null) {
  const dateKey = compactDateKey(date);
  const cacheKey = dateKey || 'latest';
  if (state.fullATurnoverCache.has(cacheKey)) return state.fullATurnoverCache.get(cacheKey);
  const latestPath = './data/full_a_turnover_top20.json';
  try {
    const path = dateKey
      ? `./data/full_a_turnover_top20_history/${dateKey}.json`
      : latestPath;
    const payload = await fetchJsonNoStore(path);
    state.fullATurnoverCache.set(cacheKey, payload);
    return payload;
  } catch (error) {
    if (dateKey) {
      try {
        const fallback = await fetchJsonNoStore(latestPath);
        const payload = {
          ...fallback,
          requestedDate: date,
          isFallback: true,
        };
        state.fullATurnoverCache.set(cacheKey, payload);
        return payload;
      } catch (fallbackError) {
        error = fallbackError;
      }
    }
    const payload = {
      date: date || null,
      stocks: [],
      error: error.message,
    };
    state.fullATurnoverCache.set(cacheKey, payload);
    return payload;
  }
}

async function syncFullATurnoverForDate(date) {
  state.fullATurnover = await loadFullATurnoverData(date);
}

async function loadCybTrendStats() {
  if (state.cybTrendStats) return state.cybTrendStats;
  try {
    const payload = await fetchJsonNoStore('./data/cyb_trend_stats.json');
    state.cybTrendStats = payload;
    return payload;
  } catch (error) {
    state.cybTrendStats = { index: '创业板指', code: 'sz399006', days: [], error: error.message };
    return state.cybTrendStats;
  }
}

async function setSortDate(date, options = {}) {
  if (!date) return;
  state.sortDate = date;
  if (options.detailTab) state.detailTab = options.detailTab;
  selectTopBoard();
  if (state.detailTab === 'full-a-turnover') {
    await syncFullATurnoverForDate(state.sortDate);
  }
  render();
}

function scheduleBackgroundTask(callback) {
  setTimeout(() => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout: 1500 });
      return;
    }
    callback();
  }, 1200);
}

async function loadLabels(today) {
  try {
    const labelResponse = await fetch(`./data/custom_board_labels.json?v=${Date.now()}`, { cache: 'no-store' });
    const labelPayload = await labelResponse.json();
    const rawLabels = Array.isArray(labelPayload.labels) ? labelPayload.labels : [];
    return rawLabels.map((item) => {
      if (item?.date === today && item?.label === '强2') {
        return { ...item, label: '强1' };
      }
      return item;
    });
  } catch {
    return [];
  }
}

async function loadMembership() {
  try {
    const membershipResponse = await fetch(`./data/custom_board_membership.json?v=${Date.now()}`, { cache: 'no-store' });
    return membershipResponse.ok ? await membershipResponse.json() : { overrides: [] };
  } catch {
    return { overrides: [] };
  }
}

function volumePriceState(change, currentTurnover, previousTurnover) {
  const parsedChange = Number(change);
  const current = Number(currentTurnover);
  const previous = Number(previousTurnover);
  if (Number.isNaN(parsedChange) || Number.isNaN(current) || Number.isNaN(previous) || previous <= 0) {
    return null;
  }
  const priceDirection = parsedChange >= 0 ? 'rise' : 'fall';
  const amountDirection = current >= previous ? 'expand' : 'contract';
  const labels = {
    rise_expand: '放量上涨',
    rise_contract: '缩量上涨',
    fall_expand: '放量下跌',
    fall_contract: '缩量下跌',
  };
  return {
    label: labels[`${priceDirection}_${amountDirection}`],
    priceDirection,
    amountDirection,
  };
}

function marketIndexTrend() {
  return state.data?.marketIndex?.trend || [];
}

function marketIndexRowByDate(date) {
  if (!date) return marketIndexTrend().at(-1) || null;
  return marketIndexTrend().find((item) => item.date === date) || null;
}

function boardVolumePriceState(board, date) {
  const row = date ? trendSnapshotByDate(board, date) : trendValues(board).at(-1);
  if (!row) return null;
  const previous = row?.date ? trendRowAt(board, row.date, -1) : null;
  return volumePriceState(rowDisplayAverageChange(board, row), rowTotalTurnover(row), rowTotalTurnover(previous));
}

function marketVolumePriceState(date) {
  const row = marketIndexRowByDate(date);
  if (!row) return null;
  if (row.label && row.priceDirection && row.amountDirection) return row;
  const trend = marketIndexTrend();
  const index = trend.findIndex((item) => item.date === row.date);
  const previous = index > 0 ? trend[index - 1] : null;
  return volumePriceState(row.changePercent, row.volume, previous?.volume);
}

function boardMarketResonance(board, date) {
  const boardState = boardVolumePriceState(board, date);
  const marketState = marketVolumePriceState(date);
  if (!boardState || !marketState) return null;
  if (boardState.priceDirection === marketState.priceDirection && boardState.amountDirection === marketState.amountDirection) {
    return { label: '共振', tone: 'resonance', detail: `${boardState.label} / ${marketState.label}` };
  }
  if (boardState.priceDirection === marketState.priceDirection) {
    return { label: '同向不同量', tone: 'mixed', detail: `${boardState.label} / ${marketState.label}` };
  }
  if (boardState.amountDirection === marketState.amountDirection) {
    return { label: '反向同量', tone: 'mixed', detail: `${boardState.label} / ${marketState.label}` };
  }
  return { label: '背离', tone: 'divergence', detail: `${boardState.label} / ${marketState.label}` };
}

function indexResonanceTone(label) {
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

function indexResonanceConclusion(label) {
  if (label === '强共振') return '指数放量支持，板块主动跑赢，接近主线确认节点。';
  if (label === '弱共振') return '指数和板块同向修复，仍要看后续超额能否延续。';
  if (label === '逆势强') return '板块先于指数走强，可作为主线候选观察。';
  if (label === '被动跟随') return '板块跟随指数上涨，但主动性不足。';
  if (label === '负背离') return '指数修复时板块没有跟随，资金认可度不足。';
  if (label === '共振杀跌') return '指数和板块同步走弱，短线风险偏高。';
  return '板块与指数之间没有形成清晰共振。';
}

function buildIndexResonanceItem(board, row) {
  if (!board || !row?.date) return null;
  const indexRow = marketIndexRowByDate(row.date);
  const boardPct = Number(rowDisplayAverageChange(board, row));
  const indexPct = Number(indexRow?.changePercent);
  if (Number.isNaN(boardPct) || Number.isNaN(indexPct)) return null;

  const boardState = boardVolumePriceState(board, row.date);
  const marketState = marketVolumePriceState(row.date);
  const redRate = rowRedRate(row);
  const excessPct = boardPct - indexPct;
  const indexVolumeExpanded = marketState?.amountDirection === 'expand';
  const directionScore = indexPct >= 0 && boardPct >= 0 ? 25 : (indexPct < 0 && boardPct >= 0 ? 16 : 0);
  const excessScore = excessPct >= 2 ? 30 : (excessPct >= 1 ? 22 : (excessPct >= 0 ? 12 : 0));
  const indexEnvScore = indexPct >= 1 ? 15 : (indexPct >= 0.3 ? 11 : (indexPct >= 0 ? 7 : 0));
  const volumeScore = indexVolumeExpanded && indexPct >= 0 && boardPct >= 0 ? 20 : (indexVolumeExpanded ? 8 : 0);
  const diffusionScore = redRate === null ? 0 : (redRate >= 75 ? 10 : (redRate >= 60 ? 7 : (redRate >= 50 ? 4 : 0)));
  const score = directionScore + excessScore + indexEnvScore + volumeScore + diffusionScore;
  let label = '无明显共振';
  if (indexPct >= 0 && boardPct >= 0 && excessPct >= 1 && indexVolumeExpanded && score >= 70) label = '强共振';
  else if (indexPct >= 0 && boardPct >= 0 && excessPct >= 0) label = '弱共振';
  else if (indexPct < 0 && boardPct > 0 && excessPct >= 1) label = '逆势强';
  else if (indexPct >= 0 && boardPct >= 0 && excessPct < 0) label = '被动跟随';
  else if (indexPct >= 0 && boardPct < 0) label = '负背离';
  else if (indexPct < 0 && boardPct < 0) label = '共振杀跌';

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
    boardState,
    marketState,
    label,
    tone: indexResonanceTone(label),
    conclusion: indexResonanceConclusion(label),
  };
}

function indexResonanceSeries(board) {
  return trendValues(board).map((row) => buildIndexResonanceItem(board, row)).filter(Boolean);
}

function recentIndexResonance(board, date, windowSize = 5) {
  const series = indexResonanceSeries(board);
  const currentIndex = series.findIndex((item) => item.date === date);
  const endIndex = currentIndex >= 0 ? currentIndex + 1 : series.length;
  const rows = series.slice(Math.max(0, endIndex - windowSize), endIndex);
  if (!rows.length) {
    return {
      label: '暂无',
      tone: 'watch',
      detail: `近${windowSize}日缺少共振数据`,
      rows,
      confirmed: false,
      avgExcess: null,
      best: null,
      lastConfirmed: null,
    };
  }
  const confirmedRows = rows.filter((item) =>
    item.indexVolumeExpanded
    && item.indexPct >= 0
    && item.boardPct >= 0
    && item.excessPct >= 0.8
    && item.score >= 65
  );
  const avgExcess = rows.reduce((sum, item) => sum + item.excessPct, 0) / rows.length;
  const best = rows.reduce((winner, item) => (!winner || item.score > winner.score ? item : winner), null);
  const lastConfirmed = confirmedRows.at(-1) || null;
  const weakRows = rows.filter((item) => item.excessPct < 0 || item.boardPct < 0);
  let label = '待确认';
  let tone = 'watch';
  if (lastConfirmed && avgExcess >= 0) {
    label = '已确认';
    tone = 'resonance';
  } else if (weakRows.length >= 3 && avgExcess < 0) {
    label = '确认不足';
    tone = 'divergence';
  } else if (best?.label === '逆势强' && avgExcess >= 0) {
    label = '候选观察';
    tone = 'mixed';
  }
  const detail = lastConfirmed
    ? `近${windowSize}日 ${shortDate(lastConfirmed.date)} 出现放量共振，窗口超额 ${percentText(avgExcess)}`
    : `近${windowSize}日暂无放量共振，窗口超额 ${percentText(avgExcess)}`;
  return {
    label,
    tone,
    detail,
    rows,
    confirmed: Boolean(lastConfirmed && avgExcess >= 0),
    avgExcess,
    best,
    lastConfirmed,
  };
}

function classifyMainline(board, date, dailyLabel, todayStats) {
  const recent = recentIndexResonance(board, date, 5);
  const metric = dailyLabel?.metric;
  const strength = metric?.strength_score ?? 0;
  const todayChange = Number(todayStats?.averageChange);
  const avgExcess = recent.avgExcess ?? 0;
  const rawLabel = dailyLabel?.label || '弱势';
  const hasHeat = strength >= 65 || rawLabel === '强' || (!Number.isNaN(todayChange) && todayChange >= 2);
  const keepsExcess = avgExcess >= 0.3 || recent.rows.slice(-3).some((item) => item.excessPct >= 1);
  const softPullback = (rawLabel === '弱分歧' || rawLabel === '强分歧')
    && recent.confirmed
    && avgExcess >= 0
    && (Number.isNaN(todayChange) || todayChange >= -2);
  if ((rawLabel === '弱势' && avgExcess < 0) || recent.rows.slice(-3).filter((item) => item.excessPct < 0).length >= 3) {
    return { label: '风险/退潮', tone: 'weak', detail: '短线走弱且窗口超额不足', recent };
  }
  if (softPullback) {
    return { label: '良性回踩', tone: 'test', detail: '近5日有确认，当前分歧但超额未破坏', recent };
  }
  if (hasHeat && keepsExcess && recent.confirmed) {
    return { label: '主线确认', tone: 'strong', detail: '板块强度和窗口放量共振同时满足', recent };
  }
  if (hasHeat && keepsExcess) {
    return { label: '主线候选', tone: 'turn', detail: '板块强度够，等待指数放量共振确认', recent };
  }
  return { label: '观察', tone: 'watch', detail: '强度或超额暂未达到主线标准', recent };
}

async function detectEditingApi() {
  try {
    const response = await fetch('/api/custom-boards/status', { cache: 'no-store' });
    if (!response.ok) {
      state.editable = false;
      return;
    }
    const payload = await response.json();
    state.editable = Boolean(payload.editable);
  } catch {
    state.editable = false;
  }
}

async function updateStock(action, boardCode, code, name = '') {
  state.busy = true;
  state.message = action === 'add' ? '正在加入个股并刷新数据...' : '正在删除个股并刷新数据...';
  render();
  try {
    const response = await fetch('/api/custom-boards/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, boardCode, code, name }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '更新失败');
    }
    state.data = payload.data;
    state.selectedCode = boardCode;
    state.message = action === 'add' ? '已加入并刷新。' : '已删除并刷新。';
  } catch (error) {
    state.message = `更新失败：${error.message}`;
  } finally {
    state.busy = false;
    render();
  }
}

function sortedBoards() {
  return [...(state.data?.boards || [])].sort(
    (a, b) => {
      if (state.sortMode === 'pattern') {
        const patternDiff = setupScore(b, state.sortDate) - setupScore(a, state.sortDate);
        if (patternDiff !== 0) return patternDiff;
      } else if (state.sortMode === 'limit_up') {
        const limitDiff = limitUpCountByDate(b, state.sortDate) - limitUpCountByDate(a, state.sortDate);
        if (limitDiff !== 0) return limitDiff;
      } else {
        const avgDiff = sortChangeValue(averageChangeByDate(b, state.sortDate)) - sortChangeValue(averageChangeByDate(a, state.sortDate));
        if (avgDiff !== 0) return avgDiff;
      }
      return sortChangeValue(averageChangeByDate(b, state.sortDate)) - sortChangeValue(averageChangeByDate(a, state.sortDate));
    },
  );
}

function activeBoard() {
  const boards = sortedBoards();
  return boards.find((board) => board.code === state.selectedCode) || boards[0];
}

function selectTopBoard() {
  state.selectedCode = sortedBoards()[0]?.code || null;
}

function trendValues(board) {
  return (board?.trend || []).filter((item) => item.averageChange !== null && item.averageChange !== undefined);
}

function limitUpThresholdByCode(code) {
  const normalized = String(code || '');
  if (normalized.startsWith('300') || normalized.startsWith('301') || normalized.startsWith('688')) return 20;
  if (normalized.startsWith('8') || normalized.startsWith('4')) return 30;
  return 10;
}

function isLimitUp(stock) {
  const change = Number(stock?.changePercent);
  if (Number.isNaN(change)) return false;
  const threshold = limitUpThresholdByCode(stock?.code);
  return change >= threshold - 0.05;
}

function latestLimitUpCount(board) {
  return (board?.stocks || []).filter((stock) =>
    isLimitUp({ code: stock.code, changePercent: stock.latestChangePercent })).length;
}

function availableTrendDates() {
  const dateSet = new Set();
  for (const board of state.data?.boards || []) {
    for (const row of board?.trend || []) {
      if (row?.date) dateSet.add(row.date);
    }
  }
  return [...dateSet].sort((a, b) => String(b).localeCompare(String(a)));
}

function trendDatesAsc() {
  return [...availableTrendDates()].sort((a, b) => String(a).localeCompare(String(b)));
}

function limitUpCountByDate(board, date) {
  if (!date) return latestLimitUpCount(board);
  const row = (board?.trend || []).find((item) => item.date === date);
  if (!row) return 0;
  return (row.stocks || []).filter(isLimitUp).length;
}

function averageChangeByDate(board, date) {
  const row = date
    ? (board?.trend || []).find((item) => item.date === date)
    : trendValues(board).at(-1);
  return rowDisplayAverageChange(board, row);
}

function limitUpSeries(board) {
  const trend = trendValues(board);
  return trend.map((row) => ({
    date: row.date,
    limitUpCount: (row.stocks || []).filter(isLimitUp).length,
  }));
}

function trendIndexByDate(board, date) {
  return trendValues(board).findIndex((item) => item.date === date);
}

function trendRowAt(board, date, offset = 0) {
  const trend = trendValues(board);
  const index = trend.findIndex((item) => item.date === date);
  if (index < 0) return null;
  return trend[index + offset] || null;
}

function rowLimitUpCount(row) {
  return (row?.stocks || []).filter(isLimitUp).length;
}

function rowRedRate(row) {
  const stocks = (row?.stocks || []).filter((stock) => stock.changePercent !== null && stock.changePercent !== undefined);
  if (!stocks.length) return null;
  return stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
}

function rowCoreStocks(row, size = 5) {
  return [...(row?.stocks || [])]
    .filter((stock) => stockTurnover(stock) !== null && stock.changePercent !== null && stock.changePercent !== undefined)
    .sort((a, b) => stockTurnover(b) - stockTurnover(a))
    .slice(0, size);
}

function rowCoreAverage(row) {
  const core = rowCoreStocks(row);
  if (!core.length) return null;
  return core.reduce((sum, stock) => sum + Number(stock.changePercent || 0), 0) / core.length;
}

function pureStockCodesByStatus(board, status) {
  const manualCodes = (state.membership?.overrides || [])
    .filter((item) =>
      String(item.boardCode || '') === String(board?.code || '')
      && item.status === status)
    .map((item) => String(item.stockCode || ''))
    .filter(Boolean);
  if (manualCodes.length) return new Set(manualCodes);

  return new Set(
    (board?.stocks || [])
      .filter((stock) => membershipAssessment(board, stock, state.sortDate).status === status)
      .map((stock) => String(stock.code || ''))
      .filter(Boolean),
  );
}

function pureCoreStockCodes(board) {
  return pureStockCodesByStatus(board, 'pure_core');
}

function pureStockCodes(board) {
  return new Set([
    ...pureStockCodesByStatus(board, 'pure_core'),
    ...pureStockCodesByStatus(board, 'pure_elastic'),
  ]);
}

function displayStockCodes(board) {
  const codes = pureStockCodes(board);
  const boardCodes = new Set(
    (board?.stocks || [])
      .map((stock) => String(stock.code || ''))
      .filter(Boolean),
  );
  const currentPureCodes = new Set([...codes].filter((code) => boardCodes.has(code)));
  if (currentPureCodes.size) return currentPureCodes;
  return boardCodes;
}

function rowPureAverageChange(board, row) {
  if (!row) return null;
  const codes = displayStockCodes(board);
  if (!codes.size) return null;
  const stocks = (row.stocks || []).filter((stock) =>
    codes.has(String(stock.code || ''))
    && Number.isFinite(Number(stock.changePercent)));
  if (!stocks.length) return null;
  return stocks.reduce((sum, stock) => sum + Number(stock.changePercent || 0), 0) / stocks.length;
}

function rowDisplayAverageChange(board, row) {
  return rowPureAverageChange(board, row);
}

function pureCoreSeries(board) {
  const coreCodes = displayStockCodes(board);
  return trendValues(board).map((row) => {
    const stocks = (row.stocks || []).filter((stock) => coreCodes.has(String(stock.code || '')));
    const amountStocks = stocks.filter((stock) => stockTurnover(stock) !== null);
    const changeStocks = stocks.filter((stock) => Number.isFinite(Number(stock.changePercent)));
    const totalAmount = amountStocks.reduce((sum, stock) => sum + stockTurnover(stock), 0);
    const averageChange = changeStocks.length
      ? changeStocks.reduce((sum, stock) => sum + Number(stock.changePercent || 0), 0) / changeStocks.length
      : null;
    return {
      date: row.date,
      stocks,
      count: stocks.length,
      totalAmount,
      averageChange,
    };
  });
}

function pureChangeSeries(board) {
  const codes = displayStockCodes(board);
  return trendValues(board).map((row) => {
    const stocks = (row.stocks || []).filter((stock) => codes.has(String(stock.code || '')));
    const changeStocks = stocks.filter((stock) => Number.isFinite(Number(stock.changePercent)));
    const averageChange = changeStocks.length
      ? changeStocks.reduce((sum, stock) => sum + Number(stock.changePercent || 0), 0) / changeStocks.length
      : null;
    return {
      date: row.date,
      stocks,
      count: stocks.length,
      averageChange,
    };
  });
}

function amountRatio(row, previousRow) {
  const current = rowTotalTurnover(row);
  const previous = rowTotalTurnover(previousRow);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return current / previous;
}

function rowStats(board, row, previousRow = null) {
  if (!row) return null;
  const metric = rowLabelMetrics(board, row, previousRow);
  const orthodoxAverage = rowDisplayAverageChange(board, row);
  return {
    row,
    averageChange: orthodoxAverage,
    limitUpCount: rowLimitUpCount(row),
    redRate: metric?.R_t === null || metric?.R_t === undefined ? rowRedRate(row) : metric.R_t * 100,
    coreAverage: metric?.C_t ?? orthodoxAverage,
    amountRatio: metric?.Q_t ?? amountRatio(row, previousRow),
  };
}

function rowStocksByCodes(row, codes) {
  return (row?.stocks || []).filter((stock) =>
    codes.has(String(stock.code || '')) && Number.isFinite(Number(stock.changePercent)));
}

function rowPureMetricInput(board, row) {
  const pureCodes = displayStockCodes(board);
  const coreCodes = pureCoreStockCodes(board).size ? pureCoreStockCodes(board) : pureCodes;
  const pureStocks = rowStocksByCodes(row, pureCodes);
  const coreStocks = rowStocksByCodes(row, coreCodes);
  const amountStocks = pureStocks.filter((stock) => stockTurnover(stock) !== null);
  const changes = pureStocks.map((stock) => Number(stock.changePercent));
  const coreChanges = coreStocks.map((stock) => Number(stock.changePercent));
  const average = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
  const coreAverage = coreChanges.length ? coreChanges.reduce((sum, value) => sum + value, 0) / coreChanges.length : average;
  const variance = changes.length >= 2
    ? changes.reduce((sum, value) => sum + (value - average) ** 2, 0) / changes.length
    : 0;
  const limitUpCount = pureStocks.filter(isLimitUp).length;
  return {
    pure_stock_count: pureStocks.length,
    core_stock_count: coreStocks.length,
    A_t: average,
    R_t: changes.length ? changes.filter((value) => value > 0).length / changes.length : null,
    L_t: pureStocks.length ? limitUpCount / pureStocks.length : null,
    raw_limit_up_count_t: limitUpCount,
    M_t: amountStocks.reduce((sum, stock) => sum + stockTurnover(stock), 0),
    C_t: coreAverage,
    B_t: average !== null && coreAverage !== null ? average - coreAverage : null,
    D_t: Math.sqrt(variance),
  };
}

function rowLabelMetrics(board, row, previousRow = null) {
  if (!row) return null;
  const current = rowPureMetricInput(board, row);
  const previous = previousRow ? rowPureMetricInput(board, previousRow) : null;
  const q = previous && Number(previous.M_t) > 0 ? current.M_t / previous.M_t : null;
  return { ...current, Q_t: q };
}

function qStrengthScore(q) {
  if (q === null || q === undefined || Number.isNaN(Number(q))) return 70;
  if (q >= 0.9 && q <= 1.4) return 100;
  if ((q >= 0.75 && q < 0.9) || (q > 1.4 && q <= 1.8)) return 70;
  if ((q >= 0.6 && q < 0.75) || (q > 1.8 && q <= 2.2)) return 30;
  return 0;
}

function qAbnormalScore(q) {
  if (q === null || q === undefined || Number.isNaN(Number(q))) return 20;
  if (q >= 0.85 && q <= 1.35) return 0;
  if ((q >= 0.7 && q < 0.85) || (q > 1.35 && q <= 1.7)) return 40;
  if ((q >= 0.55 && q < 0.7) || (q > 1.7 && q <= 2.2)) return 80;
  return 100;
}

function calcStrengthScore(metric) {
  if (!metric || metric.A_t === null || metric.R_t === null || metric.L_t === null || metric.C_t === null) return 0;
  const scoreA = clamp((metric.A_t - (-2)) / (4 - (-2)) * 100, 0, 100);
  const scoreR = clamp((metric.R_t - 0.3) / (0.9 - 0.3) * 100, 0, 100);
  const scoreL = clamp(metric.L_t / 0.2 * 100, 0, 100);
  const scoreC = clamp((metric.C_t - (-2)) / (5 - (-2)) * 100, 0, 100);
  const scoreQ = qStrengthScore(metric.Q_t);
  return 0.35 * scoreA + 0.25 * scoreR + 0.15 * scoreL + 0.15 * scoreC + 0.1 * scoreQ;
}

function calcDivergenceScore(metric, previousMetric = null) {
  if (!metric || metric.D_t === null || metric.B_t === null || metric.R_t === null || metric.L_t === null) return 0;
  const rDrop = Math.max(0, (previousMetric?.R_t ?? metric.R_t) - metric.R_t);
  const lDrop = Math.max(0, (previousMetric?.L_t ?? metric.L_t) - metric.L_t);
  const scoreD = clamp((metric.D_t - 1.5) / (5.5 - 1.5) * 100, 0, 100);
  const scoreB = clamp(Math.max(0, metric.B_t) / 3 * 100, 0, 100);
  const scoreRDrop = clamp(rDrop / 0.5 * 100, 0, 100);
  const scoreLDrop = clamp(lDrop / 0.15 * 100, 0, 100);
  const scoreQ = qAbnormalScore(metric.Q_t);
  return 0.35 * scoreD + 0.25 * scoreB + 0.15 * scoreRDrop + 0.1 * scoreLDrop + 0.15 * scoreQ;
}

function labelTone(label) {
  return {
    强: 'strong',
    弱分歧: 'test',
    强分歧: 'turn',
    弱势: 'weak',
  }[label] || 'watch';
}

function labelPriority(label) {
  return {
    强: 82,
    弱分歧: 70,
    强分歧: 58,
    弱势: 20,
  }[label] || 10;
}

function assignDailyLabel(metric, previousLabel = '') {
  if (!metric || metric.A_t === null || metric.R_t === null) {
    return { label: '弱势', reason: '弱势：缺少有效正宗股数据' };
  }
  const s = metric.strength_score;
  const f = metric.divergence_score;
  const a = metric.A_t;
  const r = metric.R_t;
  const q = metric.Q_t;
  const c = metric.C_t ?? a;
  const b = metric.B_t ?? 0;
  const d = metric.D_t ?? 0;
  const qOk = q === null || q === undefined || Number.isNaN(Number(q)) || (q >= 0.75 && q <= 1.4);
  if (s >= 70 && f < 40 && a >= 2 && r >= 0.67 && b <= 0.8) {
    return { label: '强', reason: '强：平均涨幅高、红盘率高、分歧低' };
  }
  if ((previousLabel === '强' || previousLabel === '弱分歧') && s >= 45 && s < 70 && f >= 40 && f < 65 && a >= 0 && r >= 0.4 && b <= 1 && qOk) {
    return { label: '弱分歧', reason: '弱分歧：前强后分歧，但核心未明显走坏' };
  }
  const strongDivergenceTrigger = b > 1.2 || r < 0.5 || (q !== null && q !== undefined && q > 1.4) || d >= 4;
  if ((previousLabel === '强' || previousLabel === '弱分歧') && s >= 55 && f >= 65 && a >= 0 && strongDivergenceTrigger) {
    return { label: '强分歧', reason: '强分歧：板块表面仍强，但核心弱于整体或分化放大' };
  }
  if (a < 0 && r < 0.4 && (c < 0 || b > 1.5)) {
    return { label: '弱势', reason: '弱势：平均涨幅转负且红盘率过低' };
  }
  if (a >= 1.5 && r >= 0.6) return { label: '强', reason: '强：兜底规则，涨幅与红盘率同步较强' };
  if (a >= 0 && r >= 0.4) return { label: '弱分歧', reason: '弱分歧：兜底规则，仍有承接但强度不足' };
  if (a >= 0) return { label: '强分歧', reason: '强分歧：兜底规则，指数为正但扩散不足' };
  return { label: '弱势', reason: '弱势：兜底规则，正宗股平均涨幅为负' };
}

function riskFlags(metric, previousMetric = null) {
  const flags = [];
  if ((metric?.B_t ?? 0) > 1.2) flags.push('core_weaker_than_group');
  if ((metric?.R_t ?? 1) < 0.4) flags.push('low_red_rate');
  if (metric?.Q_t !== null && metric?.Q_t !== undefined && (metric.Q_t < 0.75 || metric.Q_t > 1.7)) flags.push('abnormal_volume');
  if ((metric?.D_t ?? 0) >= 4) flags.push('high_dispersion');
  if (!previousMetric) flags.push('no_prev_day_data');
  if (previousMetric && previousMetric.L_t - metric.L_t >= 0.15) flags.push('limit_up_drop');
  return flags;
}

function boardLabelSeries(board) {
  const trend = trendValues(board);
  const rows = [];
  let previousLabel = '';
  let previousMetric = null;
  for (let index = 0; index < trend.length; index += 1) {
    const row = trend[index];
    const previousRow = trend[index - 1] || null;
    const metric = rowLabelMetrics(board, row, previousRow);
    if (!metric) continue;
    metric.strength_score = calcStrengthScore(metric);
    metric.divergence_score = calcDivergenceScore(metric, previousMetric);
    const labelInfo = assignDailyLabel(metric, previousLabel);
    let label = labelInfo.label;
    let reason = labelInfo.reason;
    const weakWatchDays = label === '弱分歧'
      ? 1
      : 0;
    const entry = {
      date: row.date,
      row,
      metric,
      prevLabel: previousLabel,
      label: labelInfo.label,
      displayLabel: labelInfo.label,
      reason: labelInfo.reason,
      riskFlags: riskFlags(metric, previousMetric),
      tone: labelTone(labelInfo.label),
      priority: labelPriority(labelInfo.label),
    };
    rows.push(entry);
    previousLabel = labelInfo.label;
    previousMetric = metric;
  }
  return rows;
}

function boardLabelFor(board, date) {
  return boardLabelSeries(board).find((item) => item.date === date) || null;
}

function daysSinceLastStrong(board, date) {
  const labels = boardLabelSeries(board);
  const currentIndex = labels.findIndex((item) => item.date === date);
  if (currentIndex < 0) return null;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (labels[index].label === '强') {
      return {
        days: currentIndex - index,
        date: labels[index].date,
      };
    }
  }
  return null;
}

function boardSetup(board, date) {
  const today = trendRowAt(board, date);
  const d1 = trendRowAt(board, date, -1);
  const d2 = trendRowAt(board, date, -2);
  const todayStats = rowStats(board, today, d1);
  const d1Stats = rowStats(board, d1, d2);
  const d2Stats = rowStats(board, d2, trendRowAt(board, date, -3));
  const dailyLabel = boardLabelFor(board, date);
  const label = dailyLabel?.displayLabel || '弱势';
  const coreRank = rowCoreStocks(today, 5);
  const lastStrong = daysSinceLastStrong(board, date);
  const mainline = classifyMainline(board, date, dailyLabel, todayStats);
  return {
    label,
    rawLabel: dailyLabel?.label || label,
    tone: dailyLabel?.tone || 'watch',
    priority: dailyLabel?.priority || 10,
    today,
    d1,
    d2,
    todayStats,
    d1Stats,
    d2Stats,
    turn2: dailyLabel?.label === '强',
    turn3: dailyLabel?.label === '强分歧',
    divergenceToday: dailyLabel?.label === '弱分歧',
    divergenceD1: boardLabelFor(board, d1?.date)?.label === '弱分歧',
    risk: dailyLabel?.label === '弱势',
    divergenceScore: dailyLabel?.metric?.divergence_score ?? null,
    strengthScore: dailyLabel?.metric?.strength_score ?? null,
    labelReason: dailyLabel?.reason || '',
    riskFlags: dailyLabel?.riskFlags || [],
    dailyLabel,
    lastStrong,
    mainline,
    recentResonance: mainline.recent,
    coreRank,
  };
}

function setupScore(board, date) {
  const setup = boardSetup(board, date);
  const stats = setup.todayStats;
  return setup.priority
    + (stats?.averageChange || 0)
    + ((setup.strengthScore || 0) * 0.05)
    - ((setup.divergenceScore || 0) * 0.02);
}

function setupPools(date) {
  const boards = state.data?.boards || [];
  const enriched = boards.map((board) => ({ board, setup: boardSetup(board, date) }));
  const byScore = (a, b) => setupScore(b.board, date) - setupScore(a.board, date);
  const divergence = enriched
    .filter((item) => item.setup.rawLabel === '弱分歧' || item.setup.rawLabel === '强分歧')
    .sort(byScore);
  return {
    strong: enriched.filter((item) => item.setup.rawLabel === '强').sort(byScore),
    divergence,
    weak: enriched.filter((item) => item.setup.rawLabel === '弱势').sort(byScore),
  };
}

function membershipOverride(board, stock) {
  const overrides = Array.isArray(state.membership?.overrides) ? state.membership.overrides : [];
  return overrides.find((item) =>
    String(item.boardCode || '') === String(board?.code || '')
    && String(item.stockCode || '') === String(stock?.code || ''));
}

function stockBoardNames(stockCode) {
  const names = [];
  for (const board of state.data?.boards || []) {
    if ((board.stocks || []).some((stock) => String(stock.code || '') === String(stockCode || ''))) {
      names.push(board.name);
    }
  }
  return names;
}

function stockRowsInBoard(board, stockCode) {
  return trendValues(board)
    .map((row) => (row.stocks || []).find((stock) => String(stock.code || '') === String(stockCode || '')))
    .filter(Boolean);
}

function stockFollowScore(board, stockCode) {
  const rows = stockRowsInBoard(board, stockCode);
  const boardRows = trendValues(board);
  if (!rows.length || rows.length !== boardRows.length) return null;
  let aligned = 0;
  let weakWhenBoardStrong = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const stockChange = Number(rows[index].changePercent);
    const boardChange = Number(boardRows[index].averageChange);
    if (!Number.isFinite(stockChange) || !Number.isFinite(boardChange)) continue;
    if ((stockChange >= 0 && boardChange >= 0) || (stockChange < 0 && boardChange < 0)) aligned += 1;
    if (boardChange >= 1.5 && stockChange < 0) weakWhenBoardStrong += 1;
  }
  return {
    alignedRate: rows.length ? aligned / rows.length * 100 : null,
    weakWhenBoardStrong,
  };
}

function membershipAssessment(board, stock, date) {
  const override = membershipOverride(board, stock);
  const snapshot = trendSnapshotByDate(board, date);
  const row = (snapshot?.stocks || []).find((item) => String(item.code || '') === String(stock.code || ''));
  const amountRank = [...(snapshot?.stocks || [])]
    .filter((item) => stockTurnover(item) !== null)
    .sort((a, b) => stockTurnover(b) - stockTurnover(a))
    .findIndex((item) => String(item.code || '') === String(stock.code || '')) + 1;
  const changeRank = [...(snapshot?.stocks || [])]
    .filter((item) => Number.isFinite(Number(item.changePercent)))
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .findIndex((item) => String(item.code || '') === String(stock.code || '')) + 1;
  const boards = stockBoardNames(stock.code);
  const follow = stockFollowScore(board, stock.code);

  if (override) {
    return {
      status: override.status || 'manual',
      label: override.label || override.status || '手工',
      tone: override.status || 'manual',
      reason: override.note || '来自手工标注',
      boards,
    };
  }
  if (amountRank > 0 && amountRank <= 5) {
    return {
      status: 'core',
      label: '容量核心',
      tone: 'core',
      reason: `成交额第 ${amountRank}，短线看板优先跟踪`,
      boards,
    };
  }
  if (changeRank > 0 && changeRank <= 3 && Number(row?.changePercent) > 0) {
    return {
      status: 'active',
      label: '弹性前排',
      tone: 'active',
      reason: `涨幅第 ${changeRank}，适合观察是否成为补涨/先锋`,
      boards,
    };
  }
  if (boards.length >= 3) {
    return {
      status: 'overlap',
      label: '多题材',
      tone: 'overlap',
      reason: `同时在 ${boards.slice(0, 3).join('、')}${boards.length > 3 ? '等' : ''}`,
      boards,
    };
  }
  if (follow && follow.alignedRate !== null && follow.alignedRate < 42 && follow.weakWhenBoardStrong >= 2) {
    return {
      status: 'suspect',
      label: '存疑',
      tone: 'suspect',
      reason: `跟随率 ${number(follow.alignedRate, 0)}%，板块强时逆势 ${follow.weakWhenBoardStrong} 次`,
      boards,
    };
  }
  return {
    status: 'pending',
    label: '待确认',
    tone: 'pending',
    reason: follow?.alignedRate === null ? '缺少足够走势验证' : `跟随率 ${number(follow.alignedRate, 0)}%`,
    boards,
  };
}

function membershipSummary(board, date) {
  const stats = {
    pure_core: 0,
    pure_elastic: 0,
    supply_chain: 0,
    theme_edge: 0,
    suspect: 0,
    pending: 0,
    core: 0,
    active: 0,
    overlap: 0,
    manual: 0,
  };
  const assessments = (board?.stocks || []).map((stock) => ({
    stock,
    assessment: membershipAssessment(board, stock, date),
  }));
  for (const item of assessments) {
    stats[item.assessment.status] = (stats[item.assessment.status] || 0) + 1;
  }
  return { stats, assessments };
}

function stockSnapshotByDate(board, date) {
  const row = (board?.trend || []).find((item) => item.date === date);
  if (!row) return new Map();
  return new Map((row.stocks || []).map((item) => [String(item.code || ''), item]));
}

function trendSnapshotByDate(board, date) {
  if (!date) return null;
  return (board?.trend || []).find((item) => item.date === date) || null;
}

function newHighTrendRows(board) {
  const rows = Array.isArray(board?.boardNewHighTrend) && board.boardNewHighTrend.length
    ? board.boardNewHighTrend
    : (board?.trend || []);
  return rows.filter((item) => item?.date && item.high100Rate !== null && item.high100Rate !== undefined);
}

function newHighRowByDate(board, date) {
  if (!date) return newHighTrendRows(board).at(-1) || null;
  return newHighTrendRows(board).find((item) => item.date === date) || null;
}

function diffusionLabel(row) {
  const highRate = Number(row?.high100Rate);
  const nearRate = Number(row?.nearHigh100Rate);
  if (Number.isNaN(highRate) || Number.isNaN(nearRate)) return { label: '暂无', tone: 'watch' };
  if (highRate >= 25 || nearRate >= 60) return { label: '强', tone: 'strong' };
  if (highRate >= 10 || nearRate >= 40) return { label: '中', tone: 'test' };
  return { label: '弱', tone: 'weak' };
}

function diffusionTrendLabel(today, yesterday) {
  if (!today || !yesterday) return { label: '暂无', tone: 'watch' };
  const highToday = Number(today.high100Rate);
  const highYesterday = Number(yesterday.high100Rate);
  const nearToday = Number(today.nearHigh100Rate);
  const nearYesterday = Number(yesterday.nearHigh100Rate);
  if ([highToday, highYesterday, nearToday, nearYesterday].some((value) => Number.isNaN(value))) {
    return { label: '暂无', tone: 'watch' };
  }
  if (highToday > highYesterday) return { label: '扩散增强', tone: 'strong' };
  if (highToday < highYesterday) return { label: '扩散减弱', tone: 'weak' };
  if (nearToday >= nearYesterday) return { label: '高位维持', tone: 'test' };
  return { label: '扩散减弱', tone: 'weak' };
}

function boardHasDateSnapshot(board, date) {
  if (!date) return false;
  return (board?.trend || []).some((item) => item.date === date);
}

function labelFor(board, date) {
  if (!board || !date) return null;
  return state.labels.find((item) =>
    item.date === date && (
      item.boardCode === board.code
      || item.boardName === board.name
    ));
}

function chartTrendRows(board) {
  return trendValues(board)
    .map((item) => {
      const indexRow = marketIndexRowByDate(item.date);
      return {
        ...item,
        displayAverageChange: rowDisplayAverageChange(board, item),
        indexChange: indexRow?.changePercent ?? null,
      };
    })
    .filter((item) =>
      item.displayAverageChange !== null
      && item.displayAverageChange !== undefined
    );
}

const chartPointX = (index, length, width, pad) => pad.left + (length === 1 ? (width - pad.left - pad.right) / 2 : (index / (length - 1)) * (width - pad.left - pad.right));

function renderTrendChart(board) {
  const trend = chartTrendRows(board);
  if (!trend.length) {
    return `
      <div>
        <strong>暂无走势</strong>
        <p>这个板块最近没有可用行情数据。</p>
      </div>
    `;
  }

  const width = 760;
  const height = 240;
  const pad = { top: 30, right: 48, bottom: 46, left: 52 };
  const avgValues = trend.map((item) => Number(item.displayAverageChange));
  const rawMax = Math.max(...avgValues, 1);
  const rawMin = Math.min(...avgValues, -1);
  const valuePadding = Math.max(0.35, (rawMax - rawMin) * 0.14);
  const valueMax = rawMax + valuePadding;
  const valueMin = rawMin - valuePadding;
  const valueRange = valueMax - valueMin || 1;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const points = trend.map((item, index) => {
    const change = Number(item.displayAverageChange) || 0;
    const x = chartPointX(index, trend.length, width, pad);
    const yAvg = pad.top + ((valueMax - change) / valueRange) * plotHeight;
    return {
      ...item,
      change,
      selected: item.date === state.sortDate,
      x,
      yAvg,
      yAvgLabel: yAvg - 10,
    };
  });
  const avgLine = points.map((point) => `${point.x},${point.yAvg}`).join(' ');
  const zeroY = pad.top + ((valueMax - 0) / valueRange) * plotHeight;
  const axisBottom = height - pad.bottom;

  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 近15日平均涨跌幅走势">
      ${points.filter((point) => point.selected).map((point) => `
        <rect class="selected-date-band" x="${point.x - 18}" y="${pad.top - 12}" width="36" height="${plotHeight + 24}" rx="8"></rect>
      `).join('')}
      <line class="zero-line" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <text x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end" class="axis-label">${number(valueMax)}%</text>
      <text x="${pad.left - 10}" y="${zeroY + 4}" text-anchor="end" class="axis-label">0%</text>
      <text x="${pad.left - 10}" y="${axisBottom + 4}" text-anchor="end" class="axis-label">${number(valueMin)}%</text>
      <polyline points="${avgLine}" style="fill:none;stroke:#0b7893;stroke-linecap:round;stroke-width:3;"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.yAvg}" r="${point.selected ? 6.2 : 4.5}" style="fill:#fff;stroke:#0b7893;stroke-width:${point.selected ? 3 : 2.2};"></circle>
          <text x="${point.x}" y="${point.yAvgLabel}" text-anchor="middle" class="value-label">${number(point.change)}%</text>
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} 板块平均涨跌幅 ${number(point.change)}% | 有效股票 ${point.stockCount}</title>
        </g>
      `).join('')}
    </svg>
  `;
}

const fundFlowBarLabelY = (value, pointY, padTop, axisBottom) => value >= 0
  ? Math.max(padTop + 11, pointY - 8)
  : Math.min(axisBottom - 3, pointY + 15);

function renderFundFlowTrendChart(board) {
  const rows = chartTrendRows(board)
    .map((item) => ({ ...item, value: rowMainNetInflow(item) }));
  const validValues = rows.map((item) => item.value).filter((value) => value !== null);
  if (!validValues.length) {
    return `
      <div>
        <strong>暂无资金净流入数据</strong>
        <p>这个板块最近没有可用的每日资金净流入数据。</p>
      </div>
    `;
  }

  const width = 760;
  const height = 240;
  const pad = { top: 34, right: 48, bottom: 46, left: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const axisBottom = height - pad.bottom;
  const maxAbs = Math.max(...validValues.map((value) => Math.abs(value)), 1);
  const valueLimit = maxAbs * 1.16;
  const zeroY = pad.top + plotHeight / 2;
  const barWidth = Math.max(8, Math.min(28, plotWidth / Math.max(rows.length, 1) * 0.56));
  const points = rows.map((item, index) => {
    const x = chartPointX(index, rows.length, width, pad);
    const y = item.value === null ? null : zeroY - (item.value / valueLimit) * (plotHeight / 2);
    return { ...item, x, y, selected: item.date === state.sortDate };
  });

  return `
    <svg class="fund-flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 每日资金净流入走势">
      ${points.filter((point) => point.selected).map((point) => `
        <rect class="selected-date-band" x="${point.x - 18}" y="${pad.top - 12}" width="36" height="${plotHeight + 24}" rx="8"></rect>
      `).join('')}
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <text x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end" class="axis-label">${signedFundFlowText(valueLimit)}</text>
      <text x="${pad.left - 10}" y="${zeroY + 4}" text-anchor="end" class="axis-label">0</text>
      <text x="${pad.left - 10}" y="${axisBottom + 4}" text-anchor="end" class="axis-label">${signedFundFlowText(-valueLimit)}</text>
      ${points.map((point) => `
        <g>
          ${point.value === null ? '' : `
            <rect class="fund-flow-bar ${point.value >= 0 ? 'inflow' : 'outflow'}${point.selected ? ' selected' : ''}" x="${point.x - barWidth / 2}" y="${Math.min(point.y, zeroY)}" width="${barWidth}" height="${Math.max(1, Math.abs(zeroY - point.y))}" rx="3"></rect>
            <text x="${point.x}" y="${fundFlowBarLabelY(point.value, point.y, pad.top, axisBottom)}" text-anchor="middle" class="fund-flow-value ${point.value >= 0 ? 'inflow' : 'outflow'}">${signedFundFlowText(point.value)}</text>
            <title>${point.date} | 资金净流入 ${signedFundFlowText(point.value)} | ${fundFlowSourceText(point)} | ${fundFlowCoverageText(point)}</title>
          `}
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
        </g>
      `).join('')}
    </svg>
  `;
}

function pureCoreChartScaffold(board) {
  const series = pureCoreSeries(board);
  const usable = series.filter((item) => item.count && item.averageChange !== null);
  if (!usable.length) {
    return null;
  }

  const width = 760;
  const height = 230;
  const pad = { top: 34, right: 58, bottom: 44, left: 58 };
  const plotWidth = width - pad.left - pad.right;
  const axisBottom = height - pad.bottom;
  const plotHeight = axisBottom - pad.top;
  const changes = usable.map((item) => Number(item.averageChange));
  const amounts = usable.map((item) => Number(item.totalAmount) || 0);
  const rawChangeMax = Math.max(...changes, 1);
  const rawChangeMin = Math.min(...changes, -1);
  const changePadding = Math.max(0.8, (rawChangeMax - rawChangeMin) * 0.16);
  const changeMax = rawChangeMax + changePadding;
  const changeMin = rawChangeMin - changePadding;
  const changeRange = changeMax - changeMin || 1;
  const amountMax = Math.max(...amounts, 1);
  const zeroY = pad.top + ((changeMax - 0) / changeRange) * plotHeight;
  const points = series.map((item, index) => {
    const change = item.averageChange === null ? null : Number(item.averageChange);
    const amount = Number(item.totalAmount) || 0;
    const x = pad.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
    const yChange = change === null ? null : pad.top + ((changeMax - change) / changeRange) * plotHeight;
    const barHeight = amount ? Math.max(3, (amount / amountMax) * plotHeight) : 0;
    const yAmount = axisBottom - barHeight;
    return {
      ...item,
      change,
      amount,
      x,
      yChange,
      yAmount,
      barHeight,
      selected: item.date === state.sortDate,
    };
  });
  return {
    width,
    height,
    pad,
    points,
    axisBottom,
    plotHeight,
    changeMax,
    changeMin,
    amountMax,
    zeroY,
  };
}

function renderPureCoreAmountChart(board) {
  const chart = pureCoreChartScaffold(board);
  if (!chart) {
    return `
      <div>
        <strong>暂无正宗核心成交额</strong>
        <p>这个板块还没有标注正宗核心，或核心股缺少可用行情数据。</p>
      </div>
    `;
  }
  const { width, height, pad, points, axisBottom, amountMax } = chart;
  const step = points.length === 1 ? (width - pad.left - pad.right) : (width - pad.left - pad.right) / (points.length - 1);
  const barWidth = Math.max(12, Math.min(30, step * 0.52));

  return `
    <svg class="core-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 正宗核心成交额走势">
      ${points.filter((point) => point.selected).map((point) => `
        <rect class="selected-date-band" x="${point.x - 18}" y="${pad.top - 12}" width="36" height="${chart.plotHeight + 24}" rx="8"></rect>
      `).join('')}
      <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${axisBottom}"></line>
      <line class="chart-axis" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <text x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end" class="axis-label">${amountText(amountMax)}</text>
      <text x="${pad.left - 10}" y="${axisBottom + 4}" text-anchor="end" class="axis-label">0</text>
      ${points.map((point, index) => {
        const labelLevel = index % 2;
        const amountLabelY = Math.max(pad.top + 12, point.yAmount - 7 - labelLevel * 12);
        const tone = Number(point.change) >= 0 ? 'rise' : 'fall';
        return `
          <g>
            ${point.barHeight ? `<rect class="core-amount-bar ${tone}" x="${point.x - barWidth / 2}" y="${point.yAmount}" width="${barWidth}" height="${point.barHeight}" rx="4"></rect>` : ''}
            <text x="${point.x}" y="${amountLabelY}" text-anchor="middle" class="core-amount-label ${tone}">${amountText(point.amount)}</text>
            <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
            <title>${point.date} | 正宗核心 ${point.count} 只 | 成交额 ${amountText(point.amount)} | 平均涨跌幅 ${point.change === null ? '暂无' : `${number(point.change)}%`} | ${point.stocks.map((stock) => stock.name).join('、')}</title>
          </g>
        `;
      }).join('')}
    </svg>
  `;
}

function renderAmountBarChart(board) {
  const trend = trendValues(board);
  if (!trend.length) {
    return `
      <div>
        <strong>暂无成交额</strong>
        <p>这个板块最近没有可用成交额数据。</p>
      </div>
    `;
  }

  const width = 760;
  const height = 220;
  const pad = { top: 30, right: 34, bottom: 44, left: 64 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const amounts = trend.map((item) => rowTotalTurnover(item) || 0);
  const maxAmount = Math.max(...amounts, 1);
  const step = trend.length === 1 ? plotWidth : plotWidth / (trend.length - 1);
  const barWidth = Math.max(12, Math.min(28, step * 0.52));
  const axisBottom = height - pad.bottom;
  const yMaxLabel = amountText(maxAmount);
  const points = trend.map((item, index) => {
    const totalAmount = rowTotalTurnover(item) || 0;
    const amountStockCount = Number(item.turnoverStockCount ?? item.amountStockCount) || 0;
    const missing = Math.max(0, Number(board.stockCount || 0) - amountStockCount);
    const averageChange = Number(item.averageChange);
    const x = pad.left + (trend.length === 1 ? plotWidth / 2 : index * step);
    const barHeight = totalAmount ? Math.max(3, (totalAmount / maxAmount) * plotHeight) : 0;
    const y = axisBottom - barHeight;
    const labelLevel = index % 3;
    const labelY = Math.max(15, y - 7 - labelLevel * 14 - (missing ? 11 : 0));
    const missingY = Math.max(26, y - 5 - labelLevel * 14);
    const selected = item.date === state.sortDate;
    return { ...item, totalAmount, amountStockCount, missing, averageChange, selected, x, y, barHeight, labelY, missingY };
  });

  return `
    <svg class="amount-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 近15日每日总成交额">
      ${points.filter((point) => point.selected).map((point) => `
        <rect class="selected-date-band" x="${point.x - 18}" y="${pad.top - 10}" width="36" height="${plotHeight + 20}" rx="8"></rect>
      `).join('')}
      <line class="zero-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <text x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end" class="date-label">${yMaxLabel}</text>
      <text x="${pad.left - 10}" y="${axisBottom + 4}" text-anchor="end" class="date-label">0</text>
      ${points.map((point) => `
        <g>
          ${point.barHeight ? `
            <rect
              class="amount-bar ${point.averageChange >= 0 ? 'rise-bar' : 'fall-bar'}${point.missing ? ' missing' : ''}"
              x="${point.x - (point.selected ? barWidth + 4 : barWidth) / 2}"
              y="${point.y}"
              width="${point.selected ? barWidth + 4 : barWidth}"
              height="${point.barHeight}"
              rx="4"
            ></rect>
          ` : `
            <line class="missing-mark" x1="${point.x - barWidth / 2}" y1="${axisBottom - 4}" x2="${point.x + barWidth / 2}" y2="${axisBottom - 4}"></line>
          `}
          <text x="${point.x}" y="${point.labelY}" text-anchor="middle" class="amount-label">${amountText(point.totalAmount)}</text>
          ${point.missing ? `<text x="${point.x}" y="${point.missingY}" text-anchor="middle" class="missing-label">缺 ${point.missing}</text>` : ''}
          <text x="${point.x}" y="${height - 14}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} 总成交额 ${amountText(point.totalAmount)} | 已统计 ${point.amountStockCount}/${board.stockCount} 只${point.missing ? ` | 缺失 ${point.missing} 只` : ''}</title>
        </g>
      `).join('')}
    </svg>
  `;
}

function renderNewHighTrendChart(board) {
  const trend = newHighTrendRows(board).slice(-15);
  if (!trend.length) {
    return `
      <div>
        <strong>暂无百日新高扩散数据</strong>
        <p>需要至少 100 个有效交易日行情后才能计算。</p>
      </div>
    `;
  }

  const width = 760;
  const height = 250;
  const pad = { top: 30, right: 48, bottom: 46, left: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = trend.flatMap((item) => [
    Number(item.averageChange),
    Number(item.high100Rate),
    Number(item.nearHigh100Rate),
  ]).filter((value) => Number.isFinite(value));
  const rawMax = Math.max(...values, 1);
  const rawMin = Math.min(...values, -1);
  const valuePadding = Math.max(1, (rawMax - rawMin) * 0.12);
  const valueMax = rawMax + valuePadding;
  const valueMin = rawMin - valuePadding;
  const valueRange = valueMax - valueMin || 1;
  const yFor = (value) => pad.top + ((valueMax - value) / valueRange) * plotHeight;
  const xFor = (index) => pad.left + (trend.length === 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
  const points = trend.map((item, index) => {
    const averageChange = Number(item.averageChange);
    const high100Rate = Number(item.high100Rate);
    const nearHigh100Rate = Number(item.nearHigh100Rate);
    return {
      ...item,
      x: xFor(index),
      averageChange,
      high100Rate,
      nearHigh100Rate,
      yAverage: yFor(Number.isFinite(averageChange) ? averageChange : 0),
      yHigh: yFor(Number.isFinite(high100Rate) ? high100Rate : 0),
      yNear: yFor(Number.isFinite(nearHigh100Rate) ? nearHigh100Rate : 0),
      selected: item.date === state.sortDate,
    };
  });
  const line = (key) => points.map((point) => `${point.x},${point[key]}`).join(' ');
  const zeroY = yFor(0);
  const axisBottom = height - pad.bottom;

  return `
    <svg class="new-high-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 百日新高扩散趋势">
      ${points.filter((point) => point.selected).map((point) => `
        <rect class="selected-date-band" x="${point.x - 18}" y="${pad.top - 12}" width="36" height="${plotHeight + 24}" rx="8"></rect>
      `).join('')}
      <line class="zero-line" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <text x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end" class="axis-label">${number(valueMax)}%</text>
      <text x="${pad.left - 10}" y="${zeroY + 4}" text-anchor="end" class="axis-label">0%</text>
      <text x="${pad.left - 10}" y="${axisBottom + 4}" text-anchor="end" class="axis-label">${number(valueMin)}%</text>
      <polyline class="new-high-line average" points="${line('yAverage')}"></polyline>
      <polyline class="new-high-line high" points="${line('yHigh')}"></polyline>
      <polyline class="new-high-line near" points="${line('yNear')}"></polyline>
      ${points.map((point) => `
        <g class="new-high-point" data-high-date="${point.date}" tabindex="0" role="button" aria-label="${point.date} 百日新高扩散">
          <rect class="chart-hitbox" x="${point.x - 18}" y="${pad.top - 12}" width="36" height="${plotHeight + 24}"></rect>
          <circle class="new-high-dot average" cx="${point.x}" cy="${point.yAverage}" r="${point.selected ? 5.8 : 4.3}"></circle>
          <circle class="new-high-dot high" cx="${point.x}" cy="${point.yHigh}" r="${point.selected ? 5.8 : 4.3}"></circle>
          <circle class="new-high-dot near" cx="${point.x}" cy="${point.yNear}" r="${point.selected ? 5.8 : 4.3}"></circle>
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} | 板块平均涨幅 ${number(point.averageChange)}% | 百日新高 ${point.high100Count}/${point.stockCount} | 近高位 ${point.nearHigh100Count}/${point.stockCount} | 百日新高率 ${number(point.high100Rate)}% | 近高位率 ${number(point.nearHigh100Rate)}%</title>
        </g>
      `).join('')}
    </svg>
  `;
}

function renderNewHighTrendPanel(board) {
  const rows = newHighTrendRows(board);
  const current = newHighRowByDate(board, state.sortDate) || rows.at(-1);
  const index = rows.findIndex((item) => item.date === current?.date);
  const previous = index > 0 ? rows[index - 1] : null;
  const diffusion = diffusionLabel(current);
  const trend = diffusionTrendLabel(current, previous);
  const stockCount = current?.stockCount ?? 0;
  return `
    <section class="card section-card new-high-card">
      <div class="section-head">
        <div>
          <h2>百日新高扩散趋势</h2>
          <p class="muted">当前日期 ${shortDate(current?.date || state.sortDate)}：百日新高 ${current?.high100Count ?? 0}/${stockCount}，近高位 ${current?.nearHigh100Count ?? 0}/${stockCount}。</p>
        </div>
        <div class="badges">
          <span class="badge new-high-legend average">板块平均涨幅</span>
          <span class="badge new-high-legend high">百日新高率</span>
          <span class="badge new-high-legend near">近高位率</span>
        </div>
      </div>
      <div class="setup-grid new-high-summary">
        <div class="setup-metric"><span>百日新高扩散</span><strong class="state-chip ${diffusion.tone}">${diffusion.label}</strong><small>强 ≥25% 或近高位 ≥60%</small></div>
        <div class="setup-metric"><span>趋势变化</span><strong class="state-chip ${trend.tone}">${trend.label}</strong><small>${previous ? `对比 ${shortDate(previous.date)}` : '缺少上一交易日'}</small></div>
        <div class="setup-metric"><span>今日百日新高</span><strong>${current?.high100Count ?? 0}/${stockCount}</strong><small>百日新高率 ${percentText(current?.high100Rate)}</small></div>
        <div class="setup-metric"><span>今日近高位</span><strong>${current?.nearHigh100Count ?? 0}/${stockCount}</strong><small>近高位率 ${percentText(current?.nearHigh100Rate)}</small></div>
        <div class="setup-metric"><span>平均距新高</span><strong class="${signedClass(current?.avgDistanceToHigh100)}">${percentText(current?.avgDistanceToHigh100)}</strong><small>越接近 0 越贴近百日高点</small></div>
        <div class="setup-metric"><span>平均百日位置</span><strong>${current?.avgPosition100 === null || current?.avgPosition100 === undefined ? '暂无' : number(Number(current.avgPosition100) * 100)}%</strong><small>近100日区间位置</small></div>
      </div>
      <div class="chart-panel new-high-chart-panel">
        <div class="chart-box">${renderNewHighTrendChart(board)}</div>
      </div>
    </section>
  `;
}

function renderPoolTitle(label, count) {
  return `<div class="pool-title"><strong>${label}</strong><span>${count}</span></div>`;
}

function renderPoolItems(items, emptyText) {
  if (!items.length) return `<div class="pool-empty">${emptyText}</div>`;
  return items.map(({ board, setup }) => {
    const stats = setup.todayStats;
    const daysText = setup.lastStrong ? `距强 ${setup.lastStrong.days} 天` : '距强 暂无';
    const divergenceKind = setup.rawLabel === '强分歧' ? 'strong' : 'weak';
    const divergenceBadge = setup.rawLabel === '弱分歧' || setup.rawLabel === '强分歧'
      ? `<i class="divergence-kind ${divergenceKind}">${setup.rawLabel}</i>`
      : '';
    return `
      <button class="pool-item" type="button" data-code="${board.code}">
        <span>
          <strong>${divergenceBadge}${board.name}</strong>
          <small>${daysText}</small>
        </span>
        <span class="pool-score ${setup.tone}">${number(stats?.averageChange)}%</span>
      </button>
    `;
  }).join('');
}

function renderSetupPools() {
  const pools = setupPools(state.sortDate);
  return `
    <section class="setup-pools setup-pools-merged-divergence">
      <div class="pool-card primary">
        ${renderPoolTitle('强势', pools.strong.length)}
        ${renderPoolItems(pools.strong, '暂无强势板块')}
      </div>
      <div class="pool-card merged-divergence-card">
        ${renderPoolTitle('分歧', pools.divergence.length)}
        ${renderPoolItems(pools.divergence, '暂无分歧板块')}
      </div>
      <div class="pool-card risk">
        ${renderPoolTitle('弱势', pools.weak.length)}
        ${renderPoolItems(pools.weak, '暂无弱势板块')}
      </div>
    </section>
  `;
}

function renderSetupBadge(setup) {
  return `<span class="setup-badge ${setup.tone}">${setup.label}</span>`;
}

function setupStrengthValue(label) {
  return String(label || '').includes('强') ? 1 : 0;
}

function setupStructureWindow(board, date, size = 10) {
  const labels = boardLabelSeries(board);
  const currentIndex = labels.findIndex((item) => item.date === date);
  const endIndex = currentIndex >= 0 ? currentIndex : labels.length - 1;
  if (endIndex < 0) return [];
  return labels.slice(Math.max(0, endIndex - size + 1), endIndex + 1);
}

function renderSetupStructureChart(board) {
  const items = setupStructureWindow(board, state.sortDate, 10);
  if (!items.length) {
    return '<div class="pool-empty">暂无结构数据</div>';
  }

  const width = 720;
  const height = 210;
  const pad = { top: 24, right: 24, bottom: 42, left: 44 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const step = items.length > 1 ? plotWidth / (items.length - 1) : 0;
  const yFor = (value) => pad.top + (1 - value) * plotHeight;
  const points = items.map((item, index) => ({
    ...item,
    value: setupStrengthValue(item.label),
    x: pad.left + step * index,
    y: yFor(setupStrengthValue(item.label)),
  }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const latest = points.at(-1);
  const labelText = points.map((point) => `${shortDate(point.date)} ${point.label}=${point.value}`).join(' / ');

  return `
    <div class="structure-chart-wrap">
      <svg class="structure-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="10日结构强弱折线图">
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
        <line class="chart-axis" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
        <line class="structure-grid-line" x1="${pad.left}" y1="${yFor(1)}" x2="${width - pad.right}" y2="${yFor(1)}"></line>
        <line class="structure-grid-line" x1="${pad.left}" y1="${yFor(0)}" x2="${width - pad.right}" y2="${yFor(0)}"></line>
        <text class="structure-axis-label" x="18" y="${yFor(1) + 4}">1</text>
        <text class="structure-axis-label" x="18" y="${yFor(0) + 4}">0</text>
        <path class="structure-line" d="${path}"></path>
        ${points.map((point) => `
          <g class="structure-point ${point.value ? 'strong' : 'weak'}">
            <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5"></circle>
            <text x="${point.x.toFixed(1)}" y="${height - 16}" text-anchor="middle">${shortDate(point.date)}</text>
          </g>
        `).join('')}
      </svg>
      <div class="structure-legend">
        <span>强=1</span>
        <span>弱=0</span>
        <strong>${latest ? `${shortDate(latest.date)} ${latest.label}=${latest.value}` : '暂无'}</strong>
      </div>
      <p class="muted structure-sequence">${labelText}</p>
    </div>
  `;
}

function renderSetupSummary(board) {
  const setup = boardSetup(board, state.sortDate);
  return `
    <section class="card section-card setup-card">
      <div class="section-head">
        <div>
          <h2>${board.name} · 10日结构</h2>
          <p class="muted">按 ${shortDate(state.sortDate)} 判断：${setup.rawLabel}；强势结构记为 1，其余记为 0。</p>
        </div>
        ${renderSetupBadge(setup)}
      </div>
      ${renderSetupStructureChart(board)}
    </section>
  `;
}

function renderEditor(board) {
  if (!state.editable) {
    return `
      <section class="card section-card editor-card">
        <div class="section-head">
          <div>
            <h2>编辑自定义板块</h2>
            <p class="muted">当前是只读模式。请运行 scripts/serve_custom_boards.py 以启用增删个股。</p>
          </div>
          <div class="count-pill">只读</div>
        </div>
      </section>
    `;
  }

  return `
    <section class="card section-card editor-card">
      <div class="section-head">
        <div>
          <h2>编辑自定义板块</h2>
          <p class="muted">新增或删除个股后，会更新配置并刷新派生数据。</p>
        </div>
        <div class="count-pill">${state.busy ? '更新中' : '可编辑'}</div>
      </div>
      <form class="stock-form" id="addStockForm">
        <input name="code" inputmode="numeric" autocomplete="off" placeholder="股票代码，例如 300750" ${state.busy ? 'disabled' : ''}>
        <input name="name" autocomplete="off" placeholder="股票名称（可选）" ${state.busy ? 'disabled' : ''}>
        <button type="submit" ${state.busy ? 'disabled' : ''}>加入当前板块</button>
      </form>
      ${state.message ? `<div class="editor-message">${state.message}</div>` : ''}
      <p class="muted editor-path">当前板块：${board.name}，配置文件：web/data/custom_boards_config.json</p>
    </section>
  `;
}

function renderProfitPanel(board) {
  const stocks = sortedProfitRows(board);
  return `
    <section class="card section-card profit-card">
      <div class="section-head">
        <div>
          <h2>${board.name} · 盈利评分</h2>
        </div>
      </div>
      <div class="table-wrap profit-table-wrap">
        <table class="profit-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>股票</th>
              <th>盈利标签</th>
              <th><button class="table-sort-btn" type="button" data-profit-sort-key="profitScore">盈利分${sortLabel(state.profitSort, 'profitScore')}</button></th>
              <th><button class="table-sort-btn" type="button" data-profit-sort-key="revenueYoY">营收同比${sortLabel(state.profitSort, 'revenueYoY')}</button></th>
              <th><button class="table-sort-btn" type="button" data-profit-sort-key="netProfitYoY">净利同比${sortLabel(state.profitSort, 'netProfitYoY')}</button></th>
              <th><button class="table-sort-btn" type="button" data-profit-sort-key="deductedNetProfitYoY">扣非同比${sortLabel(state.profitSort, 'deductedNetProfitYoY')}</button></th>
              <th><button class="table-sort-btn" type="button" data-profit-sort-key="grossMargin">毛利率${sortLabel(state.profitSort, 'grossMargin')}</button></th>
              <th><button class="table-sort-btn" type="button" data-profit-sort-key="operatingCashFlowToNetProfit">现金流/净利${sortLabel(state.profitSort, 'operatingCashFlowToNetProfit')}</button></th>
            </tr>
          </thead>
          <tbody>
            ${stocks.length ? stocks.map((stock, index) => {
              const stockMetrics = stock.profitMetrics || {};
              const stockScore = profitScoreValue(stock);
              const stockLabel = stock.profitLabel || '暂无评级';
              return `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${stock.name}</strong> <span class="code">${stock.code}</span></td>
                  <td><span class="setup-badge ${profitTone(stockLabel, stockScore)}">${stockLabel}</span></td>
                  <td><strong>${stockScore === null ? '暂无' : number(stockScore, 0)}</strong></td>
                  <td class="${signedClass(stockMetrics.revenueYoY)}">${profitMetricText(stockMetrics, 'revenueYoY', '%', 0)}</td>
                  <td class="${signedClass(stockMetrics.netProfitYoY)}">${profitMetricText(stockMetrics, 'netProfitYoY', '%', 0)}</td>
                  <td class="${signedClass(stockMetrics.deductedNetProfitYoY)}">${profitMetricText(stockMetrics, 'deductedNetProfitYoY', '%', 0)}</td>
                  <td>${profitMetricText(stockMetrics, 'grossMargin', '%', 0)}</td>
                  <td>${profitMetricText(stockMetrics, 'operatingCashFlowToNetProfit', '', 2)}</td>
                </tr>
              `;
            }).join('') : '<tr><td colspan="9" class="empty">该板块暂无个股</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function stockDisplayForDate(board, stock, date) {
  const snapshot = stockSnapshotByDate(board, date);
  const hasDateSnapshot = boardHasDateSnapshot(board, date);
  const current = snapshot.get(String(stock?.code || ''));
  const useDateSnapshot = Boolean(date && hasDateSnapshot);
  return {
    ...stock,
    displayDate: useDateSnapshot ? date : stock?.latestDate,
    displayClose: useDateSnapshot ? (current?.close ?? null) : stock?.latestClose,
    displayChangePercent: useDateSnapshot ? (current?.changePercent ?? null) : stock?.latestChangePercent,
    displayAmount: useDateSnapshot ? stockTurnover(current) : (stock?.latestTurnover ?? stock?.latestAmount),
    displayMainNetInflow: useDateSnapshot ? stockMainNetInflow(current) : stock?.latestMainNetInflow,
    displayHighStatus: useDateSnapshot ? (current?.highStatus ?? null) : stock?.latestHighStatus,
  };
}

function customBoardStockCodes() {
  return new Set(customBoardStockMap().keys());
}

function customBoardStockMap() {
  const rows = new Map();
  (state.data?.boards || []).forEach((board) => {
    (board?.stocks || []).forEach((stock) => {
      const code = String(stock?.code || '');
      if (!code) return;
      const boards = rows.get(code) || [];
      if (board?.name && !boards.includes(board.name)) boards.push(board.name);
      rows.set(code, boards);
    });
  });
  return rows;
}

function fullATopTurnoverRows(date, limit = 20) {
  const customMap = customBoardStockMap();
  return [...(state.fullATurnover?.stocks || [])]
    .map((stock) => {
      const boardNames = customMap.get(String(stock.code || '')) || [];
      return {
        ...stock,
        displayDate: stock.date || state.fullATurnover?.date || date,
        displayClose: stock.close,
        displayChangePercent: stock.changePercent,
        displayAmount: stock.turnover ?? stock.amount,
        displayBoardLabel: boardNames.length ? boardNames.join('、') : '未纳入',
        displayBoardSort: boardNames.length ? boardNames.join('、') : 'zzz未纳入',
        isNew: Boolean(stock.isNew),
        isOutsideCustomBoards: !boardNames.length,
      };
    })
    .filter((stock) => numericSortValue(stock.displayAmount) !== null)
    .sort((a, b) =>
      compareFullATurnoverRows(a, b, state.fullATurnoverSort.key, state.fullATurnoverSort.direction)
      || compareNumeric(a, b, 'displayAmount', 'desc')
      || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'))
    .slice(0, limit);
}

function compareFullATurnoverRows(a, b, key, direction = 'desc') {
  if (key === 'displayBoardSort') {
    const multiplier = direction === 'asc' ? 1 : -1;
    return multiplier * String(a.displayBoardSort || '').localeCompare(String(b.displayBoardSort || ''), 'zh-Hans-CN');
  }
  return compareNumeric(a, b, key, direction);
}

function renderFullATurnoverPanel() {
  const stocks = fullATopTurnoverRows(state.sortDate, 20);
  const snapshotDate = state.fullATurnover?.date || state.sortDate || '最新';
  const compareDate = state.fullATurnover?.compareDate;
  const outsideCount = stocks.filter((stock) => stock.isOutsideCustomBoards).length;
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>全A · 成交额前20</h2>
          <p class="muted">按 ${snapshotDate} 全市场实时行情统计${compareDate ? `，红色为较 ${compareDate} 新进入前20` : ''}，橙色为未纳入当前自定义板块池${state.fullATurnover?.isFallback ? `，所选${state.fullATurnover?.requestedDate}快照暂缺，显示最近可用数据` : ''}，数据源：${state.fullATurnover?.source?.name || '暂无'}${state.fullATurnover?.error ? `，加载失败：${state.fullATurnover.error}` : ''}。</p>
        </div>
        <div class="count-pill">${stocks.length} 只 · 未纳入 ${outsideCount}</div>
      </div>
      <div class="table-wrap full-a-turnover-wrap">
        <table class="full-a-turnover-table">
          <thead>
            <tr>
              <th>股票</th>
              <th><button class="table-sort-btn" type="button" data-full-a-sort-key="displayBoardSort">板块${sortLabel(state.fullATurnoverSort, 'displayBoardSort')}</button></th>
              <th><button class="table-sort-btn" type="button" data-full-a-sort-key="displayChangePercent">涨跌幅${sortLabel(state.fullATurnoverSort, 'displayChangePercent')}</button></th>
              <th><button class="table-sort-btn" type="button" data-full-a-sort-key="displayAmount">成交额${sortLabel(state.fullATurnoverSort, 'displayAmount')}</button></th>
            </tr>
          </thead>
          <tbody>
            ${stocks.length ? stocks.map((stock, index) => `
              <tr class="${stock.isNew ? 'full-a-new-row' : ''}${stock.isOutsideCustomBoards ? ' full-a-outside-row' : ''}">
                <td class="stock-name-nowrap"><strong title="${stock.name || ''}">${index + 1}. ${stock.name || '暂无'}</strong> <span class="code">${stock.code}</span></td>
                <td class="full-a-board-cell">${stock.isOutsideCustomBoards ? '<span class="full-a-status-badge">未纳入</span>' : stock.displayBoardLabel}</td>
                <td class="${signedClass(stock.displayChangePercent)}">${number(stock.displayChangePercent)}%</td>
                <td><strong>${amountText(stock.displayAmount)}</strong></td>
              </tr>
            `).join('') : '<tr><td colspan="4" class="empty">暂无可统计的全A成交额数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function isFiniteMetric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function metricPercent(value, digits = 0) {
  return isFiniteMetric(value) ? `${number(value, digits)}%` : '—';
}

function metricMinutes(value) {
  return isFiniteMetric(value) ? `${number(value, 0)} 分钟` : '—';
}

function renderCybStrengthSummary(day) {
  if (!day || day.dataQuality === 'incomplete' || !day.marketState || !day.riskLevel) {
    return '<div class="cyb-strength-summary incomplete"><strong>数据不完整</strong><span>暂不推断市场状态和下探风险</span></div>';
  }
  const riskArrow = day.riskChange === '升温' ? ' ↑' : (day.riskChange === '缓解' ? ' ↓' : '');
  const reasons = Array.isArray(day.reasons) ? day.reasons.slice(0, 3) : [];
  return `
    <div class="cyb-strength-summary">
      <div><span>创业板强弱</span><strong>${day.marketState}</strong></div>
      <div><span>下探风险</span><strong>${day.riskLevel}${riskArrow}</strong></div>
      <div><span>趋势结构</span><strong>${day.trendStructure || '—'}</strong></div>
      <div><span>平均收复</span><strong>${metricPercent(day.avgRecoveryRate)}</strong></div>
      <div><span>收盘位置</span><strong>${metricPercent(day.closePosition)}</strong></div>
      <div><span>修复速度</span><strong>${metricMinutes(day.medianRecovery50Minutes)}</strong></div>
      ${reasons.length ? `<p><span>依据</span>${reasons.join('｜')}</p>` : ''}
    </div>
  `;
}

function applyInterval(days, interval) {
  // 把某粒度的 count/maxDepth/.../dips 合并进 day 顶层副本, 用于单粒度视图
  // (closePosition/趋势结构/风险等全天属性保留 15min 主口径结果)
  return days.map((day) => {
    const iv = day.intervals?.[interval];
    if (!iv) return day;
    return { ...day, ...iv, date: day.date };
  });
}

function renderTrendStatsPanel() {
  const stats = state.cybTrendStats;
  const allDays = Array.isArray(stats?.days) ? stats.days : [];
  const days = allDays.slice(-TREND_STATS_DISPLAY_DAYS);
  if (!days.length) {
    return `
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>创业板指 · 趋势统计</h2>
            <p class="muted">暂无统计数据${stats?.error ? `，加载失败：${stats.error}` : ''}。</p>
          </div>
        </div>
      </section>
    `;
  }
  const latestDay = days[days.length - 1];
  const iv = state.trendInterval;
  const isCompare = iv === 'compare';
  const ivLabel = { '15': '15分钟', '30': '30分钟' }[iv] || '';
  const body = isCompare
    ? renderCybTrendCompare(days)
    : `
      <div class="chart-panel">
        <div class="chart-panel-head">
          <strong>次数 × 深度 复合趋势（${ivLabel}）</strong>
          <span>上区折线=最大/累计深度（左轴）与平均收复率（右轴）；下区柱状=下探次数</span>
        </div>
        <div class="chart-box">${renderCybTrendStatsChart(applyInterval(days, iv))}</div>
      </div>
      ${renderCybTrendStatsTable(applyInterval(days, iv))}
      ${renderCybTrendDipsDetail(applyInterval(days, iv))}
    `;
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>${stats.index} · 下探趋势统计</h2>
          <p class="muted">${stats.method}。深度阈值：有效下探 ≥ 1.0%；更新时间 ${stats.updatedAt || stats.updated || '暂无'}；数据源：${stats.source?.name || 'westock 1分钟线'}（最近${days.length}个交易日）。</p>
        </div>
        <div class="count-pill">${days.length} 天</div>
      </div>
      ${renderCybStrengthSummary(latestDay)}
      <div class="trend-interval-bar" role="group" aria-label="K线粒度">
        <span class="trend-interval-label">K线粒度</span>
        <button type="button" data-trend-interval="15" class="${iv === '15' ? ' active' : ''}">15分钟</button>
        <button type="button" data-trend-interval="30" class="${iv === '30' ? ' active' : ''}">30分钟</button>
        <button type="button" data-trend-interval="compare" class="${isCompare ? ' active' : ''}">双粒度对比</button>
      </div>
      ${body}
      ${renderCybMajorDipPanel(days)}
      <div class="trend-stats-note">
        <p><strong>怎么看：</strong>下探按1分钟峰谷回撤识别，反弹收复前段跌幅50%才确认结束。<strong>最大深度</strong>代表单次最猛抛压，<strong>平均收复率</strong>衡量承接，市场状态再结合15分钟高低点结构和收盘位置判断。粒度越粗切段越少，深度越接近全天真实回撤；切换 30 分钟或双粒度对比可交叉验证单日下探强度。</p>
      </div>
    </section>
  `;
}

function renderCybMajorDipPanel(days) {
  const majorDays = days.filter((day) => isFiniteMetric(day.majorDipCount));
  const content = majorDays.length
    ? `
      <div class="chart-box">${renderCybMajorDipChart(majorDays)}</div>
      ${renderCybMajorDipSummaryTable(majorDays)}
      ${renderCybMajorDipDetail(majorDays)}
    `
    : '<p class="major-dip-pending">历史数据待重新计算后显示，原有下探统计不受影响。</p>';
  return `
    <section class="major-dip-panel" aria-label="主要下探确认统计">
      <div class="major-dip-head">
        <div>
          <strong>主要下探 · 独立确认口径</strong>
          <span>0.8%下跌确认 + 0.8%反弹确认</span>
        </div>
        <p>过滤途中小阳线，只观察肉眼可见的完整下探波段；不影响上方原有统计。</p>
      </div>
      ${content}
    </section>
  `;
}

function renderCybMajorDipChart(days) {
  const width = 760;
  const height = 250;
  const pad = { top: 38, right: 48, bottom: 34, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxDepth = Math.max(1.6, ...days.map((day) => day.majorDipMaxDepth || 0));
  const depthLimit = Math.ceil(maxDepth / 0.5) * 0.5;
  const maxCount = Math.max(2, ...days.map((day) => day.majorDipCount || 0));
  const x = (index) => chartPointX(index, days.length, width, pad);
  const depthY = (value) => pad.top + (depthLimit - value) / depthLimit * plotH;
  const countY = (value) => pad.top + (maxCount - value) / maxCount * plotH;
  const points = days.map((day, index) => ({
    ...day,
    x: x(index),
    depthY: depthY(day.majorDipMaxDepth || 0),
    countY: countY(day.majorDipCount || 0),
  }));
  const depthPath = smoothPath(points.map((point) => ({ x: point.x, y: point.depthY })));
  const barWidth = Math.max(14, Math.min(38, plotW / Math.max(days.length, 1) * 0.45));
  const ticks = [0, 0.5, 1].map((ratio) => ({
    depth: depthLimit * ratio,
    count: maxCount * ratio,
    y: depthY(depthLimit * ratio),
  }));
  return `
    <svg class="major-dip-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="主要下探次数与最大深度">
      <g class="major-dip-legend">
        <rect x="${pad.left}" y="15" width="12" height="12" rx="3" class="major-dip-bar"></rect>
        <text x="${pad.left + 19}" y="25">主要下探次数</text>
        <line x1="${pad.left + 122}" y1="21" x2="${pad.left + 150}" y2="21" class="major-dip-depth-line"></line>
        <text x="${pad.left + 158}" y="25">最大深度</text>
        <circle cx="${pad.left + 249}" cy="21" r="5" class="major-dip-open-dot"></circle>
        <text x="${pad.left + 260}" y="25">含收盘未确认</text>
      </g>
      ${ticks.map((tick) => `
        <line x1="${pad.left}" y1="${tick.y}" x2="${width - pad.right}" y2="${tick.y}" class="major-dip-grid"></line>
        <text x="${pad.left - 8}" y="${tick.y + 4}" text-anchor="end" class="axis-label">${number(tick.depth, 1)}%</text>
        <text x="${width - pad.right + 8}" y="${tick.y + 4}" class="axis-label">${number(tick.count, 0)}次</text>
      `).join('')}
      ${points.map((point) => `
        <rect x="${point.x - barWidth / 2}" y="${point.countY}" width="${barWidth}" height="${Math.max(1, pad.top + plotH - point.countY)}" rx="4" class="major-dip-bar"></rect>
      `).join('')}
      <path d="${depthPath}" class="major-dip-depth-line"></path>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.depthY}" r="${point.majorDipOpenCount ? 5 : 4}" class="${point.majorDipOpenCount ? 'major-dip-open-dot' : 'major-dip-depth-dot'}"></circle>
          <text x="${point.x}" y="${point.depthY - 9}" text-anchor="middle" class="major-dip-value">${number(point.majorDipMaxDepth || 0)}%</text>
          <text x="${point.x}" y="${height - 10}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date}\n主要下探 ${point.majorDipCount || 0} 次\n最大深度 ${number(point.majorDipMaxDepth || 0)}%\n已确认 ${point.majorDipConfirmedCount || 0} 次\n收盘未确认 ${point.majorDipOpenCount || 0} 次</title>
        </g>
      `).join('')}
    </svg>
  `;
}

function renderCybMajorDipSummaryTable(days) {
  return `
    <div class="major-dip-table-wrap">
      <table class="major-dip-summary-table">
        <thead><tr><th>日期</th><th>主要下探</th><th>最大深度</th><th>平均深度</th><th>已确认</th><th>收盘未确认</th></tr></thead>
        <tbody>${days.map((day) => `
          <tr>
            <td><strong>${shortDate(day.date)}</strong></td>
            <td>${day.majorDipCount ?? 0} 次</td>
            <td class="rise">${number(day.majorDipMaxDepth || 0)}%</td>
            <td>${number(day.majorDipAvgDepth || 0)}%</td>
            <td>${day.majorDipConfirmedCount ?? 0}</td>
            <td class="${day.majorDipOpenCount ? 'major-dip-open' : ''}">${day.majorDipOpenCount ?? 0}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderCybMajorDipDetail(days) {
  const sections = days.map((day) => {
    const dips = Array.isArray(day.majorDips) ? day.majorDips : [];
    if (!dips.length) return '';
    return `
      <div class="major-dip-day">
        <h4>${day.date} · ${dips.length} 次主要下探</h4>
        <table class="major-dip-detail-table">
          <thead><tr><th>#</th><th>高点时间</th><th>低点时间</th><th>深度</th><th>反弹确认</th><th>状态</th></tr></thead>
          <tbody>${dips.map((dip) => `
            <tr><td>${dip.wave}</td><td>${dip.start}</td><td>${dip.end}</td><td class="rise">${number(dip.depth)}%</td><td>${dip.confirmTime || '—'}</td><td class="${dip.status === '收盘未确认' ? 'major-dip-open' : ''}">${dip.status}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  }).join('');
  return `<details class="major-dip-detail"><summary>查看主要下探明细（高点 → 低点 → 反弹确认）</summary>${sections || '<p class="muted">当前范围内没有达到0.8%的主要下探。</p>'}</details>`;
}

function smoothPath(pts) {
  // Catmull-Rom -> 三次贝塞尔, 让折线平滑
  if (pts.length < 2) return pts.length ? `M ${pts[0].x},${pts[0].y}` : '';
  if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C ${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
}

function renderCybTrendStatsChart(days) {
  // ===== 上下双区布局: 上区=深度折线主图, 下区=次数柱状副图 (类似股票软件 主图+副图) =====
  const width = 760;
  const height = 352;
  const pad = { top: 40, right: 50, bottom: 30, left: 46 };
  const plotWidth = width - pad.left - pad.right;

  // 双区边界
  const mainTop = pad.top;          // 主图顶部
  const mainBottom = 218;           // 主图底部
  const splitY = 230;               // 分隔线
  const subTop = 244;               // 副图顶部
  const subBottom = 312;            // 副图底部
  const dateY = 342;                // 日期标签
  const mainH = mainBottom - mainTop;
  const subH = subBottom - subTop;

  // 量程
  const maxTotal = Math.max(...days.map((d) => d.totalDepth), 0);
  const maxMax = Math.max(...days.map((d) => d.maxDepth), 0);
  const depthLimit = Math.max(2, Math.ceil(Math.max(maxTotal, maxMax) * 1.18)); // 主图左轴
  const maxCount = Math.max(...days.map((d) => d.count), 1);
  const countLimit = Math.max(5, Math.ceil(maxCount / 5) * 5);                   // 副图右轴(整5)
  const barWidth = Math.max(12, Math.min(34, plotWidth / days.length * 0.5));
  const manyDays = days.length >= 14;   // 日期拥挤时旋转标签
  const showMaxLabels = days.length <= 10; // 天数多时只保留累计深度标签

  const mainY = (v) => mainTop + ((depthLimit - v) / depthLimit) * mainH;
  const subY = (v) => subTop + ((countLimit - v) / countLimit) * subH;
  const recoveryY = (v) => mainTop + ((100 - v) / 100) * mainH;
  const x = (i) => chartPointX(i, days.length, width, pad);

  const points = days.map((day, i) => ({
    ...day,
    x: x(i),
    totalY: mainY(day.totalDepth),
    maxY: mainY(day.maxDepth),
    countY: subY(day.count),
    recoveryY: isFiniteMetric(day.avgRecoveryRate) ? recoveryY(day.avgRecoveryRate) : null,
  }));
  const peak = points.reduce((b, p) => (p.maxDepth > b.maxDepth ? p : b), points[0] || {});
  const totalPath = smoothPath(points.map((p) => ({ x: p.x, y: p.totalY })));
  const maxPath = smoothPath(points.map((p) => ({ x: p.x, y: p.maxY })));
  const recoveryPaths = [];
  let recoverySegment = [];
  points.forEach((point) => {
    if (point.recoveryY === null) {
      if (recoverySegment.length) recoveryPaths.push(smoothPath(recoverySegment));
      recoverySegment = [];
    } else {
      recoverySegment.push({ x: point.x, y: point.recoveryY });
    }
  });
  if (recoverySegment.length) recoveryPaths.push(smoothPath(recoverySegment));
  const areaPath = totalPath
    ? `${totalPath} L ${points[points.length - 1].x},${mainBottom} L ${points[0].x},${mainBottom} Z`
    : '';

  // 主图左轴刻度(4档) + 副图右轴刻度(3档)
  const depthTicks = [0, 1, 2, 3].map((i) => ({ v: depthLimit * i / 4, y: mainY(depthLimit * i / 4) }));
  const countTicks = [0, 1, 2].map((i) => ({ v: countLimit * i / 2, y: subY(countLimit * i / 2) }));

  return `
    <svg class="trend-stats-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="创业板指 下探趋势统计">
      <!-- 图例: 左上角横排, 不遮数据 -->
      <g class="trend-stats-legend">
        <rect x="${pad.left}" y="14" width="11" height="11" rx="3" class="trend-legend-count-swatch"></rect>
        <text x="${pad.left + 18}" y="23" class="trend-legend-text">次数</text>
        <line x1="${pad.left + 58}" y1="19.5" x2="${pad.left + 84}" y2="19.5" class="trend-stats-total-line"></line>
        <text x="${pad.left + 90}" y="23" class="trend-legend-text">累计深度</text>
        <line x1="${pad.left + 148}" y1="19.5" x2="${pad.left + 174}" y2="19.5" class="trend-stats-max-line"></line>
        <text x="${pad.left + 180}" y="23" class="trend-legend-text">最大深度</text>
        <line x1="${pad.left + 242}" y1="19.5" x2="${pad.left + 268}" y2="19.5" class="trend-stats-recovery-line"></line>
        <text x="${pad.left + 274}" y="23" class="trend-legend-text">平均收复率</text>
      </g>

      <!-- 主图: 深度网格 + 左轴 -->
      ${depthTicks.map((tick) => `
        <line class="trend-stats-grid-line" x1="${pad.left}" y1="${tick.y}" x2="${width - pad.right}" y2="${tick.y}"></line>
        <text x="${pad.left - 8}" y="${tick.y + 4}" text-anchor="end" class="axis-label">${number(tick.v, 1)}</text>
      `).join('')}
      <text x="${pad.left - 8}" y="${mainBottom + 4}" text-anchor="end" class="axis-label">%</text>
      <line class="zero-line" x1="${pad.left}" y1="${mainBottom}" x2="${width - pad.right}" y2="${mainBottom}"></line>
      ${[0, 50, 100].map((value) => `<text x="${width - pad.right + 8}" y="${recoveryY(value) + 4}" class="axis-label">${value}%</text>`).join('')}

      <!-- 主图: 累计深度面积 + 双折线 + 数据点/标签 -->
      ${areaPath ? `<path class="trend-stats-area" d="${areaPath}"></path>` : ''}
      <path d="${totalPath}" class="trend-stats-total-line"></path>
      <path d="${maxPath}" class="trend-stats-max-line"></path>
      ${recoveryPaths.map((path) => `<path d="${path}" class="trend-stats-recovery-line"></path>`).join('')}
      ${points.map((point) => `
        <g>
          <circle class="trend-stats-dot total" cx="${point.x}" cy="${point.totalY}" r="4.2"></circle>
          <circle class="${point.date === peak.date ? 'trend-stats-dot peak' : 'trend-stats-dot max'}" cx="${point.x}" cy="${point.maxY}" r="${point.date === peak.date ? 6 : 3.8}"></circle>
          ${point.recoveryY === null ? '' : `<circle class="trend-stats-dot recovery" cx="${point.x}" cy="${point.recoveryY}" r="3.8"></circle>`}
          <text x="${point.x}" y="${point.totalY - 9}" text-anchor="middle" class="trend-stats-total-label">${number(point.totalDepth)}</text>
          ${showMaxLabels ? `<text x="${point.x}" y="${point.maxY + 16}" text-anchor="middle" class="trend-stats-max-label">${number(point.maxDepth)}</text>` : ''}
          <title>${point.date}\n下探 ${point.count} 次\n最大深度 ${number(point.maxDepth)}%\n累计深度 ${number(point.totalDepth)}%\n平均收复 ${metricPercent(point.avgRecoveryRate)}</title>
        </g>
      `).join('')}

      <!-- 分隔线 -->
      <line class="trend-stats-split-line" x1="${pad.left}" y1="${splitY}" x2="${width - pad.right}" y2="${splitY}"></line>

      <!-- 副图: 次数柱状 + 右轴 -->
      ${countTicks.map((tick) => `
        <line class="trend-stats-sub-grid" x1="${pad.left}" y1="${tick.y}" x2="${width - pad.right}" y2="${tick.y}"></line>
        <text x="${width - pad.right + 8}" y="${tick.y + 4}" text-anchor="start" class="axis-label">${tick.v}</text>
      `).join('')}
      <text x="${width - pad.right + 8}" y="${subBottom + 4}" text-anchor="start" class="axis-label">次</text>
      ${points.map((point) => `
        <g>
          <rect class="trend-count-bar" x="${point.x - barWidth / 2}" y="${point.countY}" width="${barWidth}" height="${Math.max(1, subBottom - point.countY)}" rx="3"></rect>
          <text x="${point.x}" y="${point.countY - 6}" text-anchor="middle" class="trend-count-value">${point.count}</text>
        </g>
      `).join('')}

      <!-- 共享日期轴 -->
      ${points.map((point) => `
        <text x="${point.x}" y="${dateY}" text-anchor="middle" class="date-label${manyDays ? ' trend-date-tilt' : ''}">${shortDate(point.date)}</text>
      `).join('')}
    </svg>
  `;
}

function renderCybTrendStatsTable(days) {
  return `
    <div class="trend-stats-table-wrap">
      <table class="trend-stats-table">
        <thead>
          <tr>
            <th class="trend-col-date">日期</th>
            <th class="trend-col-count">下探次数</th>
            <th class="trend-col-depth">最大深度</th>
            <th class="trend-col-depth">累计深度</th>
            <th class="trend-col-depth">平均深度</th>
            <th class="trend-col-count">有效下探</th>
            <th class="trend-col-recovery">平均收复</th>
            <th class="trend-col-position">收盘位置</th>
            <th class="trend-col-state">市场状态</th>
            <th class="trend-col-shape">形态</th>
          </tr>
        </thead>
        <tbody>
          ${days.map((day) => `
            <tr>
              <td class="trend-col-date"><strong>${shortDate(day.date)}</strong></td>
              <td class="trend-col-count trend-count-cell">${day.count}</td>
              <td class="trend-col-depth rise">${number(day.maxDepth)}%</td>
              <td class="trend-col-depth rise">${number(day.totalDepth)}%</td>
              <td class="trend-col-depth">${number(day.avgDepth)}%</td>
              <td class="trend-col-count">${day.effectiveCount}</td>
              <td class="trend-col-recovery">${metricPercent(day.avgRecoveryRate)}</td>
              <td class="trend-col-position">${metricPercent(day.closePosition)}</td>
              <td class="trend-col-state">${day.marketState || '—'}</td>
              <td class="trend-col-shape muted" title="${trendShapeFull(day)}">${trendShapeLabel(day)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function trendShapeFull(day) {
  if (day.effectiveCount >= 2) return '多而深 · 分歧加剧（有效下探≥2次）';
  if (day.maxDepth >= 2) return '深而猛 · 抛压集中（最大深度≥2%）';
  if (day.count >= 4) return '多而浅 · 健康换手（下探≥4次）';
  if (day.effectiveCount === 1) return '少而深 · 单波兑现';
  return '浅回调 · 涨势健康';
}

function trendShapeLabel(day) {
  if (day.effectiveCount >= 2) return '多而深 · 分歧加剧';
  if (day.maxDepth >= 2) return '深而猛 · 抛压集中';
  if (day.count >= 4) return '多而浅 · 健康换手';
  if (day.effectiveCount === 1) return '少而深 · 单波兑现';
  return '浅回调 · 涨势健康';
}

function renderCybTrendDipsDetail(days) {
  return `
    <details class="trend-stats-detail">
      <summary>查看每日下探明细（开始/结束时间 · 深度 · 持续时长）</summary>
      ${days.map((day) => {
        const dips = Array.isArray(day.dips) ? day.dips : [];
        if (!dips.length) return '';
        return `
          <div class="trend-stats-day">
            <h4>${day.date} · ${day.count} 次下探</h4>
            <table class="trend-stats-dips-table">
              <thead>
                <tr><th class="trend-col-seq">#</th><th class="trend-col-type">类型</th><th class="trend-col-time">开始</th><th class="trend-col-time">结束</th><th class="trend-col-depth">深度</th><th class="trend-col-duration">时长</th><th class="trend-col-recovery">收复率</th><th class="trend-col-recovery-time">修复至50%</th></tr>
              </thead>
              <tbody>
                ${dips.map((dip) => `
                  <tr>
                    <td class="trend-col-seq">${dip.wave}</td>
                    <td class="trend-col-type">${dip.type}</td>
                    <td class="trend-col-time">${dip.start}</td>
                    <td class="trend-col-time">${dip.end}</td>
                    <td class="trend-col-depth rise">${number(dip.depth)}%</td>
                    <td class="trend-col-duration">${dip.duration}<span class="trend-duration-unit"> 分钟</span></td>
                    <td class="trend-col-recovery">${metricPercent(dip.recoveryRate)}</td>
                    <td class="trend-col-recovery-time">${metricMinutes(dip.recovery50Minutes)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }).join('')}
    </details>
  `;
}

// ===== 双粒度对比视图 (15/30 分钟 vs 全天真实回撤) =====
const TREND_IV_ORDER = ['15', '30'];
const TREND_IV_LABEL = { '15': '15分钟', '30': '30分钟' };
const TREND_IV_COLOR = { '15': '#7fa8c9', '30': '#f5a623' };

function bestInterval(day, drawdown) {
  // 哪个粒度的最大深度最接近全天真实回撤(误差最小)
  if (drawdown == null) return null;
  let best = null;
  let bestGap = Infinity;
  TREND_IV_ORDER.forEach((iv) => {
    const md = day.intervals?.[iv]?.maxDepth;
    if (md == null) return;
    const gap = Math.abs(md - drawdown);
    if (gap < bestGap) { bestGap = gap; best = iv; }
  });
  return best;
}

function renderCybTrendCompare(days) {
  return `
    <div class="chart-panel">
      <div class="chart-panel-head">
        <strong>双粒度最大深度 × 全天回撤对比</strong>
        <span>柱=各粒度连续阴线波段的最大深度；灰虚线=全天真实回撤（1分钟线峰谷，不依赖切段）</span>
      </div>
      <div class="chart-box">${renderCybTrendCompareChart(days)}</div>
    </div>
    ${renderCybTrendCompareTable(days)}
    <div class="trend-stats-note">
      <p><strong>怎么读：</strong>粒度越粗，小阳线越容易被吞并、波段越连续，最大深度越接近全天真实回撤。柱高贴近灰虚线 = 该粒度较好还原盘中抛压；明显偏低（如 15min 常被小阳线切段）则低估单次下探的真实深度。对比表中每行「最大深度」误差最小的粒度会以高亮标出。</p>
    </div>
  `;
}

function renderCybTrendCompareChart(days) {
  const width = 760;
  const height = 300;
  const pad = { top: 36, right: 46, bottom: 28, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const groupW = plotW / days.length;
  const xC = (i) => pad.left + groupW * i + groupW / 2;
  const maxVal = Math.max(3, ...days.map((d) => Math.max(
    d.intervals?.['15']?.maxDepth || 0,
    d.intervals?.['30']?.maxDepth || 0,
    d.intradayDrawdown?.drawdown || 0,
  )));
  const yLimit = Math.ceil(maxVal * 1.12 / 0.5) * 0.5;   // 0.5 步长向上取整
  const yStep = yLimit <= 3 ? 0.5 : 1;
  const y = (v) => pad.top + (yLimit - v) / yLimit * plotH;
  const barW = Math.max(9, Math.min(22, groupW * 0.2));
  const barGap = barW * 0.18;
  const many = days.length >= 14;

  let grid = '';
  for (let v = 0; v <= yLimit + 1e-6; v += yStep) {
    const yy = y(v);
    grid += `<line class="trend-compare-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}"/>`;
    grid += `<text class="trend-compare-y" x="${pad.left - 7}" y="${yy + 3}" text-anchor="end">${Number(v.toFixed(1))}%</text>`;
  }

  let bars = '';
  days.forEach((day, i) => {
    TREND_IV_ORDER.forEach((iv, k) => {
      const depth = day.intervals?.[iv]?.maxDepth || 0;
      if (!depth) return;
      const x0 = xC(i) - barW - barGap + k * (barW + barGap);
      const yTop = y(depth);
      bars += `
        <rect class="trend-compare-bar" x="${x0}" y="${yTop}" width="${barW}" height="${pad.top + plotH - yTop}" rx="2" fill="${TREND_IV_COLOR[iv]}">
          <title>${shortDate(day.date)} ${TREND_IV_LABEL[iv]}：${number(depth)}%</title>
        </rect>
        <text class="trend-compare-bar-label" x="${x0 + barW / 2}" y="${yTop - 4}" text-anchor="middle">${number(depth, 1)}</text>`;
    });
  });

  const ddPts = days.map((day, i) => ({ x: xC(i), y: y(day.intradayDrawdown?.drawdown || 0) }));
  const ddPath = ddPts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ddDots = ddPts.map((p, i) => `
    <circle class="trend-compare-dd-dot" cx="${p.x}" cy="${p.y}" r="4">
      <title>${shortDate(days[i].date)} 全天回撤 ${days[i].intradayDrawdown?.drawdown || 0}%</title>
    </circle>`).join('');

  const dateLabels = days.map((day, i) => {
    if (many && i % 2) return '';
    return `<text class="trend-compare-date" x="${xC(i)}" y="${height - 6}" text-anchor="middle">${shortDate(day.date)}</text>`;
  }).join('');

  let lx = pad.left;
  let legend = '';
  TREND_IV_ORDER.forEach((iv) => {
    legend += `<rect x="${lx}" y="12" width="10" height="10" rx="2" fill="${TREND_IV_COLOR[iv]}"/><text class="trend-compare-legend-text" x="${lx + 14}" y="21">${TREND_IV_LABEL[iv]}</text>`;
    lx += 74;
  });
  legend += `<line class="trend-compare-dd-legend" x1="${lx}" y1="17" x2="${lx + 12}" y2="17"/><text class="trend-compare-legend-text" x="${lx + 16}" y="21">全天真实回撤</text>`;

  return `
    <svg class="trend-stats-svg trend-compare-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="双粒度最大深度与全天回撤对比图">
      ${grid}
      ${bars}
      <path class="trend-compare-dd-line" d="${ddPath}"/>
      ${ddDots}
      ${dateLabels}
      <g class="trend-compare-legend">${legend}</g>
    </svg>`;
}

function renderCybTrendCompareTable(days) {
  const rows = days.map((day) => {
    const dd = day.intradayDrawdown?.drawdown;
    const best = bestInterval(day, dd);
    const cell = (iv) => {
      const v = day.intervals?.[iv];
      if (!v) return '<td class="muted">—</td><td class="muted">—</td>';
      const cls = best === iv ? ' best' : '';
      const gap = dd != null && v.maxDepth != null ? `，误差 ${Math.abs(v.maxDepth - dd).toFixed(2)}%` : '';
      return `
        <td class="trend-compare-count${cls}" title="${TREND_IV_LABEL[iv]}${gap}">${v.count}次</td>
        <td class="trend-compare-depth${cls} rise" title="${TREND_IV_LABEL[iv]}${gap}">${number(v.maxDepth)}%</td>`;
    };
    return `
      <tr>
        <td class="trend-compare-date-cell"><strong>${shortDate(day.date)}</strong></td>
        ${cell('15')}
        ${cell('30')}
        <td class="trend-compare-dd rise">${metricPercent(dd, 2)}<span class="muted"> @${day.intradayDrawdown?.troughTime || '—'}</span></td>
      </tr>`;
  }).join('');

  return `
    <div class="trend-stats-table-wrap">
      <table class="trend-compare-table">
        <thead>
          <tr>
            <th rowspan="2" class="trend-col-date">日期</th>
            <th colspan="2">15分钟</th>
            <th colspan="2">30分钟</th>
            <th rowspan="2">全天回撤<br><span class="muted">真实参考</span></th>
          </tr>
          <tr>
            <th class="trend-compare-sub">次数</th>
            <th class="trend-compare-sub">最大深度</th>
            <th class="trend-compare-sub">次数</th>
            <th class="trend-compare-sub">最大深度</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderStocksTable(board) {
  const stocks = [...(board?.stocks || [])]
    .map((stock) => {
      return {
        ...stockDisplayForDate(board, stock, state.sortDate),
        membership: membershipAssessment(board, stock, state.sortDate),
      };
    })
    .sort((a, b) =>
      compareNumeric(a, b, state.stockListSort.key, state.stockListSort.direction)
      || sortChangeValue(b.displayChangePercent) - sortChangeValue(a.displayChangePercent));
  const actionColumn = state.editable ? '<th>操作</th>' : '';
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>板块个股</h2>
          <p class="muted">根据自定义配置生成，并展示 ${state.sortDate || '最新'} 行情（随日期切换联动）。</p>
        </div>
        <div class="count-pill">${stocks.length} 只</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>归属</th>
              <th><button class="table-sort-btn" type="button" data-stock-list-sort-key="displayChangePercent">涨跌幅${sortLabel(state.stockListSort, 'displayChangePercent')}</button></th>
              <th><button class="table-sort-btn" type="button" data-stock-list-sort-key="displayAmount">成交额${sortLabel(state.stockListSort, 'displayAmount')}</button></th>
              <th><button class="table-sort-btn" type="button" data-stock-list-sort-key="displayMainNetInflow">资金净流入${sortLabel(state.stockListSort, 'displayMainNetInflow')}</button></th>
              <th>新高状态</th>
              <th>依据</th>
              ${actionColumn}
            </tr>
          </thead>
          <tbody>
            ${stocks.length ? stocks.map((stock) => `
              <tr>
                <td class="code">${stock.code}</td>
                <td class="stock-name-nowrap"><strong title="${stock.name || ''}">${stock.name}</strong></td>
                <td><span class="membership-badge ${stock.membership.tone}">${stock.membership.label}</span></td>
                <td class="${signedClass(stock.displayChangePercent)}">${number(stock.displayChangePercent)}%</td>
                <td>${amountText(stock.displayAmount)}</td>
                <td>${todayFundFlowCell(stock.displayMainNetInflow)}</td>
                <td><span class="setup-badge ${highStatusTone(stock.displayHighStatus)}">${stock.displayHighStatus || '暂无'}</span></td>
                <td class="membership-reason">${stock.membership.reason}</td>
                ${state.editable ? `<td><button class="remove-stock" data-code="${stock.code}" data-name="${stock.name}" ${state.busy ? 'disabled' : ''}>删除</button></td>` : ''}
              </tr>
            `).join('') : `<tr><td colspan="${state.editable ? 9 : 8}" class="empty">该板块暂无已配置个股</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDetail(board) {
  if (!board) {
    return '<div class="card section-card empty">暂无自定义板块数据</div>';
  }
  if (state.detailTab === 'new-high') {
    state.detailTab = 'trend';
  }
  const selectedRow = trendSnapshotByDate(board, state.sortDate);
  const selectedAverageChange = rowDisplayAverageChange(board, selectedRow);
  const boardFlow = boardVolumePriceState(board, state.sortDate);
  const marketFlow = marketVolumePriceState(state.sortDate);
  const resonance = boardMarketResonance(board, state.sortDate);
  const selectedMainNetInflow = rowMainNetInflow(selectedRow);
  const isOverviewTab = state.detailTab === 'overview';
  const isTrendTab = state.detailTab === 'trend';
  const isProfitTab = state.detailTab === 'profit';
  const isFullATurnoverTab = state.detailTab === 'full-a-turnover';
  const isTrendStatsTab = state.detailTab === 'trend-stats';

  return `
    <div class="stack">
      <section class="card section-card detail-tabs-card">
        <div class="detail-tabs" role="tablist" aria-label="详情页签">
          <button class="detail-tab-btn${isOverviewTab ? ' active' : ''}" type="button" data-detail-tab="overview" role="tab" aria-selected="${isOverviewTab}">概览</button>
          <button class="detail-tab-btn${isTrendTab ? ' active' : ''}" type="button" data-detail-tab="trend" role="tab" aria-selected="${isTrendTab}">趋势曲线</button>
          <button class="detail-tab-btn${isProfitTab ? ' active' : ''}" type="button" data-detail-tab="profit" role="tab" aria-selected="${isProfitTab}">盈利评分</button>
          <button class="detail-tab-btn${state.detailTab === 'stocks' ? ' active' : ''}" type="button" data-detail-tab="stocks" role="tab" aria-selected="${state.detailTab === 'stocks'}">板块个股</button>
          <button class="detail-tab-btn${isFullATurnoverTab ? ' active' : ''}" type="button" data-detail-tab="full-a-turnover" role="tab" aria-selected="${isFullATurnoverTab}">成交额前20</button>
          <button class="detail-tab-btn${isTrendStatsTab ? ' active' : ''}" type="button" data-detail-tab="trend-stats" role="tab" aria-selected="${isTrendStatsTab}">趋势统计</button>
        </div>
      </section>
      ${isOverviewTab ? `
      <div class="swing-overview-anchor"></div>
      ` : ''}
      ${isTrendTab ? `
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>${board.name} · 趋势曲线</h2>
            <p class="muted">当前日期 ${state.sortDate || '最新'}：正宗股涨幅 ${number(selectedAverageChange)}%，涨停 ${limitUpCountByDate(board, state.sortDate)}，成交额 ${amountText(rowTotalTurnover(selectedRow))}，资金净流入 ${amountText(selectedMainNetInflow)}（${fundFlowSourceText(selectedRow)}，${fundFlowDateText(selectedRow?.fundFlowLatestDate, selectedRow?.date)}，${fundFlowCoverageText(selectedRow)}）。板块 ${boardFlow?.label || '暂无'}，指数 ${marketFlow?.label || '暂无'}，${resonance?.label || '暂无判断'}。</p>
          </div>
          <div class="badges">
            <span class="badge">蓝线：板块涨幅</span>
          </div>
        </div>
        <div class="chart-grid">
          <div class="chart-panel">
            <div class="chart-panel-head">
              <strong>板块与指数</strong>
              <span>正宗股平均涨跌幅</span>
            </div>
            <div class="chart-box">${renderTrendChart(board)}</div>
          </div>
          <div class="chart-panel">
            <div class="chart-panel-head">
              <strong>资金净流入</strong>
              <span>东方财富口径 · 正值流入 / 负值流出</span>
            </div>
            <div class="chart-box fund-flow-chart-box">${renderFundFlowTrendChart(board)}</div>
          </div>
          <div class="chart-panel">
            <div class="chart-panel-head">
              <strong>正宗股成交额</strong>
              <span>合计成交额</span>
            </div>
            <div class="chart-box core-chart-box">${renderPureCoreAmountChart(board)}</div>
          </div>
        </div>
      </section>
      ` : ''}
      ${isProfitTab ? renderProfitPanel(board) : ''}
      ${state.detailTab === 'stocks' ? renderStocksTable(board) : ''}
      ${isFullATurnoverTab ? renderFullATurnoverPanel() : ''}
      ${isTrendStatsTab ? renderTrendStatsPanel() : ''}
    </div>
  `;
}

function render() {
  const boards = sortedBoards();
  const board = activeBoard();
  const ascDates = trendDatesAsc();
  const currentIndex = ascDates.findIndex((date) => date === state.sortDate);
  const prevDate = currentIndex > 0 ? ascDates[currentIndex - 1] : null;
  const nextDate = currentIndex >= 0 && currentIndex < ascDates.length - 1 ? ascDates[currentIndex + 1] : null;
  app.innerHTML = `
    <div class="workspace-layout">
      <aside class="card sidebar-card">
        <div class="sidebar-head">
          <div class="sort-inline">
            <div class="sort-mode-group" role="group" aria-label="排序方式">
              <button class="sort-mode-btn${state.sortMode === 'avg_change' ? ' active' : ''}" type="button" data-mode="avg_change">涨幅</button>
              <button class="sort-mode-btn${state.sortMode === 'limit_up' ? ' active' : ''}" type="button" data-mode="limit_up">涨停</button>
            </div>
            <label class="sort-date-label">
              <span>日期</span>
              <button class="date-nav-btn" id="sortDatePrevBtn" type="button" ${prevDate ? '' : 'disabled'} aria-label="前一天">◀</button>
              <select id="sortDateSelect">
                ${availableTrendDates().map((date) => `<option value="${date}" ${date === state.sortDate ? 'selected' : ''}>${shortDate(date)}</option>`).join('')}
              </select>
              <button class="date-nav-btn" id="sortDateNextBtn" type="button" ${nextDate ? '' : 'disabled'} aria-label="后一天">▶</button>
            </label>
          </div>
          <div class="sort-status">按 ${shortDate(state.sortDate)} ${state.sortMode === 'limit_up' ? '涨停数' : '正宗股涨幅'} 排序</div>
        </div>
        <div class="board-list">
          ${boards.map((item) => {
            const selectedAverageChange = averageChangeByDate(item, state.sortDate);
            const setup = boardSetup(item, state.sortDate);
            const fundFlow = sidebarBoardFundFlow(item, state.sortDate);
            return `
            <button class="board-button${item.code === board?.code ? ' active' : ''}" data-code="${item.code}">
              <span>
                <strong>${item.name}</strong>
                <small>${setup.label} · 正宗 ${percentText(setup.todayStats?.averageChange)}</small>
                <small class="board-fund-flow ${fundFlow.tone}">${fundFlow.label}</small>
              </span>
              <span class="board-score">
                <small>涨停 ${limitUpCountByDate(item, state.sortDate)}</small>
                <strong class="${signedClass(selectedAverageChange)}">${number(selectedAverageChange)}%</strong>
                <small>涨幅</small>
              </span>
            </button>
          `;
          }).join('')}
        </div>
      </aside>
      <main class="detail-pane">
        ${renderDetail(board)}
      </main>
    </div>
  `;

  document.querySelectorAll('.board-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCode = button.dataset.code;
      render();
    });
  });

  document.querySelectorAll('.pool-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCode = button.dataset.code || button.dataset.boardCode;
      if (button.dataset.targetTab) state.detailTab = button.dataset.targetTab;
      render();
    });
  });

  document.querySelectorAll('.sort-mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.sortMode = button.dataset.mode;
      selectTopBoard();
      render();
    });
  });

  document.querySelector('#sortDateSelect')?.addEventListener('change', (event) => {
    setSortDate(event.target.value);
  });
  document.querySelector('#sortDatePrevBtn')?.addEventListener('click', () => {
    if (!prevDate) return;
    setSortDate(prevDate);
  });
  document.querySelector('#sortDateNextBtn')?.addEventListener('click', () => {
    if (!nextDate) return;
    setSortDate(nextDate);
  });
  document.querySelectorAll('.detail-tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.detailTab = button.dataset.detailTab;
      if (state.detailTab === 'full-a-turnover') {
        loadFullATurnoverData(state.sortDate).then((payload) => {
          state.fullATurnover = payload;
          render();
        });
        return;
      }
      if (state.detailTab === 'trend-stats') {
        render();
        loadCybTrendStats().then(() => render());
        return;
      }
      render();
    });
  });
  document.querySelectorAll('[data-trend-interval]').forEach((button) => {
    button.addEventListener('click', () => {
      state.trendInterval = button.dataset.trendInterval;
      render();
    });
  });
  document.querySelectorAll('[data-full-a-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.fullASortKey;
      state.fullATurnoverSort = {
        key,
        direction: state.fullATurnoverSort.key === key && state.fullATurnoverSort.direction === 'desc' ? 'asc' : 'desc',
      };
      render();
    });
  });
  document.querySelectorAll('[data-profit-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.profitSortKey;
      state.profitSort = {
        key,
        direction: state.profitSort.key === key && state.profitSort.direction === 'desc' ? 'asc' : 'desc',
      };
      render();
    });
  });
  document.querySelectorAll('[data-stock-list-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.stockListSortKey;
      state.stockListSort = {
        key,
        direction: state.stockListSort.key === key && state.stockListSort.direction === 'desc' ? 'asc' : 'desc',
      };
      render();
    });
  });
  document.querySelectorAll('.new-high-point').forEach((point) => {
    const selectDate = () => {
      if (!point.dataset.highDate) return;
      setSortDate(point.dataset.highDate, { detailTab: 'stocks' });
    };
    point.addEventListener('click', selectDate);
    point.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectDate();
      }
    });
  });

  document.querySelector('#addStockForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    updateStock('add', board.code, data.get('code'), data.get('name'));
  });

  document.querySelectorAll('.remove-stock').forEach((button) => {
    button.addEventListener('click', () => {
      if (confirm(`确定从 ${board.name} 删除 ${button.dataset.name || button.dataset.code} 吗？`)) {
        updateStock('remove', board.code, button.dataset.code);
      }
    });
  });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'dashboard:resize' }, '*');
    setTimeout(() => window.parent.postMessage({ type: 'dashboard:resize' }, '*'), 80);
  }
}

async function boot() {
  await detectEditingApi();
  state.data = await loadCustomBoardData(5);
  [state.labels, state.membership] = await Promise.all([
    loadLabels(state.data?.date),
    loadMembership(),
  ]);
  const dates = availableTrendDates();
  state.sortDate = dates[0] || state.data.date || null;
  await syncFullATurnoverForDate(state.sortDate);
  selectTopBoard();
  render();
  // 确保波段观察面板能被注入
  setTimeout(() => app.dispatchEvent(new Event('dashboard:rendered')), 0);
  scheduleBackgroundTask(() => {
    loadAdditionalCustomBoardHistory(state.data, 5).then((fullData) => {
      state.data = fullData;
      const fullDates = availableTrendDates();
      if (!state.sortDate || !fullDates.includes(state.sortDate)) {
        state.sortDate = fullDates[0] || state.data.date || null;
        if (state.detailTab === 'full-a-turnover') {
          syncFullATurnoverForDate(state.sortDate).then(render).catch(() => {});
        }
      }
      render();
      setTimeout(() => app.dispatchEvent(new Event('dashboard:rendered')), 0);
    }).catch(() => {});
  });
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">自定义板块数据加载失败：${error.message}</div>`;
});
