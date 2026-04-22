const app = document.querySelector('#app');

const state = {
  data: null,
  labels: [],
  membership: { overrides: [] },
  selectedCode: null,
  sortMode: 'avg_change',
  sortDate: null,
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

const shortDate = (date) => (date ? String(date).slice(5) : '暂无');

const signedClass = (value) => (Number(value) >= 0 ? 'rise' : 'fall');

const sortChangeValue = (value) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? -999999 : parsed;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const percentText = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无';
  return `${number(value)}%`;
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

function rowPureAverageChange(board, row) {
  if (!row) return null;
  const codes = pureStockCodes(board);
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
  const coreCodes = pureStockCodes(board);
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
  const codes = pureStockCodes(board);
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
  const pureCodes = pureStockCodes(board);
  const coreCodes = pureCoreStockCodes(board);
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
      label,
      displayLabel: label,
      reason,
      weakWatchDays,
      riskFlags: riskFlags(metric, previousMetric),
      tone: labelTone(label),
      priority: labelPriority(label),
    };
    rows.push(entry);
    previousLabel = label;
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
  return {
    strong: enriched.filter((item) => item.setup.rawLabel === '强').sort(byScore),
    weakDivergence: enriched.filter((item) => item.setup.rawLabel === '弱分歧').sort(byScore),
    strongDivergence: enriched.filter((item) => item.setup.rawLabel === '强分歧').sort(byScore),
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

function renderTrendChart(board) {
  const trend = trendValues(board)
    .map((item) => ({ ...item, displayAverageChange: rowDisplayAverageChange(board, item) }))
    .filter((item) => item.displayAverageChange !== null && item.displayAverageChange !== undefined);
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
  const avgMax = Math.max(...avgValues, 1);
  const avgMin = Math.min(...avgValues, -1);
  const avgRange = avgMax - avgMin || 1;
  const limitValues = trend.map((item) => rowLimitUpCount(item));
  const limitMax = Math.max(...limitValues, 1);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const points = trend.map((item, index) => {
    const change = Number(item.displayAverageChange) || 0;
    const limitUpCount = limitValues[index] ?? 0;
    const x = pad.left + (trend.length === 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
    const yAvg = pad.top + ((avgMax - change) / avgRange) * plotHeight;
    const yLimit = pad.top + ((limitMax - limitUpCount) / limitMax) * plotHeight;
    const label = boardLabelFor(board, item.date) || labelFor(board, item.date);
    const close = Math.abs(yAvg - yLimit) < 16;
    return {
      ...item,
      change,
      limitUpCount,
      selected: item.date === state.sortDate,
      x,
      yAvg,
      yLimit,
      yAvgLabel: close ? yAvg - 14 : yAvg - 10,
      yLimitLabel: close ? yLimit + 16 : yLimit - 10,
      tag: label?.displayLabel || label?.label || null,
    };
  });
  const avgLine = points.map((point) => `${point.x},${point.yAvg}`).join(' ');
  const limitLine = points.map((point) => `${point.x},${point.yLimit}`).join(' ');
  const zeroY = pad.top + ((avgMax - 0) / avgRange) * plotHeight;
  const axisBottom = height - pad.bottom;

  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 近15日平均涨跌幅与涨停家数走势">
      ${points.filter((point) => point.selected).map((point) => `
        <rect class="selected-date-band" x="${point.x - 18}" y="${pad.top - 12}" width="36" height="${plotHeight + 24}" rx="8"></rect>
      `).join('')}
      <line class="zero-line" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <polyline points="${avgLine}" style="fill:none;stroke:#0b7893;stroke-linecap:round;stroke-width:3;"></polyline>
      <polyline points="${limitLine}" style="fill:none;stroke:#d9480f;stroke-linecap:round;stroke-width:3;"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.yAvg}" r="${point.selected ? 6.2 : 4.5}" style="fill:#fff;stroke:#0b7893;stroke-width:${point.selected ? 3 : 2.2};"></circle>
          <circle cx="${point.x}" cy="${point.yLimit}" r="${point.selected ? 6.2 : 4.5}" style="fill:#fff;stroke:#d9480f;stroke-width:${point.selected ? 3 : 2.2};"></circle>
          <text x="${point.x}" y="${point.yAvgLabel}" text-anchor="middle" class="value-label">${number(point.change)}%</text>
          <text x="${point.x}" y="${point.yLimitLabel}" text-anchor="middle" class="value-label">${point.limitUpCount}</text>
          ${point.tag ? `<text x="${point.x}" y="${height - 30}" text-anchor="middle" class="tag-label">${point.tag}</text>` : ''}
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} 平均涨跌幅 ${number(point.change)}% | 涨停家数 ${point.limitUpCount} 家 | 有效股票 ${point.stockCount}</title>
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

function renderPoolTitle(label, count) {
  return `<div class="pool-title"><strong>${label}</strong><span>${count}</span></div>`;
}

function renderPoolItems(items, emptyText) {
  if (!items.length) return `<div class="pool-empty">${emptyText}</div>`;
  return items.map(({ board, setup }) => {
    const stats = setup.todayStats;
    const daysText = setup.lastStrong ? `距强 ${setup.lastStrong.days} 天` : '距强 暂无';
    return `
      <button class="pool-item" type="button" data-code="${board.code}">
        <span>
          <strong>${board.name}</strong>
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
    <section class="setup-pools">
      <div class="pool-card primary">
        ${renderPoolTitle('强势', pools.strong.length)}
        ${renderPoolItems(pools.strong, '暂无强势板块')}
      </div>
      <div class="pool-card">
        ${renderPoolTitle('弱分歧', pools.weakDivergence.length)}
        ${renderPoolItems(pools.weakDivergence, '暂无弱分歧')}
      </div>
      <div class="pool-card">
        ${renderPoolTitle('强分歧', pools.strongDivergence.length)}
        ${renderPoolItems(pools.strongDivergence, '暂无强分歧')}
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

function renderSetupSummary(board) {
  const setup = boardSetup(board, state.sortDate);
  const stats = setup.todayStats;
  const d1 = setup.d1Stats;
  const d2 = setup.d2Stats;
  const metric = setup.dailyLabel?.metric;
  const d1Label = boardLabelFor(board, setup.d1?.date);
  const d2Label = boardLabelFor(board, setup.d2?.date);
  const membership = membershipSummary(board, state.sortDate);
  const suspectList = membership.assessments
    .filter((item) => item.assessment.status === 'suspect' || item.assessment.status === 'overlap')
    .slice(0, 5);
  return `
    <section class="card section-card setup-card">
      <div class="section-head">
        <div>
          <h2>${board.name} · 模式观察</h2>
          <p class="muted">按 ${shortDate(state.sortDate)} 判断：${setup.rawLabel}，强度分 ${setup.strengthScore === null ? '暂无' : number(setup.strengthScore, 0)}，分歧分 ${setup.divergenceScore === null ? '暂无' : number(setup.divergenceScore, 0)}。</p>
        </div>
        ${renderSetupBadge(setup)}
      </div>
      <div class="setup-grid">
        <div class="setup-metric">
          <span>今日强度</span>
          <strong class="${signedClass(stats?.averageChange)}">${percentText(stats?.averageChange)}</strong>
          <small>正宗涨停 ${metric?.raw_limit_up_count_t ?? 0} · 红盘 ${metric?.R_t === null || metric?.R_t === undefined ? '暂无' : number(metric.R_t * 100, 0)}%</small>
        </div>
        <div class="setup-metric">
          <span>核心表现</span>
          <strong class="${signedClass(metric?.C_t)}">${percentText(metric?.C_t)}</strong>
          <small>B=${metric?.B_t === null || metric?.B_t === undefined ? '暂无' : number(metric.B_t)} · 分化 ${metric?.D_t === null || metric?.D_t === undefined ? '暂无' : number(metric.D_t)}</small>
        </div>
        <div class="setup-metric">
          <span>距上次强势</span>
          <strong>${setup.lastStrong ? `${setup.lastStrong.days} 天` : '暂无'}</strong>
          <small>${setup.lastStrong ? `上次强势 ${shortDate(setup.lastStrong.date)}` : '历史区间无强势'}</small>
        </div>
        <div class="setup-metric">
          <span>三日结构</span>
          <strong>${d2Label?.label || '暂无'} → ${d1Label?.label || '暂无'} → ${setup.rawLabel}</strong>
          <small>${shortDate(setup.d2?.date)} / ${shortDate(setup.d1?.date)} / ${shortDate(setup.today?.date)}</small>
        </div>
      </div>
      <div class="membership-alert">
        <strong>标签依据：</strong>
        ${setup.labelReason || '暂无'}${setup.riskFlags.length ? `；风险标记：${setup.riskFlags.join('、')}` : ''}
      </div>
      <div class="core-strip">
        ${setup.coreRank.map((stock, index) => `
          <div class="core-chip">
            <span>${index + 1}. ${stock.name}</span>
            <strong class="${signedClass(stock.changePercent)}">${percentText(stock.changePercent)}</strong>
            <small>${amountText(stockTurnover(stock))}</small>
          </div>
        `).join('')}
      </div>
      <div class="membership-strip">
        <div class="membership-count pure_core">正宗核心 ${membership.stats.pure_core || 0}</div>
        <div class="membership-count pure_elastic">正宗弹性 ${membership.stats.pure_elastic || 0}</div>
        <div class="membership-count supply_chain">产业配套 ${membership.stats.supply_chain || 0}</div>
        <div class="membership-count theme_edge">题材沾边 ${membership.stats.theme_edge || 0}</div>
        <div class="membership-count overlap">多题材 ${membership.stats.overlap || 0}</div>
        <div class="membership-count suspect">存疑/剔除 ${membership.stats.suspect || 0}</div>
        <div class="membership-count pending">待确认 ${membership.stats.pending || 0}</div>
      </div>
      ${suspectList.length ? `
        <div class="membership-alert">
          <strong>归属复盘：</strong>
          ${suspectList.map((item) => `${item.stock.name}（${item.assessment.label}）`).join('、')}
        </div>
      ` : ''}
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

function renderStocksTable(board) {
  const snapshot = stockSnapshotByDate(board, state.sortDate);
  const hasDateSnapshot = boardHasDateSnapshot(board, state.sortDate);
  const stocks = [...(board?.stocks || [])]
    .map((stock) => {
      const current = snapshot.get(String(stock.code || ''));
      const useDateSnapshot = Boolean(state.sortDate && hasDateSnapshot);
      return {
        ...stock,
        displayDate: useDateSnapshot ? state.sortDate : stock.latestDate,
        displayClose: useDateSnapshot ? (current?.close ?? null) : stock.latestClose,
        displayChangePercent: useDateSnapshot ? (current?.changePercent ?? null) : stock.latestChangePercent,
        displayAmount: useDateSnapshot ? stockTurnover(current) : (stock.latestTurnover ?? stock.latestAmount),
        membership: membershipAssessment(board, stock, state.sortDate),
      };
    })
    .sort((a, b) => sortChangeValue(b.displayChangePercent) - sortChangeValue(a.displayChangePercent));
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
              <th>涨跌幅</th>
              <th>成交额</th>
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
                <td class="membership-reason">${stock.membership.reason}</td>
                ${state.editable ? `<td><button class="remove-stock" data-code="${stock.code}" data-name="${stock.name}" ${state.busy ? 'disabled' : ''}>删除</button></td>` : ''}
              </tr>
            `).join('') : `<tr><td colspan="${state.editable ? 7 : 6}" class="empty">该板块暂无已配置个股</td></tr>`}
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
  const selectedRow = trendSnapshotByDate(board, state.sortDate);
  const selectedAverageChange = rowDisplayAverageChange(board, selectedRow);

  return `
    <div class="stack">
      ${renderSetupSummary(board)}
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>${board.name} · 趋势曲线</h2>
            <p class="muted">当前日期 ${state.sortDate || '最新'}：正宗股涨幅 ${number(selectedAverageChange)}%，涨停 ${limitUpCountByDate(board, state.sortDate)}，成交额 ${amountText(rowTotalTurnover(selectedRow))}。</p>
          </div>
          <div class="badges">
            <span class="badge">蓝线：平均涨跌幅</span>
            <span class="badge">橙线：涨停家数</span>
          </div>
        </div>
        <div class="chart-grid">
          <div class="chart-panel">
            <div class="chart-panel-head">
              <strong>正宗股强度</strong>
              <span>正宗股平均涨跌幅 / 涨停家数</span>
            </div>
            <div class="chart-box">${renderTrendChart(board)}</div>
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

      ${renderStocksTable(board)}
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
        <div class="board-list">
          ${boards.map((item) => {
            const selectedAverageChange = averageChangeByDate(item, state.sortDate);
            const setup = boardSetup(item, state.sortDate);
            return `
            <button class="board-button${item.code === board?.code ? ' active' : ''}" data-code="${item.code}">
              <span>
                <strong>${item.name}</strong>
                <small>${setup.label} · 正宗 ${percentText(setup.todayStats?.averageChange)}</small>
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
        ${renderSetupPools()}
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
      state.selectedCode = button.dataset.code;
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
    state.sortDate = event.target.value;
    selectTopBoard();
    render();
  });
  document.querySelector('#sortDatePrevBtn')?.addEventListener('click', () => {
    if (!prevDate) return;
    state.sortDate = prevDate;
    selectTopBoard();
    render();
  });
  document.querySelector('#sortDateNextBtn')?.addEventListener('click', () => {
    if (!nextDate) return;
    state.sortDate = nextDate;
    selectTopBoard();
    render();
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
  const response = await fetch(`./data/custom_boards.json?v=${Date.now()}`, { cache: 'no-store' });
  state.data = await response.json();
  try {
    const labelResponse = await fetch(`./data/custom_board_labels.json?v=${Date.now()}`, { cache: 'no-store' });
    const labelPayload = await labelResponse.json();
    const rawLabels = Array.isArray(labelPayload.labels) ? labelPayload.labels : [];
    const today = state.data?.date;
    state.labels = rawLabels.map((item) => {
      if (item?.date === today && item?.label === '强2') {
        return { ...item, label: '强1' };
      }
      return item;
    });
  } catch {
    state.labels = [];
  }
  try {
    const membershipResponse = await fetch(`./data/custom_board_membership.json?v=${Date.now()}`, { cache: 'no-store' });
    state.membership = membershipResponse.ok ? await membershipResponse.json() : { overrides: [] };
  } catch {
    state.membership = { overrides: [] };
  }
  const dates = availableTrendDates();
  state.sortDate = dates[0] || state.data.date || null;
  selectTopBoard();
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">自定义板块数据加载失败：${error.message}</div>`;
});
