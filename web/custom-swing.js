(function installCustomSwingPanel() {
  if (window.__customSwingPanelInstalled) return;
  window.__customSwingPanelInstalled = true;

  const SWING_TAB = 'swing';
  const BOARD_RANKING_TAB = 'board-ranking';
  let scheduled = false;
  let enhancing = false;
  let opportunitySort = {
    key: 'default',
    direction: 'desc',
  };
  let overviewSort = {
    key: 'default',
    direction: 'desc',
  };
  let stockTableSort = {
    key: 'sortScore',
    direction: 'desc',
  };
  let boardRankingSort = {
    key: 'sortScore',
    direction: 'desc',
  };
  let overviewTransitionFilter = new Set();
  const INTRADAY_WATCH_TRANSITIONS = new Set([
    '良性回踩转强',
    '退潮转强',
    '恶性回踩修复',
    '弱分歧',
    '进攻分歧',
    '承接观察',
    '进攻增强',
    '进攻延续',
    '恶性转良性',
    '退潮修复',
    '进攻钝化',
    '回踩走弱',
  ]);

  function safeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
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

  function fmtAmount(value) {
    const parsed = safeNumber(value);
    if (parsed === null) return '暂无';
    if (typeof amountText === 'function') return amountText(parsed);
    if (parsed >= 100000000) return `${fmt(parsed / 100000000, 2)}亿`;
    if (parsed >= 10000) return `${fmt(parsed / 10000, 0)}万`;
    return fmt(parsed, 0);
  }

  function fmtDelta(value, digits = 0) {
    const parsed = safeNumber(value);
    if (parsed === null) return '暂无';
    return `${parsed >= 0 ? '+' : ''}${fmt(parsed, digits)}`;
  }

  function fmtDate(date) {
    if (typeof shortDate === 'function') return shortDate(date);
    return date ? String(date).slice(5) : '暂无';
  }

  function changeClass(value) {
    if (typeof signedClass === 'function') return signedClass(value);
    return Number(value) >= 0 ? 'rise' : 'fall';
  }

  function deltaClass(value) {
    const parsed = safeNumber(value);
    if (parsed === null || parsed === 0) return '';
    return parsed > 0 ? 'rise' : 'fall';
  }

  function getTrendRows(board) {
    if (typeof trendValues === 'function') return trendValues(board);
    return (board?.trend || []).filter((row) => row?.averageChange !== null && row?.averageChange !== undefined);
  }

  function getSelectedIndex(rows, offset = 0) {
    if (!rows.length) return -1;
    let index = rows.length - 1;
    if (state?.sortDate) {
      const selected = rows.findIndex((row) => row.date === state.sortDate);
      if (selected >= 0) index = selected;
    }
    return Math.max(0, Math.min(rows.length - 1, index + offset));
  }

  function rowsToSelected(board, days, offset = 0) {
    const rows = getTrendRows(board);
    const end = getSelectedIndex(rows, offset);
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

  function stockTurnoverValue(stock) {
    if (typeof stockTurnover === 'function') return stockTurnover(stock);
    return safeNumber(stock?.turnover ?? stock?.amount);
  }

  function stockMainNetInflowValue(stock) {
    if (typeof stockMainNetInflow === 'function') return stockMainNetInflow(stock);
    return safeNumber(stock?.mainNetInflow ?? stock?.latestMainNetInflow);
  }

  function rowMainNetInflowValue(row) {
    if (typeof rowMainNetInflow === 'function') return rowMainNetInflow(row);
    return safeNumber(row?.mainNetInflow);
  }

  function sumFundFlowRows(rows, days) {
    const values = rows
      .slice(Math.max(0, rows.length - days))
      .map((row) => rowMainNetInflowValue(row))
      .filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  function fundFlowCoverageLabel(row) {
    if (typeof fundFlowCoverageText === 'function') return fundFlowCoverageText(row);
    const count = safeNumber(row?.fundFlowStockCount);
    const total = safeNumber(row?.stockCount);
    return count !== null && total ? `覆盖 ${count}/${total}` : '覆盖暂无';
  }

  function signedTone(value) {
    const parsed = safeNumber(value);
    if (parsed === null || parsed === 0) return '';
    return parsed > 0 ? 'rise' : 'fall';
  }

  function normalizeCode(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? digits.slice(-6).padStart(6, '0') : '';
  }

  function membershipOverride(board, stock) {
    const overrides = Array.isArray(state?.membership?.overrides) ? state.membership.overrides : [];
    const boardCode = String(board?.code || '');
    const stockCode = normalizeCode(stock?.code);
    return overrides.find((item) =>
      String(item.boardCode || '') === boardCode
      && normalizeCode(item.stockCode) === stockCode);
  }

  function stockBoardCount(stockCode) {
    const code = normalizeCode(stockCode);
    if (!code) return 0;
    return (state?.data?.boards || []).filter((board) =>
      (board.stocks || []).some((stock) => normalizeCode(stock.code) === code)).length;
  }

  function latestStockRank(board, stockCode, valueFn) {
    const code = normalizeCode(stockCode);
    const latestRow = getTrendRows(board).at(-1);
    const ranked = [...(latestRow?.stocks || [])]
      .filter((item) => safeNumber(valueFn(item)) !== null)
      .sort((a, b) => Number(valueFn(b)) - Number(valueFn(a)));
    const index = ranked.findIndex((item) => normalizeCode(item.code) === code);
    return index >= 0 ? index + 1 : null;
  }

  function stockTurnoverScore(amount) {
    const parsed = safeNumber(amount);
    if (parsed === null || parsed <= 0) return 0;
    return scoreRange(Math.log10(Math.max(parsed, 1)), 8, 10.8);
  }

  function stockAuthenticityMetric(board, stock) {
    const override = membershipOverride(board, stock);
    const statusScores = {
      pure_core: 100,
      pure_elastic: 88,
      core: 82,
      active: 74,
      supply_chain: 68,
      overlap: 62,
      manual: 58,
      pending: 55,
      theme_edge: 42,
      suspect: 20,
    };
    if (override) {
      const status = override.status || 'manual';
      const suggestedKeep = String(override.suggestedKeep || '');
      const baseScore = statusScores[status] ?? 58;
      return {
        score: suggestedKeep.includes('否') ? Math.min(baseScore, 35) : baseScore,
        label: override.label || status,
        status,
      };
    }
    const amountRank = latestStockRank(board, stock.code, stockTurnoverValue);
    const changeRank = latestStockRank(board, stock.code, (item) => item.changePercent);
    const latestRow = getTrendRows(board).at(-1);
    const row = (latestRow?.stocks || []).find((item) => normalizeCode(item.code) === normalizeCode(stock.code));
    if (amountRank !== null && amountRank <= 5) return { score: 78, label: '容量核心', status: 'core' };
    if (changeRank !== null && changeRank <= 3 && Number(row?.changePercent) > 0) return { score: 72, label: '弹性前排', status: 'active' };
    if (stockBoardCount(stock.code) >= 3) return { score: 60, label: '多题材', status: 'overlap' };
    return { score: 55, label: '待确认', status: 'pending' };
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

  function boardWindowMetric(board, days, offset = 0) {
    const rows = rowsToSelected(board, days, offset);
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

  function attackQualityMetric(row) {
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) {
      return {
        score: 0,
        high5Rate: null,
        high3Rate: null,
        redRate: null,
      };
    }
    const high5Rate = stocks.filter((stock) => Number(stock.changePercent) >= 5).length / stocks.length * 100;
    const high3Rate = stocks.filter((stock) => Number(stock.changePercent) >= 3).length / stocks.length * 100;
    const redRate = stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
    const score = (
      0.42 * scoreRange(high5Rate, 0, 35)
      + 0.34 * scoreRange(high3Rate, 5, 55)
      + 0.24 * scoreRange(redRate, 35, 85)
    );
    return {
      score: clampValue(score, 0, 100),
      high5Rate,
      high3Rate,
      redRate,
    };
  }

  function boardStatus(metric) {
    const latestChange = metric.latestChange ?? 0;
    const r3 = metric.return3 ?? 0;
    const excess3 = metric.excess3 ?? 0;
    const excess5 = metric.excess5 ?? 0;
    const excess10 = metric.excess10 ?? 0;
    const redRateToday = metric.redRateToday ?? 0;
    const drawdown3 = metric.drawdown3 ?? 0;
    const turnoverRatio = metric.turnoverRatio ?? 0;
    const backgroundOk = (excess5 >= 0) || ((metric.return5 ?? 0) > 0) || (excess10 > 1);
    const badPullback = latestChange < 0
      && metric.heatScore >= 35
      && (excess3 < -1 || redRateToday < 35 || drawdown3 > 6 || turnoverRatio > 1.25);

    if (metric.heatScore < 35 || (excess3 < -2 && redRateToday < 35) || (excess5 < -1 && excess10 < -2)) return '热度退潮';
    if (metric.heatScore >= 65 && latestChange >= 0 && r3 > 0 && excess3 >= 0 && redRateToday >= 50 && backgroundOk) return '主升';
    if (latestChange < 0 && metric.heatScore >= 50 && excess3 >= -0.5 && redRateToday >= 40 && turnoverRatio <= 1.15 && backgroundOk) return '良性回踩';
    if (badPullback) return '恶性回踩';
    if (metric.heatScore >= 55 && latestChange >= 0 && r3 > 0 && excess3 >= -0.5 && backgroundOk) return '启动';
    if (metric.heatScore >= 45 && drawdown3 >= 4) return '高位震荡';
    return '趋势走弱';
  }

  function statusTone(status) {
    return {
      主升: 'strong',
      良性回踩: 'test',
      恶性回踩: 'weak',
      二波观察: 'turn',
      启动: 'watch',
      高位震荡: 'mixed',
      趋势走弱: 'weak',
      热度退潮: 'divergence',
    }[status] || 'watch';
  }

  function stageForStatus(status) {
    if (['主升', '启动', '二波观察'].includes(status)) return '进攻段';
    if (status === '良性回踩') return '良性回踩';
    if (status === '恶性回踩') return '恶性回踩';
    return '退潮段';
  }

  function statusConclusion(metric) {
    if (metric.status === '主升') return '板块今日和 3 日维度仍在主动进攻，且 5/10 日背景没有破坏。';
    if (metric.status === '良性回踩') return '板块今天回落，但 3 日超额、红盘率和量能仍保持承接，适合观察韧性个股。';
    if (metric.status === '恶性回踩') return '板块短线回踩已经破坏承接，出现放量下跌、跑输、回撤加深或红盘率走弱，先从低吸候选里剔除。';
    if (metric.status === '二波观察') return '板块经历回撤后重新转强，适合观察是否形成第二波上攻。';
    if (metric.status === '启动') return '板块开始走强，但持续性还需要更多交易日验证。';
    if (metric.status === '高位震荡') return '板块热度尚在但波动变大，适合降低追涨欲望，等待更舒服的位置。';
    if (metric.status === '热度退潮') return '板块开始跑输指数或热度明显下降，波段上应谨慎。';
    return '板块趋势偏弱，暂不适合作为波段主线。';
  }

  function swingMetric(board, offset = 0) {
    const rows = getTrendRows(board);
    const selectedIndex = getSelectedIndex(rows, offset);
    const latestRow = selectedIndex >= 0 ? rows[selectedIndex] : null;
    const window3 = boardWindowMetric(board, 3, offset);
    const window5 = boardWindowMetric(board, 5, offset);
    const window10 = boardWindowMetric(board, 10, offset);

    const latestChange = getBoardChange(board, latestRow);
    const return3 = window3.boardReturn;
    const return5 = window5.boardReturn;
    const return10 = window10.boardReturn;
    const index3 = window3.indexReturn;
    const index5 = window5.indexReturn;
    const index10 = window10.indexReturn;
    const excess3 = return3 !== null && index3 !== null ? return3 - index3 : null;
    const excess5 = return5 !== null && index5 !== null ? return5 - index5 : null;
    const excess10 = return10 !== null && index10 !== null ? return10 - index10 : null;
    const redRateToday = getRedRate(latestRow);
    const redRate3 = window3.redRate;
    const redRate5 = window5.redRate;
    const turnoverRatio = window5.avgTurnover && window5.turnover
      ? window5.turnover / window5.avgTurnover
      : null;

    const heatScore = (
      0.28 * scoreRange(latestChange, -3, 6)
      + 0.22 * scoreRange(return3, -3, 8)
      + 0.18 * scoreRange(excess3, -3, 6)
      + 0.14 * scoreRange(redRateToday, 30, 80)
      + 0.10 * scoreRange(redRate3, 35, 85)
      + 0.08 * scoreRange(turnoverRatio, 0.75, 1.6)
    );
    const attackQuality = attackQualityMetric(latestRow);

    const metric = {
      board,
      latestRow,
      date: latestRow?.date || '',
      latestChange,
      return3,
      return5,
      return10,
      index3,
      index5,
      index10,
      excess3,
      excess5,
      excess10,
      redRateToday,
      redRate3,
      redRate5,
      turnoverRatio,
      drawdown3: window3.maxDrawdown,
      drawdown10: window10.maxDrawdown,
      upDays5: window5.upDays,
      validDays5: window5.validDays,
      heatScore: clampValue(heatScore, 0, 100),
      attackQuality,
    };
    metric.status = boardStatus(metric);
    metric.tone = statusTone(metric.status);
    metric.stage = stageForStatus(metric.status);
    metric.conclusion = statusConclusion(metric);
    return metric;
  }

  function rankingRowsToDate(board, selectedDate) {
    return getTrendRows(board)
      .filter((row) => !selectedDate || String(row.date || '') <= String(selectedDate))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }

  function boardRankingBaseMetric(board, selectedDate) {
    const rows = rankingRowsToDate(board, selectedDate);

    function windowMetric(days) {
      if (rows.length < days) return null;
      const windowRows = rows.slice(-days);
      const changes = windowRows.map((row) => getBoardChange(board, row));
      const indexChanges = windowRows.map((row) => getIndexChange(row.date));
      const turnovers = windowRows.map(getRowTurnover);
      const fundFlows = windowRows.map(rowMainNetInflowValue);
      const complete = (values) => values.length === days && values.every((value) => value !== null);
      const boardReturn = complete(changes) ? compoundReturn(changes) : null;
      const indexReturn = complete(indexChanges) ? compoundReturn(indexChanges) : null;
      return {
        amount: complete(turnovers) ? turnovers.reduce((sum, value) => sum + value, 0) : null,
        mainNetInflow: complete(fundFlows) ? fundFlows.reduce((sum, value) => sum + value, 0) : null,
        boardReturn,
        relative: boardReturn !== null && indexReturn !== null ? boardReturn - indexReturn : null,
        changes,
      };
    }

    function fundFlowWindowMetric(days) {
      const completedRows = rows
        .map((row) => ({ row, value: rowMainNetInflowValue(row) }))
        .filter((item) => item.value !== null)
        .slice(-days);
      if (completedRows.length < days) return null;
      return {
        amount: completedRows.reduce((sum, item) => sum + item.value, 0),
        latestDate: completedRows.at(-1)?.row?.date || '',
      };
    }

    const window3 = windowMetric(3);
    const window5 = windowMetric(5);
    const fundFlow3 = fundFlowWindowMetric(3);
    const fundFlow5 = fundFlowWindowMetric(5);
    const currentRow = rows.at(-1) || null;
    return {
      board,
      date: currentRow?.date || '',
      amountToday: currentRow ? getRowTurnover(currentRow) : null,
      mainNetInflowToday: currentRow ? rowMainNetInflowValue(currentRow) : null,
      amount3: window3?.amount ?? null,
      amount5: window5?.amount ?? null,
      mainNetInflow3: fundFlow3?.amount ?? null,
      mainNetInflow5: fundFlow5?.amount ?? null,
      fundFlowLatestDate: fundFlow5?.latestDate || fundFlow3?.latestDate || '',
      return3: window3?.boardReturn ?? null,
      return5: window5?.boardReturn ?? null,
      relative3: window3?.relative ?? null,
      relative5: window5?.relative ?? null,
      drawdown: window5 ? maxDrawdownFromChanges(window5.changes) : null,
    };
  }

  function normalizeBoardRankingMetric(rows, key) {
    const metricValue = (row) => row[key] === null || row[key] === undefined || row[key] === '' ? null : safeNumber(row[key]);
    const values = rows.map(metricValue).filter((value) => value !== null);
    if (!values.length) return new Map();
    const min = Math.min(...values);
    const max = Math.max(...values);
    return new Map(rows.map((row) => {
      const value = metricValue(row);
      if (value === null) return [row.board.code, null];
      return [row.board.code, max === min ? 50 : (value - min) / (max - min) * 100];
    }));
  }

  function scoreBoardRankingRows(boards, selectedDate) {
    const rows = (boards || []).map((board) => boardRankingBaseMetric(board, selectedDate));
    const amountScores = normalizeBoardRankingMetric(rows, 'amount5');
    const returnScores = normalizeBoardRankingMetric(rows, 'return5');
    rows.forEach((row) => {
      const amountScore = amountScores.get(row.board.code);
      const returnScore = returnScores.get(row.board.code);
      row.sortScore = amountScore === null || amountScore === undefined || returnScore === null || returnScore === undefined
        ? null
        : Math.round((0.58 * amountScore + 0.42 * returnScore) * 100) / 100;
      if (row.sortScore === null) row.status = '数据不足';
      else if ((row.drawdown ?? 0) > 8 || (row.relative5 ?? 0) < 0) row.status = '震荡/转弱';
      else if (row.sortScore >= 78 && (row.relative5 ?? 0) > 0) row.status = '趋势增强';
      else if (row.sortScore >= 65) row.status = '可观察';
      else row.status = '偏弱';
    });
    return rows.sort((a, b) => {
      if (a.sortScore === null && b.sortScore === null) return String(a.board.name || '').localeCompare(String(b.board.name || ''), 'zh-Hans-CN');
      if (a.sortScore === null) return 1;
      if (b.sortScore === null) return -1;
      return b.sortScore - a.sortScore || (b.amount5 ?? -Infinity) - (a.amount5 ?? -Infinity);
    });
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

  function macdTone(label, score) {
    const text = String(label || '');
    if (text.includes('死叉') || text.includes('绿柱扩张') || score <= 35) return 'weak';
    if (text.includes('金叉') || text.includes('红柱扩张') || text.includes('零轴上') || score >= 75) return 'strong';
    if (text.includes('收敛') || score >= 55) return 'test';
    return 'watch';
  }

  function stockResilienceRows(board) {
    const stockList = board?.stocks || [];
    const boardMetric = swingMetric(board);
    return stockList.map((stock) => {
      const items = stockRows(board, stock.code, 10);
      const ret5 = stockReturn(items, 5);
      const ret3 = stockReturn(items, 3);
      const amount3 = items.slice(Math.max(0, items.length - 3))
        .map((item) => stockTurnoverValue(item.stock))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const amount5 = items.slice(Math.max(0, items.length - 5))
        .map((item) => stockTurnoverValue(item.stock))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const mainNetInflow3Values = items.slice(Math.max(0, items.length - 3))
        .map((item) => stockMainNetInflowValue(item.stock))
        .filter((value) => value !== null);
      const mainNetInflow5Values = items.slice(Math.max(0, items.length - 5))
        .map((item) => stockMainNetInflowValue(item.stock))
        .filter((value) => value !== null);
      const mainNetInflow3 = mainNetInflow3Values.length
        ? mainNetInflow3Values.reduce((sum, value) => sum + value, 0)
        : null;
      const mainNetInflow5 = mainNetInflow5Values.length
        ? mainNetInflow5Values.reduce((sum, value) => sum + value, 0)
        : null;
      const ret10 = stockReturn(items, 10);
      const boardRet3 = boardReturnForItems(board, items, 3);
      const boardRet5 = boardReturnForItems(board, items, 5);
      const boardRet10 = boardReturnForItems(board, items, 10);
      const rel3 = ret3 !== null && boardRet3 !== null ? ret3 - boardRet3 : null;
      const rel5 = ret5 !== null && boardRet5 !== null ? ret5 - boardRet5 : null;
      const rel10 = ret10 !== null && boardRet10 !== null ? ret10 - boardRet10 : null;
      const drawdown = maxDrawdownFromChanges(items.map((item) => item.stock.changePercent));
      const defenseScore = stockDefenseScore(board, items);
      const reboundScore = stockReboundScore(board, items);
      const latestChange = items.length ? safeNumber(items.at(-1).stock.changePercent) : null;
      const latest = items.at(-1)?.stock || null;
      const latestRow = items.at(-1)?.row || null;
      const macdScore = safeNumber(latest?.macdScore) ?? 50;
      const macdLabel = latest?.macdLabel || 'MACD暂无';
      const authenticity = stockAuthenticityMetric(board, stock);
      const turnoverScore = stockTurnoverScore(amount3);
      const relScore = scoreRange(average([rel5, rel10]), -5, 10);
      const drawdownScore = 100 - scoreRange(drawdown, 4, 18);
      const trendScore = (
        0.55 * scoreRange(ret5, -3, 8)
        + 0.25 * scoreRange(ret10, -5, 15)
        + 0.20 * scoreRange(latestChange, -3, 5)
      );
      const score = (
        0.34 * relScore
        + 0.22 * drawdownScore
        + 0.16 * defenseScore
        + 0.09 * reboundScore
        + 0.09 * trendScore
        + 0.10 * macdScore
      );
      const sortScore = (
        0.58 * scoreRange(amount5, 0, 5000000000)
        + 0.42 * scoreRange(ret5, -5, 18)
      );
      return {
        code: stock.code,
        name: stock.name || stock.code,
        latest,
        ret3,
        ret5,
        ret10,
        amount3,
        amount5,
        mainNetInflow3,
        mainNetInflow5,
        fundFlowDate: latest?.fundFlowDate || stock.latestFundFlowDate,
        quoteDate: latestRow?.date,
        rel3,
        rel5,
        rel10,
        drawdown,
        defenseScore,
        reboundScore,
        latestChange,
        macdLabel,
        macdScore,
        authenticityScore: authenticity.score,
        authenticityLabel: authenticity.label,
        authenticityStatus: authenticity.status,
        turnoverScore,
        highStatus: latest?.highStatus || stock.latestHighStatus || '',
        score: clampValue(score, 0, 100),
        sortScore: clampValue(sortScore, 0, 100),
        status: score >= 78 ? '韧性强' : score >= 65 ? '可观察' : score >= 50 ? '一般' : '偏弱',
        boardStatus: boardMetric.status,
      };
    })
      .filter((item) => safeNumber(item.score) !== null)
      .sort((a, b) => b.sortScore - a.sortScore || b.amount5 - a.amount5 || (b.ret5 ?? -999) - (a.ret5 ?? -999));
  }

  function stockSortLabel(key) {
    if (stockTableSort.key !== key) return '';
    return stockTableSort.direction === 'asc' ? ' ↑' : ' ↓';
  }

  function stockSortValue(item, key) {
    return safeNumber(item[key]) ?? -Infinity;
  }

  function sortedStockRows(board) {
    const direction = stockTableSort.direction === 'asc' ? 1 : -1;
    return stockResilienceRows(board)
      .sort((a, b) =>
        direction * (stockSortValue(a, stockTableSort.key) - stockSortValue(b, stockTableSort.key))
        || b.sortScore - a.sortScore
        || b.amount5 - a.amount5);
  }

  function renderMetricCards(metric) {
    const cards = [
      ['短线热度', fmt(metric.heatScore, 0), metric.status],
      ['进攻质量', fmt(metric.attackQuality.score, 0), '高涨幅占比'],
      ['3日超额', fmtPercent(metric.excess3), '相对指数强弱'],
      ['今日红盘率', metric.redRateToday === null ? '暂无' : fmtPercent(metric.redRateToday, 0), '内部扩散'],
      ['3日回撤', fmtPercent(metric.drawdown3), '短线波动风险'],
      ['量能比', metric.turnoverRatio === null ? '暂无' : fmt(metric.turnoverRatio, 2), '当前/5日均额'],
    ];
    const flow3 = sumFundFlowRows(rowsToSelected(metric.board, 3), 3);
    const flow5 = sumFundFlowRows(rowsToSelected(metric.board, 5), 5);
    if (flow3 !== null) cards.push(['3日资金净流入', fmtAmount(flow3), fundFlowCoverageLabel(metric.latestRow)]);
    if (flow5 !== null) cards.push(['5日资金净流入', fmtAmount(flow5), fundFlowCoverageLabel(metric.latestRow)]);
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
    const rows = sortedStockRows(board);
    if (!rows.length) return '<div class="empty">暂无韧性股数据</div>';
    const hasFundFlow3 = rows.some((item) => safeNumber(item.mainNetInflow3) !== null);
    const hasFundFlow5 = rows.some((item) => safeNumber(item.mainNetInflow5) !== null);
    return `
      <div class="table-wrap swing-table-wrap">
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>股票</th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="sortScore">综合排序${stockSortLabel('sortScore')}</button></th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="amount3">3日成交额${stockSortLabel('amount3')}</button></th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="amount5">5日成交额${stockSortLabel('amount5')}</button></th>
              ${hasFundFlow3 ? `<th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="mainNetInflow3">3日资金净流入${stockSortLabel('mainNetInflow3')}</button></th>` : ''}
              ${hasFundFlow5 ? `<th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="mainNetInflow5">5日资金净流入${stockSortLabel('mainNetInflow5')}</button></th>` : ''}
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="ret3">3日涨幅${stockSortLabel('ret3')}</button></th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="ret5">5日涨幅${stockSortLabel('ret5')}</button></th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="rel3">3日相对板块${stockSortLabel('rel3')}</button></th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="rel5">5日相对板块${stockSortLabel('rel5')}</button></th>
              <th><button class="table-sort-btn" type="button" data-swing-stock-sort-key="drawdown">最大回撤${stockSortLabel('drawdown')}</button></th>
              <th>MACD</th>
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
                <td><strong>${fmt(item.sortScore, 0)}</strong></td>
                <td>${fmtAmount(item.amount3)}</td>
                <td>${fmtAmount(item.amount5)}</td>
                ${hasFundFlow3 ? `<td class="${signedTone(item.mainNetInflow3)}">${fmtAmount(item.mainNetInflow3)}</td>` : ''}
                ${hasFundFlow5 ? `<td class="${signedTone(item.mainNetInflow5)}">${fmtAmount(item.mainNetInflow5)}</td>` : ''}
                <td class="${changeClass(item.ret3)}">${fmtPercent(item.ret3)}</td>
                <td class="${changeClass(item.ret5)}">${fmtPercent(item.ret5)}</td>
                <td class="${changeClass(item.rel3)}">${fmtPercent(item.rel3)}</td>
                <td class="${changeClass(item.rel5)}">${fmtPercent(item.rel5)}</td>
                <td>${fmtPercent(item.drawdown)}</td>
                <td><span class="swing-badge ${macdTone(item.macdLabel, item.macdScore)}">${item.macdLabel}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSwingPanel(board) {
    return `
      <section class="card section-card swing-panel">
        <div class="swing-section-title">
          <strong>板块内韧性股排行</strong>
          <span>展示板块全部有效成员；按 5 日成交额与 5 日涨幅综合排序</span>
        </div>
        ${renderStockTable(board)}
      </section>
    `;
  }

  function boardRankingSortLabel(key) {
    if (boardRankingSort.key !== key) return '';
    return boardRankingSort.direction === 'asc' ? ' ↑' : ' ↓';
  }

  function sortedBoardRankingRows() {
    const direction = boardRankingSort.direction === 'asc' ? 1 : -1;
    return scoreBoardRankingRows(state?.data?.boards || [], state?.sortDate)
      .sort((a, b) => {
        const valueA = a[boardRankingSort.key];
        const valueB = b[boardRankingSort.key];
        const missingA = valueA === null || valueA === undefined || valueA === '';
        const missingB = valueB === null || valueB === undefined || valueB === '';
        if (missingA && missingB) return String(a.board.name || '').localeCompare(String(b.board.name || ''), 'zh-Hans-CN');
        if (missingA) return 1;
        if (missingB) return -1;
        return direction * (Number(valueA) - Number(valueB))
          || String(a.board.name || '').localeCompare(String(b.board.name || ''), 'zh-Hans-CN');
      });
  }

  function boardRankingStatusTone(status) {
    if (status === '趋势增强') return 'strong';
    if (status === '可观察') return 'test';
    if (status === '震荡/转弱') return 'weak';
    return 'watch';
  }

  function renderBoardRankingPanel() {
    const rows = sortedBoardRankingRows();
    const sortableHeader = (key, label) => `<button class="table-sort-btn" type="button" data-swing-board-ranking-sort-key="${key}">${label}${boardRankingSortLabel(key)}</button>`;
    return `
      <section class="card section-card board-ranking-panel">
        <div class="swing-section-title">
          <strong>板块波段排行</strong>
          <span>按5日成交额与5日涨幅综合排序；成交额和资金流均为板块成员股总额</span>
        </div>
        <div class="table-wrap board-ranking-table">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>板块</th>
                <th>${sortableHeader('amountToday', '当日成交额')}</th>
                <th>${sortableHeader('mainNetInflowToday', '当日资金净流入')}</th>
                <th>${sortableHeader('amount3', '3日成交额')}</th>
                <th>${sortableHeader('amount5', '5日成交额')}</th>
                <th>${sortableHeader('mainNetInflow3', '3日资金净流入')}<br><small>完整交易日</small></th>
                <th>${sortableHeader('mainNetInflow5', '5日资金净流入')}<br><small>完整交易日</small></th>
                <th>${sortableHeader('return3', '3日涨幅')}</th>
                <th>${sortableHeader('return5', '5日涨幅')}</th>
                <th>${sortableHeader('drawdown', '最大回撤')}</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td><button class="text-link swing-board-jump" type="button" data-board-ranking-code="${item.board.code}" data-board-code="${item.board.code}" data-target-tab="${SWING_TAB}">${item.board.name}</button></td>
                  <td>${fmtAmount(item.amountToday)}</td>
                  <td class="${deltaClass(item.mainNetInflowToday)}">${fmtAmount(item.mainNetInflowToday)}</td>
                  <td>${fmtAmount(item.amount3)}</td>
                  <td>${fmtAmount(item.amount5)}</td>
                  <td class="${deltaClass(item.mainNetInflow3)}">${fmtAmount(item.mainNetInflow3)}${item.fundFlowLatestDate ? `<br><small>截至 ${fmtDate(item.fundFlowLatestDate)}</small>` : ''}</td>
                  <td class="${deltaClass(item.mainNetInflow5)}">${fmtAmount(item.mainNetInflow5)}${item.fundFlowLatestDate ? `<br><small>截至 ${fmtDate(item.fundFlowLatestDate)}</small>` : ''}</td>
                  <td class="${deltaClass(item.return3)}">${fmtPercent(item.return3)}</td>
                  <td class="${deltaClass(item.return5)}">${fmtPercent(item.return5)}</td>
                  <td>${fmtPercent(item.drawdown)}</td>
                  <td><span class="swing-badge board-ranking-status ${boardRankingStatusTone(item.status)}">${item.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function allBoardSwingMetrics() {
    return (state?.data?.boards || [])
      .map((board) => swingMetric(board))
      .filter((metric) => metric?.latestRow);
  }

  function transitionLabel(metric, previous) {
    if (!previous?.latestRow) return { label: '暂无对比', tone: 'watch' };
    const heatDelta = metric.heatScore - previous.heatScore;
    const qualityDelta = metric.attackQuality.score - previous.attackQuality.score;
    if (metric.stage !== previous.stage) {
      const labelMap = {
        '进攻段->良性回踩': { label: '进攻分歧', tone: 'test' },
        '进攻段->恶性回踩': { label: '进攻转弱', tone: 'weak' },
        '进攻段->退潮段': { label: '进攻退潮', tone: 'divergence' },
        '良性回踩->进攻段': { label: '良性回踩转强', tone: 'strong' },
        '良性回踩->恶性回踩': { label: '承接失败', tone: 'weak' },
        '良性回踩->退潮段': { label: '回踩退潮', tone: 'divergence' },
        '恶性回踩->进攻段': { label: '恶性回踩修复', tone: 'strong' },
        '恶性回踩->良性回踩': { label: '恶性转良性', tone: 'test' },
        '恶性回踩->退潮段': { label: '恶性退潮', tone: 'divergence' },
        '退潮段->进攻段': { label: '退潮转强', tone: 'strong' },
        '退潮段->良性回踩': { label: '退潮修复', tone: 'test' },
        '退潮段->恶性回踩': { label: '退潮反抽失败', tone: 'weak' },
      };
      return labelMap[`${previous.stage}->${metric.stage}`] || { label: `${previous.stage}转${metric.stage}`, tone: metric.tone };
    }
    if (metric.stage === '进攻段') {
      if (heatDelta >= 0 && qualityDelta >= 0) return { label: '进攻增强', tone: 'strong' };
      if (qualityDelta < -12 && heatDelta < -8) return { label: '进攻钝化', tone: 'mixed' };
      if (qualityDelta < -5 || heatDelta < -5) return { label: '弱分歧', tone: 'test' };
      return { label: '进攻延续', tone: 'strong' };
    }
    if (metric.stage === '良性回踩') {
      if (qualityDelta >= -8 && metric.turnoverRatio <= 1.15) return { label: '承接观察', tone: 'test' };
      return { label: '回踩走弱', tone: 'mixed' };
    }
    if (metric.stage === '恶性回踩') return { label: '恶化', tone: 'weak' };
    return { label: '退潮延续', tone: 'divergence' };
  }

  function transitionRank(label) {
    return {
      良性回踩转强: 0,
      进攻增强: 1,
      弱分歧: 2,
      进攻延续: 3,
      承接观察: 4,
      进攻钝化: 5,
      回踩走弱: 6,
      恶化: 7,
      退潮延续: 8,
      暂无对比: 9,
    }[label] ?? (String(label || '').includes('转强') ? 0 : String(label || '').includes('转弱') ? 7 : 6);
  }

  function stageRank(stage) {
    return {
      进攻段: 0,
      良性回踩: 1,
      恶性回踩: 2,
      退潮段: 3,
    }[stage] ?? 9;
  }

  function metricWithPrevious(metric) {
    const previous = swingMetric(metric.board, -1);
    const stageHistory = Array.from({ length: 5 }, (_, index) => index - 4)
      .map((offset) => swingMetric(metric.board, offset))
      .filter((item) => item?.latestRow);
    return {
      ...metric,
      previous,
      stageHistory,
      transition: transitionLabel(metric, previous),
      heatDelta: previous?.latestRow ? metric.heatScore - previous.heatScore : null,
      qualityDelta: previous?.latestRow ? metric.attackQuality.score - previous.attackQuality.score : null,
      changeDelta: previous?.latestRow ? (metric.latestChange ?? 0) - (previous.latestChange ?? 0) : null,
    };
  }

  function overviewSortLabel(key) {
    if (overviewSort.key !== key) return '';
    return overviewSort.direction === 'asc' ? ' ↑' : ' ↓';
  }

  function sortOverviewRows(rows) {
    const numericKeys = {
      heatScore: (item) => item.heatScore,
      attackQuality: (item) => item.attackQuality?.score,
      latestChange: (item) => item.latestChange,
      excess3: (item) => item.excess3,
      turnoverRatio: (item) => item.turnoverRatio,
    };
    if (numericKeys[overviewSort.key]) {
      const direction = overviewSort.direction === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const valueA = safeNumber(numericKeys[overviewSort.key](a));
        const valueB = safeNumber(numericKeys[overviewSort.key](b));
        if (valueA === null && valueB === null) return 0;
        if (valueA === null) return 1;
        if (valueB === null) return -1;
        return direction * (valueA - valueB)
          || b.heatScore - a.heatScore
          || b.attackQuality.score - a.attackQuality.score;
      });
    }
    if (overviewSort.key === 'transition') {
      const direction = overviewSort.direction === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) =>
        direction * (transitionRank(a.transition.label) - transitionRank(b.transition.label))
        || b.heatScore - a.heatScore
        || b.attackQuality.score - a.attackQuality.score);
    }
    return [...rows].sort((a, b) =>
      stageRank(a.stage) - stageRank(b.stage)
      || b.heatScore - a.heatScore
      || b.attackQuality.score - a.attackQuality.score);
  }

  function toggleOverviewTransition(label) {
    if (!label) return;
    const next = new Set(overviewTransitionFilter);
    if (next.has(label)) {
      next.delete(label);
    } else {
      next.add(label);
    }
    overviewTransitionFilter = next;
    document.querySelectorAll('.swing-overview-panel').forEach((node) => node.remove());
    scheduleEnhance();
  }

  function transitionFilterControls(rows) {
    const labels = [...new Set(rows.map((item) => item.transition.label))]
      .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    const selectedCount = overviewTransitionFilter.size;
    return `
      <div class="transition-filter-pills" aria-label="按变化结论筛选">
        <button class="transition-filter-pill ${selectedCount === 0 ? 'active' : ''}" type="button" data-swing-transition-clear>全部</button>
        ${labels.map((label) => `
          <button class="transition-filter-pill ${overviewTransitionFilter.has(label) ? 'active' : ''}" type="button" data-swing-transition-option="${label}">
            ${label}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderStageHistory(item) {
    return `
      <div class="stage-flow-track" aria-label="近5日板块节奏">
        <div class="stage-flow-row">
            ${item.stageHistory.map((metric, index) => `
              ${index > 0 ? '<span class="stage-arrow">-&gt;</span>' : ''}
              <span class="stage-step">
                <small class="stage-date">${fmtDate(metric.date)}</small>
                <span class="swing-badge ${metric.tone}">${metric.stage}</span>
                <small class="stage-score">${fmt(metric.heatScore, 0)}分</small>
              </span>
            `).join('')}
        </div>
      </div>
    `;
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

  function intradayOpportunityRows(metrics) {
    const rows = metrics
      .map(metricWithPrevious)
      .filter((metric) => INTRADAY_WATCH_TRANSITIONS.has(metric.transition.label))
      .flatMap((metric) => stockResilienceRows(metric.board).slice(0, 3).map((stock) => {
        const stockScore = safeNumber(stock.score) ?? 0;
        const rel3 = safeNumber(stock.rel3) ?? 0;
        const latestChange = safeNumber(stock.latestChange) ?? 0;
        const macdScore = safeNumber(stock.macdScore) ?? 50;
        const stockPickScore = clampValue(
          0.34 * stockScore
          + 0.22 * scoreRange(rel3, -2, 5)
          + 0.13 * (safeNumber(stock.turnoverScore) ?? 0)
          + 0.12 * (safeNumber(stock.authenticityScore) ?? 55)
          + 0.10 * scoreRange(latestChange, -2, 6)
          + 0.09 * macdScore,
          0,
          100,
        );
        const signal = metric.transition.label;
        const signalPriority = Math.max(2, 12 - transitionRank(signal));
        return {
          board: metric.board,
          backgroundMetric: metric.previous,
          boardMetric: metric,
          intradayState: metric.transition,
          stock,
          signal,
          signalPriority,
          opportunityScore: stockPickScore,
          stockPickScore,
        };
      }))
      .filter((item) =>
        item.signalPriority >= 2
        && item.opportunityScore >= 58
        && (item.stock.score >= 65 || item.stock.latestChange >= 1 || item.stock.rel3 >= 0)
        && !String(item.stock.macdLabel || '').includes('死叉'));
    const sorted = [...rows];
    if (opportunitySort.key === 'board') {
      const direction = opportunitySort.direction === 'asc' ? 1 : -1;
      sorted.sort((a, b) => {
        const nameDiff = String(a.board.name || '').localeCompare(String(b.board.name || ''), 'zh-Hans-CN');
        if (nameDiff !== 0) return direction * nameDiff;
        return b.signalPriority - a.signalPriority || b.opportunityScore - a.opportunityScore;
      });
    } else {
      const numericKeys = {
        latestChange: (item) => item.stock.latestChange,
        rel3: (item) => item.stock.rel3,
        amount3: (item) => item.stock.amount3,
        opportunityScore: (item) => item.opportunityScore,
      };
      if (numericKeys[opportunitySort.key]) {
        const direction = opportunitySort.direction === 'asc' ? 1 : -1;
        sorted.sort((a, b) => {
          const valueA = safeNumber(numericKeys[opportunitySort.key](a));
          const valueB = safeNumber(numericKeys[opportunitySort.key](b));
          if (valueA === null && valueB === null) return 0;
          if (valueA === null) return 1;
          if (valueB === null) return -1;
          return direction * (valueA - valueB)
            || b.signalPriority - a.signalPriority
            || b.opportunityScore - a.opportunityScore;
        });
      } else {
        sorted.sort((a, b) => b.signalPriority - a.signalPriority || b.opportunityScore - a.opportunityScore);
      }
    }
    return sorted.slice(0, 12);
  }

  function renderIntradayOpportunityPanel(metrics) {
    const rows = intradayOpportunityRows(metrics);
    const signalTone = (signal) => {
      if (['良性回踩转强', '退潮转强', '恶性回踩修复', '进攻增强'].includes(signal)) return 'strong';
      if (['弱分歧', '进攻分歧', '承接观察', '恶性转良性', '退潮修复', '进攻延续'].includes(signal)) return 'test';
      if (['进攻钝化', '回踩走弱'].includes(signal)) return 'mixed';
      return 'watch';
    };
    const sortLabel = opportunitySort.key === 'board'
      ? (opportunitySort.direction === 'asc' ? ' ↑' : ' ↓')
      : '';
    return `
      <div class="swing-intraday-block">
        <div class="swing-section-title">
          <strong>盘中机会雷达</strong>
          <span>按热门板块波段观察的变化结论筛板块，每个板块只取 3 个核心股</span>
        </div>
        ${rows.length ? `
          <div class="table-wrap swing-intraday-table">
            <table>
              <thead>
                <tr>
                  <th><button class="table-sort-btn" type="button" data-swing-sort-key="board">板块${sortLabel}</button></th>
                  <th>昨日阶段</th>
                  <th>变化结论</th>
                  <th>个股</th>
                  <th><button class="table-sort-btn" type="button" data-swing-sort-key="latestChange">当前涨幅${opportunitySort.key === 'latestChange' ? (opportunitySort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
                  <th><button class="table-sort-btn" type="button" data-swing-sort-key="rel3">3日相对${opportunitySort.key === 'rel3' ? (opportunitySort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
                  <th><button class="table-sort-btn" type="button" data-swing-sort-key="amount3">3日成交额${opportunitySort.key === 'amount3' ? (opportunitySort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
                  <th>正宗性</th>
                  <th>MACD</th>
                  <th>高位</th>
                  <th>信号</th>
                  <th><button class="table-sort-btn" type="button" data-swing-sort-key="opportunityScore">选股分${opportunitySort.key === 'opportunityScore' ? (opportunitySort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((item) => `
                  <tr>
                    <td>
                      <button class="text-link swing-board-jump" type="button" data-code="${item.board.code}" data-board-code="${item.board.code}" data-target-tab="swing">${item.board.name}</button>
                    </td>
                    <td><span class="swing-badge ${item.backgroundMetric.tone}">${item.backgroundMetric.stage}</span><br><small>${item.backgroundMetric.status}</small></td>
                    <td><span class="swing-badge ${item.intradayState.tone}">${item.intradayState.label}</span><br><small>${item.boardMetric.stage} · ${item.boardMetric.status}</small></td>
                    <td><strong>${item.stock.name}</strong><br><span class="code">${item.stock.code}</span></td>
                    <td class="${changeClass(item.stock.latestChange)}">${fmtPercent(item.stock.latestChange)}</td>
                    <td class="${changeClass(item.stock.rel3)}">${fmtPercent(item.stock.rel3)}</td>
                    <td>${fmtAmount(item.stock.amount3)}</td>
                    <td><span class="swing-badge ${item.stock.authenticityStatus || 'watch'}">${item.stock.authenticityLabel || '待确认'}</span></td>
                    <td><span class="swing-badge ${macdTone(item.stock.macdLabel, item.stock.macdScore)}">${item.stock.macdLabel}</span></td>
                    <td>${item.stock.highStatus || '暂无'}</td>
                    <td><span class="swing-badge ${signalTone(item.signal)}">${item.signal}</span></td>
                    <td><strong>${fmt(item.opportunityScore, 0)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="pool-empty">暂无盘中机会信号</div>'}
      </div>
    `;
  }

  function renderOverviewPanel() {
    const baseRows = allBoardSwingMetrics()
      .map(metricWithPrevious)
      
    const rows = baseRows.filter((item) => overviewTransitionFilter.size === 0 || overviewTransitionFilter.has(item.transition.label));
    const sortedRows = sortOverviewRows(rows);
    const stageCounts = rows.reduce((acc, item) => {
      acc[item.stage] = (acc[item.stage] || 0) + 1;
      return acc;
    }, {});

    return `
      <section class="card section-card swing-overview-panel">
        <div class="section-head">
          <div>
            <h2>热门板块波段观察</h2>
            <p class="muted">用今日和 3 日数据判断四段，再和昨日对比热度、涨幅分布和高涨幅占比。</p>
          </div>
          <span class="count-pill">进攻 ${stageCounts.进攻段 || 0} / 回踩 ${stageCounts.良性回踩 || 0} / 恶性 ${stageCounts.恶性回踩 || 0}</span>
        </div>
        <div class="table-wrap swing-overview-table">
          <table>
            <thead>
              <tr>
                <th>板块</th>
                <th>板块节奏</th>
                <th>
                  <div class="column-filter transition-filter-head">
                    <button class="table-sort-btn" type="button" data-swing-overview-sort-key="transition">变化结论${overviewSortLabel('transition')}</button>
                    ${transitionFilterControls(baseRows)}
                  </div>
                </th>
                <th><button class="table-sort-btn" type="button" data-swing-overview-sort-key="turnoverRatio">量能比${overviewSortLabel('turnoverRatio')}</button></th>
              </tr>
            </thead>
            <tbody>
              ${sortedRows.map((item) => `
                <tr>
                  <td>
                    <button class="text-link swing-board-jump" data-code="${item.board.code}" data-board-code="${item.board.code}" data-target-tab="swing" type="button">${item.board.name}</button>
                  </td>
                  <td class="stage-flow">
                    ${renderStageHistory(item)}
                  </td>
                  <td>
                    <button class="swing-badge transition-badge-filter ${item.transition.tone} ${overviewTransitionFilter.has(item.transition.label) ? 'active' : ''}" type="button" data-swing-transition-option="${item.transition.label}">
                      ${item.transition.label}
                    </button>
                  </td>
                  <td>${item.turnoverRatio === null ? '暂无' : fmt(item.turnoverRatio, 2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
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
    let rankingTab = tabs.querySelector(`[data-detail-tab="${BOARD_RANKING_TAB}"]`);
    if (!rankingTab) {
      rankingTab = document.createElement('button');
      rankingTab.className = 'detail-tab-btn';
      rankingTab.dataset.detailTab = BOARD_RANKING_TAB;
      rankingTab.textContent = '板块排行';
      tab.after(rankingTab);
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
      const anchor = pane.querySelector('.swing-overview-anchor') || pane.querySelector('.detail-tabs-card');
      const html = renderOverviewPanel();
      if (anchor) {
        anchor.insertAdjacentHTML('afterend', html);
      } else {
        pane.insertAdjacentHTML('afterbegin', html);
      }
      return;
    }

    if (state?.detailTab === BOARD_RANKING_TAB) {
      if (pane.querySelector('.board-ranking-panel')) return;
      pane.querySelectorAll('.swing-panel, .swing-overview-panel, .board-ranking-panel').forEach((node) => node.remove());
      const anchor = pane.querySelector('.detail-tabs-card');
      if (anchor) anchor.insertAdjacentHTML('afterend', renderBoardRankingPanel());
      else pane.insertAdjacentHTML('afterbegin', renderBoardRankingPanel());
      return;
    }

    if (state?.detailTab !== SWING_TAB) {
      pane.querySelectorAll('.swing-panel, .swing-overview-panel, .board-ranking-panel').forEach((node) => node.remove());
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
    state.selectedCode = jump.dataset.boardRankingCode || jump.dataset.boardCode || jump.dataset.code || state.selectedCode;
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
    const boardRankingSortButton = event.target.closest?.('[data-swing-board-ranking-sort-key]');
    if (boardRankingSortButton) {
      event.preventDefault();
      const key = boardRankingSortButton.dataset.swingBoardRankingSortKey;
      if (boardRankingSort.key === key) {
        boardRankingSort.direction = boardRankingSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        boardRankingSort = { key, direction: 'desc' };
      }
      document.querySelectorAll('.board-ranking-panel').forEach((node) => node.remove());
      scheduleEnhance();
      return;
    }
    const overviewSortButton = event.target.closest?.('[data-swing-overview-sort-key]');
    if (overviewSortButton) {
      event.preventDefault();
      const key = overviewSortButton.dataset.swingOverviewSortKey;
      if (overviewSort.key === key) {
        overviewSort.direction = overviewSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        overviewSort = { key, direction: 'asc' };
      }
      document.querySelectorAll('.swing-overview-panel').forEach((node) => node.remove());
      scheduleEnhance();
      return;
    }

    const transitionClear = event.target.closest?.('[data-swing-transition-clear]');
    if (transitionClear) {
      event.preventDefault();
      overviewTransitionFilter = new Set();
      document.querySelectorAll('.swing-overview-panel').forEach((node) => node.remove());
      scheduleEnhance();
      return;
    }

    const transitionOption = event.target.closest?.('[data-swing-transition-option]');
    if (transitionOption) {
      event.preventDefault();
      toggleOverviewTransition(transitionOption.dataset.swingTransitionOption);
      return;
    }

    const sortButton = event.target.closest?.('[data-swing-sort-key]');
    if (sortButton) {
      event.preventDefault();
      const key = sortButton.dataset.swingSortKey;
      if (opportunitySort.key === key) {
        opportunitySort.direction = opportunitySort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        opportunitySort = { key, direction: 'asc' };
      }
      const panel = document.querySelector('.swing-panel');
      if (panel) {
        panel.remove();
      }
      scheduleEnhance();
      return;
    }

    const stockSortButton = event.target.closest?.('[data-swing-stock-sort-key]');
    if (stockSortButton) {
      event.preventDefault();
      const key = stockSortButton.dataset.swingStockSortKey;
      if (stockTableSort.key === key) {
        stockTableSort.direction = stockTableSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        stockTableSort = { key, direction: 'desc' };
      }
      document.querySelectorAll('.swing-panel').forEach((node) => node.remove());
      scheduleEnhance();
      return;
    }

    const tab = event.target.closest?.(`[data-detail-tab="${SWING_TAB}"]`);
    if (tab && typeof state !== 'undefined') {
      state.detailTab = SWING_TAB;
      if (typeof render === 'function') render();
      scheduleEnhance();
      return;
    }

    const rankingTab = event.target.closest?.(`[data-detail-tab="${BOARD_RANKING_TAB}"]`);
    if (rankingTab && typeof state !== 'undefined') {
      state.detailTab = BOARD_RANKING_TAB;
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
