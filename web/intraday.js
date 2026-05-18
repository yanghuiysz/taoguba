(function initIntradayRadar() {
  const app = document.querySelector("#intraday-app");
  const DATA_URL = "./data/custom_boards.json";
  const POSITIONS_URL = "./data/positions.json";

  const state = {
    data: null,
    positions: [],
    auction: null,
    error: "",
    positionError: "",
    auctionError: "",
    opportunitySort: {
      key: "default",
      direction: "desc",
    },
  };
  const INTRADAY_WATCH_TRANSITIONS = new Set([
    "良性回踩转强",
    "退潮转强",
    "恶性回踩修复",
    "弱分歧",
    "进攻分歧",
    "承接观察",
    "进攻增强",
    "进攻延续",
    "恶性转良性",
    "退潮修复",
    "进攻钝化",
    "回踩走弱",
  ]);

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

  function normalizeCode(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits ? digits.slice(-6).padStart(6, "0") : "";
  }

  const formatAmount = (value) => {
    const parsed = safeNumber(value);
    if (parsed === null) return "暂无";
    if (parsed >= 1e8) return `${number(parsed / 1e8, 2)}亿`;
    if (parsed >= 1e4) return `${number(parsed / 1e4, 0)}万`;
    return number(parsed, 0);
  };

  const signedClass = (value) => Number(value) >= 0 ? "rise" : "fall";

  const shortDate = (date) => date ? String(date).slice(5) : "暂无";

  const compactDate = (date) => String(date || "").replace(/\D/g, "").slice(0, 8);

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

  function marketIndexRows() {
    return (state.data?.marketIndex?.trend || []).filter((row) => safeNumber(row?.changePercent) !== null);
  }

  function indexGate() {
    const rows = marketIndexRows();
    const latest = rows.at(-1) || null;
    if (!latest) {
      return {
        light: "yellow",
        tone: "traffic-yellow",
        label: "指数黄灯谨慎",
        action: "数据不足，只能小仓试错",
        score: 45,
        reason: "缺少指数实时数据",
      };
    }

    const latestChange = safeNumber(latest.changePercent) ?? 0;
    const previous = rows.at(-2) || null;
    const previousChange = safeNumber(previous?.changePercent);
    const volumeState = indexVolumeState(rows, latest);
    const volumeExpanded = volumeState.state === "放量";
    const recent3 = rows.slice(-3);
    const downDays3 = recent3.filter((row) => (safeNumber(row.changePercent) ?? 0) < 0).length;
    const return3 = compoundReturn(recent3.map((row) => row.changePercent)) ?? latestChange;
    const fallNarrowed = previousChange !== null && latestChange < 0 && latestChange > previousChange;

    let score = 50;
    if (latestChange >= 0.5) score += 25;
    else if (latestChange >= 0) score += 15;
    else if (latestChange >= -0.5) score += 5;
    else score -= 15;

    if (volumeExpanded && latestChange < 0) score -= 25;
    else if (!volumeExpanded && latestChange < 0) score += 10;
    else if (volumeExpanded && latestChange >= 0) score += 15;

    if (downDays3 >= 2) score -= 15;
    else if (downDays3 === 0) score += 10;

    if (return3 >= 0) score += 10;
    else if (return3 <= -2) score -= 15;

    if (fallNarrowed) score += 8;
    score = clamp(score, 0, 100);

    if (score >= 70) {
      return {
        light: "green",
        tone: "traffic-green",
        label: "指数绿灯",
        action: "允许正常做退潮转强",
        score,
        latest,
        reason: `${percent(latestChange)}，${volumeState.label}，近3日${percent(return3)}`,
      };
    }
    if (score >= 40) {
      const constructive = score >= 55;
      return {
        light: "yellow",
        tone: constructive ? "traffic-yellow-strong" : "traffic-yellow",
        label: constructive ? "指数黄偏绿" : "指数黄灯谨慎",
        action: constructive ? "允许模式内小仓试错" : "只允许小仓观察",
        score,
        latest,
        reason: `${percent(latestChange)}，${volumeState.label}，近3日${percent(return3)}`,
      };
    }
    return {
      light: "red",
      tone: "traffic-red",
      label: "指数红灯",
      action: "禁止买入，只观察逆势强",
      score,
      latest,
      reason: `${percent(latestChange)}，${volumeState.label}，近3日${percent(return3)}`,
    };
  }

  function parseIndexTimestamp(row) {
    const text = String(row?.timestamp || "");
    if (/^\d{14}$/.test(text)) {
      return {
        hour: Number(text.slice(8, 10)),
        minute: Number(text.slice(10, 12)),
      };
    }
    return null;
  }

  function tradingProgressFraction(row) {
    const time = parseIndexTimestamp(row);
    if (!time) return 1;
    const minutes = time.hour * 60 + time.minute;
    const morningStart = 9 * 60 + 30;
    const morningEnd = 11 * 60 + 30;
    const afternoonStart = 13 * 60;
    const close = 15 * 60;
    let traded = 0;
    if (minutes <= morningStart) traded = 0;
    else if (minutes <= morningEnd) traded = minutes - morningStart;
    else if (minutes <= afternoonStart) traded = 120;
    else if (minutes <= close) traded = 120 + minutes - afternoonStart;
    else traded = 240;
    return clamp(traded / 240, 0.05, 1);
  }

  function indexVolumeState(rows, latest) {
    const currentVolume = safeNumber(latest?.volume);
    const previousVolumes = rows.slice(-6, -1).map((row) => safeNumber(row.volume)).filter((value) => value !== null && value > 0);
    const avgVolume = average(previousVolumes);
    if (currentVolume === null || avgVolume === null || avgVolume <= 0) {
      const label = String(latest?.label || "");
      if (label.includes("放量")) return { state: "放量", ratio: null, label: "放量" };
      if (label.includes("缩量")) return { state: "缩量", ratio: null, label: "缩量" };
      return { state: "平量", ratio: null, label: "量能暂无" };
    }
    const progress = tradingProgressFraction(latest);
    const estimatedVolume = currentVolume / progress;
    const ratio = estimatedVolume / avgVolume;
    if (ratio >= 1.05) return { state: "放量", ratio, label: `预估放量 ${number(ratio, 2)}x` };
    if (ratio <= 0.85) return { state: "缩量", ratio, label: `预估缩量 ${number(ratio, 2)}x` };
    return { state: "平量", ratio, label: `预估平量 ${number(ratio, 2)}x` };
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

  function latestRow(board) {
    return trendRows(board).at(-1) || null;
  }

  function parseTimestampText(text) {
    const value = String(text || "");
    if (/^\d{14}$/.test(value)) {
      return {
        hour: Number(value.slice(8, 10)),
        minute: Number(value.slice(10, 12)),
      };
    }
    const matched = value.match(/(\d{2}):(\d{2})/);
    if (matched) {
      return {
        hour: Number(matched[1]),
        minute: Number(matched[2]),
      };
    }
    return null;
  }

  function minutesOfTime(time) {
    if (!time) return null;
    return time.hour * 60 + time.minute;
  }

  function latestBoardTimestamp(row) {
    const stamps = (row?.stocks || [])
      .map((stock) => parseTimestampText(stock.timestamp))
      .filter(Boolean)
      .map(minutesOfTime)
      .filter((value) => value !== null);
    if (!stamps.length) return null;
    const latest = Math.max(...stamps);
    return {
      hour: Math.floor(latest / 60),
      minute: latest % 60,
    };
  }

  function formatClock(time) {
    if (!time) return "暂无";
    return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  }

  function elapsedMinutes(start, end) {
    const startValue = minutesOfTime(start);
    const endValue = minutesOfTime(end);
    if (startValue === null || endValue === null || endValue <= startValue) return null;
    return endValue - startValue;
  }

  function boardAuctionSnapshot(board, sample) {
    const stocks = (board?.stocks || [])
      .map((stock) => sample?.quotes?.[normalizeCode(stock.code)] || null)
      .filter(Boolean);
    if (!stocks.length) return null;
    const changes = stocks.map((stock) => safeNumber(stock.changePercent)).filter((value) => value !== null);
    const turnovers = stocks.map((stock) => safeNumber(stock.turnover)).filter((value) => value !== null);
    if (!changes.length) return null;
    const redCount = changes.filter((value) => value > 0).length;
    return {
      stockCount: changes.length,
      averageChange: average(changes),
      redRate: changes.length ? redCount / changes.length * 100 : null,
      totalTurnover: turnovers.length ? turnovers.reduce((sum, value) => sum + value, 0) : null,
    };
  }

  function accelerationRows() {
    const sample = state.auction?.samples?.at(-1) || null;
    if (!sample || !state.data?.boards?.length) return [];
    const startTime = parseTimestampText(sample.time);

    return state.data.boards
      .map((board) => {
        const currentRow = latestRow(board);
        const auctionRow = boardAuctionSnapshot(board, sample);
        if (!currentRow || !auctionRow) return null;
        const currentAvg = boardChange(currentRow);
        const auctionAvg = safeNumber(auctionRow.averageChange);
        if (currentAvg === null || auctionAvg === null) return null;
        const currentRedRate = redRate(currentRow);
        const auctionRedRate = safeNumber(auctionRow.redRate);
        const currentTurnover = rowTurnover(currentRow);
        const auctionTurnover = safeNumber(auctionRow.totalTurnover);
        const latestTime = latestBoardTimestamp(currentRow);
        const mins = elapsedMinutes(startTime, latestTime);
        const accel = currentAvg - auctionAvg;
        const accelPer10m = mins ? accel / mins * 10 : null;
        const turnoverRatio = currentTurnover !== null && auctionTurnover !== null && auctionTurnover > 0
          ? currentTurnover / auctionTurnover
          : null;
        const score = clamp(
          0.48 * scoreRange(accel, -1, 4)
          + 0.22 * scoreRange(accelPer10m, -0.5, 1.6)
          + 0.18 * scoreRange((currentRedRate ?? 0) - (auctionRedRate ?? 0), -15, 35)
          + 0.12 * scoreRange(turnoverRatio, 1, 18),
          0,
          100,
        );
        const leaders = [...(currentRow.stocks || [])]
          .filter((stock) => safeNumber(stock.changePercent) !== null)
          .sort((a, b) => (safeNumber(b.changePercent) ?? -999) - (safeNumber(a.changePercent) ?? -999))
          .slice(0, 2)
          .map((stock) => `${stock.name} ${percent(stock.changePercent)}`);

        return {
          board,
          sampleTime: startTime,
          latestTime,
          currentRow,
          auctionRow,
          currentAvg,
          auctionAvg,
          accel,
          accelPer10m,
          currentRedRate,
          auctionRedRate,
          turnoverRatio,
          score,
          leaders,
          state: metricWithPrevious(boardMetric(board)).transition,
        };
      })
      .filter((item) =>
        item
        && item.accel >= 0.2
        && (item.currentAvg >= 0.3 || (item.currentRedRate ?? 0) >= 45)
      )
      .sort((a, b) =>
        b.score - a.score
        || b.accel - a.accel
        || (b.currentAvg ?? -999) - (a.currentAvg ?? -999))
      .slice(0, 12);
  }

  function stockTurnoverValue(stock) {
    return safeNumber(stock?.turnover ?? stock?.amount);
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

  function attackQualityMetric(row) {
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) {
      return { score: 0, high5Rate: null, high3Rate: null, redRate: null };
    }
    const high5Rate = stocks.filter((stock) => Number(stock.changePercent) >= 5).length / stocks.length * 100;
    const high3Rate = stocks.filter((stock) => Number(stock.changePercent) >= 3).length / stocks.length * 100;
    const redRateValue = stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
    const score = (
      0.42 * scoreRange(high5Rate, 0, 35)
      + 0.34 * scoreRange(high3Rate, 5, 55)
      + 0.24 * scoreRange(redRateValue, 35, 85)
    );
    return { score: clamp(score, 0, 100), high5Rate, high3Rate, redRate: redRateValue };
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

    if (metric.heatScore < 35 || (excess3 < -2 && redRateToday < 35) || (excess5 < -1 && excess10 < -2)) return "热度退潮";
    if (metric.heatScore >= 65 && latestChange >= 0 && r3 > 0 && excess3 >= 0 && redRateToday >= 50 && backgroundOk) return "主升";
    if (latestChange < 0 && metric.heatScore >= 50 && excess3 >= -0.5 && redRateToday >= 40 && turnoverRatio <= 1.15 && backgroundOk) return "良性回踩";
    if (badPullback) return "恶性回踩";
    if (metric.heatScore >= 55 && latestChange >= 0 && r3 > 0 && excess3 >= -0.5 && backgroundOk) return "启动";
    if (metric.heatScore >= 45 && drawdown3 >= 4) return "高位震荡";
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
    const window3 = boardWindow(board, 3, endIndex);
    const window5 = boardWindow(board, 5, endIndex);
    const window10 = boardWindow(board, 10, endIndex);
    const latestChange = boardChange(latestRow);
    const return3 = window3.boardReturn;
    const return5 = window5.boardReturn;
    const return10 = window10.boardReturn;
    const index3 = window3.indexReturn;
    const index5 = window5.indexReturn;
    const index10 = window10.indexReturn;
    const excess3 = return3 !== null && index3 !== null ? return3 - index3 : null;
    const excess5 = return5 !== null && index5 !== null ? return5 - index5 : null;
    const excess10 = return10 !== null && index10 !== null ? return10 - index10 : null;
    const turnoverRatio = window5.avgTurnover && window5.turnover ? window5.turnover / window5.avgTurnover : null;
    const redRateToday = redRate(latestRow);
    const heatScore = (
      0.28 * scoreRange(latestChange, -3, 6)
      + 0.22 * scoreRange(return3, -3, 8)
      + 0.18 * scoreRange(excess3, -3, 6)
      + 0.14 * scoreRange(redRateToday, 30, 80)
      + 0.10 * scoreRange(window3.redRate, 35, 85)
      + 0.08 * scoreRange(turnoverRatio, 0.75, 1.6)
    );
    const metric = {
      board,
      date: latestRow?.date || "",
      latestRow,
      latestChange,
      return3,
      return5,
      return10,
      index3,
      excess3,
      excess5,
      excess10,
      redRateToday,
      redRate3: window3.redRate,
      redRate5: window5.redRate,
      turnoverRatio,
      drawdown3: window3.drawdown,
      drawdown10: window10.drawdown,
      heatScore: clamp(heatScore, 0, 100),
      attackQuality: attackQualityMetric(latestRow),
    };
    metric.status = boardStatus(metric);
    metric.tone = statusTone(metric.status);
    metric.stage = stageForStatus(metric.status);
    return metric;
  }

  function transitionLabel(metric, previous) {
    if (!previous?.latestRow) return { label: "暂无对比", tone: "watch" };
    const heatDelta = metric.heatScore - previous.heatScore;
    const qualityDelta = metric.attackQuality.score - previous.attackQuality.score;
    if (metric.stage !== previous.stage) {
      const labelMap = {
        "进攻段->良性回踩": { label: "进攻分歧", tone: "test" },
        "进攻段->恶性回踩": { label: "进攻转弱", tone: "weak" },
        "进攻段->退潮段": { label: "进攻退潮", tone: "divergence" },
        "良性回踩->进攻段": { label: "良性回踩转强", tone: "strong" },
        "良性回踩->恶性回踩": { label: "承接失败", tone: "weak" },
        "良性回踩->退潮段": { label: "回踩退潮", tone: "divergence" },
        "恶性回踩->进攻段": { label: "恶性回踩修复", tone: "strong" },
        "恶性回踩->良性回踩": { label: "恶性转良性", tone: "test" },
        "恶性回踩->退潮段": { label: "恶性退潮", tone: "divergence" },
        "退潮段->进攻段": { label: "退潮转强", tone: "strong" },
        "退潮段->良性回踩": { label: "退潮修复", tone: "test" },
        "退潮段->恶性回踩": { label: "退潮反抽失败", tone: "weak" },
      };
      return labelMap[`${previous.stage}->${metric.stage}`] || { label: `${previous.stage}转${metric.stage}`, tone: metric.tone };
    }
    if (metric.stage === "进攻段") {
      if (heatDelta >= 0 && qualityDelta >= 0) return { label: "进攻增强", tone: "strong" };
      if (qualityDelta < -12 && heatDelta < -8) return { label: "进攻钝化", tone: "mixed" };
      if (qualityDelta < -5 || heatDelta < -5) return { label: "弱分歧", tone: "test" };
      return { label: "进攻延续", tone: "strong" };
    }
    if (metric.stage === "良性回踩") {
      if (qualityDelta >= -8 && metric.turnoverRatio <= 1.15) return { label: "承接观察", tone: "test" };
      return { label: "回踩走弱", tone: "mixed" };
    }
    if (metric.stage === "恶性回踩") return { label: "恶化", tone: "weak" };
    return { label: "退潮延续", tone: "divergence" };
  }

  function transitionRank(label) {
    return {
      良性回踩转强: 0,
      退潮转强: 1,
      恶性回踩修复: 2,
      弱分歧: 3,
      进攻分歧: 4,
      承接观察: 5,
      进攻增强: 6,
      进攻延续: 7,
      恶性转良性: 8,
      退潮修复: 9,
      进攻钝化: 10,
      回踩走弱: 11,
    }[label] ?? 99;
  }

  function metricWithPrevious(metric) {
    const previous = boardMetric(metric.board, -1);
    return {
      ...metric,
      previous,
      transition: transitionLabel(metric, previous),
    };
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
      const ret3 = stockReturn(items, 3);
      const ret10 = stockReturn(items, 10);
      const amount3 = items.slice(Math.max(0, items.length - 3))
        .map((item) => stockTurnoverValue(item.stock))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const amount5 = items.slice(Math.max(0, items.length - 5))
        .map((item) => stockTurnoverValue(item.stock))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const boardRet3 = boardReturnForItems(items, 3);
      const boardRet5 = boardReturnForItems(items, 5);
      const boardRet10 = boardReturnForItems(items, 10);
      const rel3 = ret3 !== null && boardRet3 !== null ? ret3 - boardRet3 : null;
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
      // Pick board representatives with a balanced mix of resilience, liquidity, and short-term trend.
      const sortScore = (
        0.20 * clamp(score, 0, 100)
        + 0.50 * scoreRange(amount5, 0, 5000000000)
        + 0.30 * scoreRange(ret5, -5, 18)
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
        rel3,
        rel5,
        rel10,
        latestChange,
        macdLabel: latest?.macdLabel || "MACD暂无",
        macdScore,
        highStatus: latest?.highStatus || stock.latestHighStatus || "",
        score: clamp(score, 0, 100),
        sortScore: clamp(sortScore, 0, 100),
      };
    }).sort((a, b) => b.sortScore - a.sortScore || b.amount5 - a.amount5 || (b.ret5 ?? -999) - (a.ret5 ?? -999));
  }

  function signalTone(signal) {
    if (String(signal || "").includes("红灯")) return "traffic-red";
    if (String(signal || "").includes("黄偏绿")) return "traffic-yellow-strong";
    if (String(signal || "").includes("黄灯")) return "traffic-yellow";
    if (String(signal || "").includes("绿灯")) return "traffic-green";
    if (["良性回踩转强", "退潮转强", "恶性回踩修复", "进攻增强"].includes(signal)) return "strong";
    if (["弱分歧", "进攻分歧", "承接观察", "恶性转良性", "退潮修复", "进攻延续"].includes(signal)) return "test";
    if (["进攻钝化", "回踩走弱"].includes(signal)) return "mixed";
    return "watch";
  }

  function intradayState(metric) {
    const latestChange = metric.latestChange ?? 0;
    const excess3 = metric.excess3 ?? 0;
    const redRateToday = metric.redRateToday ?? 0;
    const drawdown3 = metric.drawdown3 ?? 0;
    const turnoverRatio = metric.turnoverRatio ?? 0;
    const badPullback = latestChange < 0
      && (excess3 < -1 || redRateToday < 35 || drawdown3 > 6 || turnoverRatio > 1.25 || metric.status === "恶性回踩");

    if (badPullback) return { label: "恶性回踩", tone: "weak" };
    if (latestChange < 0 && metric.stage !== "退潮段") return { label: "良性回踩", tone: "test" };
    if (latestChange >= 0 && metric.stage === "进攻段") return { label: "盘中转强", tone: "strong" };
    if (metric.stage === "退潮段") return { label: "退潮走弱", tone: "divergence" };
    return { label: "观察", tone: "watch" };
  }

  function buildTradeSignal(backgroundMetric, currentMetric, currentState, stock, gate) {
    if (!INTRADAY_WATCH_TRANSITIONS.has(currentState.label)) return { signal: "观察", priority: 0 };
    const basePriority = Math.max(2, 12 - transitionRank(currentState.label));
    if (gate?.light === "red") {
      return { signal: `${currentState.label}｜指数红灯观察`, priority: 2 };
    }
    if (gate?.light === "yellow") {
      const gateLabel = gate.label === "指数黄偏绿" ? "指数黄偏绿试错" : "指数黄灯谨慎";
      return { signal: `${currentState.label}｜${gateLabel}`, priority: Math.min(basePriority, 6) };
    }
    return { signal: currentState.label, priority: basePriority };
  }

  function opportunityRows() {
    const gate = indexGate();
    const rows = (state.data?.boards || [])
      .map((board) => ({
        board,
        backgroundMetric: boardMetric(board, -1),
        currentMetric: metricWithPrevious(boardMetric(board)),
      }))
      .filter(({ currentMetric }) => INTRADAY_WATCH_TRANSITIONS.has(currentMetric.transition.label))
      .flatMap(({ board, backgroundMetric, currentMetric }) => stockResilienceRows(board).slice(0, 3).map((stock) => {
        const latestChange = safeNumber(stock.latestChange) ?? 0;
        const rel5 = safeNumber(stock.rel5) ?? 0;
        const rel10 = safeNumber(stock.rel10) ?? 0;
        const currentState = currentMetric.transition;
        const tradeSignal = buildTradeSignal(backgroundMetric, currentMetric, currentState, stock, gate);
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
          indexGate: gate,
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
    const forceExitPrice = safeNumber(position.forceExitPrice);
    const firstBuyLow = safeNumber(position.firstBuyLow ?? position.divergenceLow);
    const effectiveStopPrice = Math.max(forceExitPrice ?? -Infinity, firstBuyLow ?? -Infinity);
    const pressure = safeNumber(position.pressure);
    const currentPrice = safeNumber(context.stock.close);
    const profitPct = cost && currentPrice ? (currentPrice / cost - 1) * 100 : null;
    const currentDate = latestDataDate();
    const holdDays = tradingDayAge(position.entryDate, currentDate);
    const weakStock = (safeNumber(context.stock.changePercent) ?? 0) < 0 || (safeNumber(context.stock.macdScore) ?? 50) <= 35;

    if (currentPrice !== null && effectiveStopPrice !== -Infinity && currentPrice < effectiveStopPrice) {
      const useForceExit = forceExitPrice !== null && effectiveStopPrice === forceExitPrice && (firstBuyLow === null || forceExitPrice >= firstBuyLow);
      return {
        action: useForceExit ? "强制平仓" : "硬止损",
        tone: "weak",
        reason: useForceExit
          ? `跌破强制平仓执行线 ${number(effectiveStopPrice)}`
          : `跌破第一笔低点执行线 ${number(effectiveStopPrice)}`,
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
                    <td>
                      <strong>${position.name || context?.stock?.name || normalizeCode(position.code)}</strong>
                      <span class="code">${normalizeCode(position.code)}</span>
                      <small>第一笔低点 ${position.firstBuyLow === null || position.firstBuyLow === undefined ? "未设" : number(position.firstBuyLow)}</small>
                      <small>强平价 ${position.forceExitPrice === null || position.forceExitPrice === undefined ? "未设" : number(position.forceExitPrice)}</small>
                      <small>执行线 ${position.effectiveStopPrice === null || position.effectiveStopPrice === undefined ? "未设" : number(position.effectiveStopPrice)}</small>
                    </td>
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

  function renderAuctionPanel() {
    const latestDate = latestDataDate();
    const snapshotDate = compactDate(latestDate);
    const auction = state.auction;
    const alerts = auction?.latestAlerts || [];
    const sampleCount = auction?.samples?.length || 0;
    const updatedAt = auction?.updatedAt || auction?.samples?.at(-1)?.time || "";

    if (state.auctionError) {
      return `<section class="card section-card auction-card"><div class="empty">集合竞价预警读取失败：${state.auctionError}</div></section>`;
    }

    if (!auction) {
      return `
        <section class="card section-card auction-card">
          <div class="section-head">
            <div>
              <h2>集合竞价预警</h2>
              <p class="muted">等待 ${snapshotDate || "今日"} 09:15-09:25 采样结果，盘中会保留当天最后一版预警。</p>
            </div>
            <span class="count-pill">暂无快照</span>
          </div>
          <div class="pool-empty">尚未生成集合竞价快照</div>
        </section>
      `;
    }

    return `
      <section class="card section-card auction-card">
        <div class="section-head">
          <div>
            <h2>集合竞价预警</h2>
            <p class="muted">按竞价均涨、红盘率、竞价额共振和锚定股强度筛选超预期板块。</p>
          </div>
          <span class="count-pill">${shortDate(auction.date || latestDate)} / ${sampleCount} 次采样</span>
        </div>

        <div class="auction-meta">
          <span>最新采样：${updatedAt || "暂无"}</span>
          <span>预警板块：${alerts.length}</span>
        </div>

        ${alerts.length ? `
          <div class="auction-grid">
            ${alerts.slice(0, 8).map((alert, index) => {
              const ratio = alert.turnoverRatio === null || alert.turnoverRatio === undefined ? "暂无" : `${number(Number(alert.turnoverRatio) * 100, 2)}%`;
              const stocks = (alert.topStocks || []).slice(0, 3);
              return `
                <article class="auction-board">
                  <div class="auction-board-head">
                    <div>
                      <strong>${index + 1}. ${alert.boardName}</strong>
                      <small>${alert.mode || "暂无结构"}</small>
                    </div>
                    <span class="auction-score">${number(alert.score, 0)}</span>
                  </div>
                  <div class="auction-stats">
                    <span>均涨 <b class="${signedClass(alert.avgChange)}">${percent(alert.avgChange)}</b></span>
                    <span>红盘 <b>${number(alert.redRate, 0)}%</b></span>
                    <span>强股 <b>${alert.strongCount || 0}/${alert.validCount || 0}</b></span>
                    <span>竞价额 <b>${formatAmount(alert.totalTurnover)}</b></span>
                    <span>占5日额 <b>${ratio}</b></span>
                  </div>
                  <div class="auction-stocks">
                    ${stocks.map((stock) => `
                      <span>
                        <strong>${stock.name}</strong>
                        <em class="${signedClass(stock.changePercent)}">${percent(stock.changePercent)}</em>
                        <small>${formatAmount(stock.turnover)} / ${number(stock.score, 0)}分</small>
                      </span>
                    `).join("")}
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        ` : '<div class="pool-empty">当前快照没有达到预警阈值的板块</div>'}
      </section>
    `;
  }

  function renderAccelerationPanel() {
    const rows = accelerationRows();
    const sample = state.auction?.samples?.at(-1) || null;

    if (!sample) {
      return `
        <section class="card section-card acceleration-card">
          <div class="section-head">
            <div>
              <h2>开盘加速板块榜</h2>
              <p class="muted">当前先按“集合竞价到最新盘中”衡量板块加速度，适合验证你说的开盘资金方向。</p>
            </div>
            <span class="count-pill">等待竞价快照</span>
          </div>
          <div class="pool-empty">还没有可用的集合竞价快照，先运行早盘采样后这里才会出榜。</div>
        </section>
      `;
    }

    return `
      <section class="card section-card acceleration-card">
        <div class="section-head">
          <div>
            <h2>开盘加速板块榜</h2>
            <p class="muted">看的是竞价到当前的板块均涨抬升，不是静态涨幅榜。更适合抓开盘后还在继续强化的方向。</p>
          </div>
          <span class="count-pill">${formatClock(parseTimestampText(sample.time))} -> ${formatClock(rows[0]?.latestTime || null)}</span>
        </div>

        <div class="auction-meta">
          <span>上榜板块：${rows.length}</span>
          <span>竞价快照：${formatClock(parseTimestampText(sample.time))}</span>
          <span>口径：竞价均涨 -> 当前均涨</span>
        </div>

        ${rows.length ? `
          <div class="table-wrap acceleration-table">
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>板块</th>
                  <th>竞价均涨</th>
                  <th>当前均涨</th>
                  <th>加速值</th>
                  <th>10分钟斜率</th>
                  <th>红盘率变化</th>
                  <th>成交放大</th>
                  <th>当前节奏</th>
                  <th>前排个股</th>
                  <th>加速分</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((item, index) => `
                  <tr>
                    <td><strong>${index + 1}</strong></td>
                    <td class="intraday-board-cell"><strong>${item.board.name}</strong><span class="code">${item.board.code}</span></td>
                    <td class="${signedClass(item.auctionAvg)}">${percent(item.auctionAvg)}</td>
                    <td class="${signedClass(item.currentAvg)}">${percent(item.currentAvg)}</td>
                    <td class="${signedClass(item.accel)}"><strong>${item.accel >= 0 ? "+" : ""}${number(item.accel)}%</strong></td>
                    <td class="${signedClass(item.accelPer10m)}">${item.accelPer10m === null ? "暂无" : `${item.accelPer10m >= 0 ? "+" : ""}${number(item.accelPer10m)}%`}</td>
                    <td class="${signedClass((item.currentRedRate ?? 0) - (item.auctionRedRate ?? 0))}">
                      ${item.currentRedRate === null || item.auctionRedRate === null ? "暂无" : `${number(item.auctionRedRate, 0)}% -> ${number(item.currentRedRate, 0)}%`}
                    </td>
                    <td>${item.turnoverRatio === null ? "暂无" : `${number(item.turnoverRatio, 1)}x`}</td>
                    <td><span class="swing-badge ${item.state.tone}">${item.state.label}</span></td>
                    <td class="trade-text">${item.leaders.length ? item.leaders.join(" / ") : "暂无"}</td>
                    <td><strong>${number(item.score, 0)}</strong></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : '<div class="pool-empty">当前没有满足条件的开盘加速板块，说明竞价后的强化还不明显。</div>'}
      </section>
    `;
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
    const gate = indexGate();
    const signalBase = (signal) => String(signal || "").split("｜")[0];
    const focusCount = rows.filter((item) => ["良性回踩转强", "退潮转强", "恶性回踩修复", "弱分歧", "进攻分歧", "承接观察"].includes(signalBase(item.signal))).length;
    const secondaryCount = rows.filter((item) => ["进攻增强", "进攻延续", "恶性转良性", "退潮修复"].includes(signalBase(item.signal))).length;
    const cautiousCount = rows.filter((item) => ["进攻钝化", "回踩走弱"].includes(signalBase(item.signal))).length;
    const latestDate = latestDataDate();
    const backgroundDate = rows[0]?.backgroundMetric?.date || "";
    const updatedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });

    app.innerHTML = `
      ${renderPositionsPanel()}
      ${renderAuctionPanel()}
      ${renderAccelerationPanel()}
      <section class="card section-card swing-overview-panel">
        <div class="section-head">
          <div>
            <h2>盘中机会雷达</h2>
            <p class="muted">按热门板块波段观察的变化结论筛板块，每个板块只取 3 个核心股。</p>
          </div>
          <span class="count-pill">背景 ${shortDate(backgroundDate)} / 盘中 ${shortDate(latestDate)}</span>
        </div>

        <div class="intraday-summary">
          <div class="setup-metric"><span>指数闸门</span><strong class="state-chip ${gate.tone}">${gate.label}</strong><small>${gate.action}</small></div>
          <div class="setup-metric"><span>闸门分</span><strong>${number(gate.score, 0)}</strong><small>${gate.reason}</small></div>
          <div class="setup-metric"><span>机会数</span><strong>${rows.length}</strong><small>当前入选</small></div>
          <div class="setup-metric"><span>重点</span><strong>${focusCount}</strong><small>优先观察</small></div>
          <div class="setup-metric"><span>次重点</span><strong>${secondaryCount}</strong><small>跟踪观察</small></div>
          <div class="setup-metric"><span>谨慎</span><strong>${cautiousCount}</strong><small>只看核心</small></div>
          <div class="setup-metric"><span>数据时间</span><strong>${shortDate(latestDate)}</strong><small>${updatedAt} 刷新页面</small></div>
        </div>

        <div class="intraday-toolbar">
          <p class="muted">顶部定时刷新只会重载本页，避免盘中反复刷新其他看板。</p>
          <span class="intraday-time">自动刷新：交易时段每 1 分钟</span>
        </div>

        ${rows.length ? `
          <div class="table-wrap swing-intraday-table intraday-table">
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th><button class="table-sort-btn" type="button" data-sort-key="board">板块${sortLabel("board")}</button></th>
                  <th>昨日阶段</th>
                  <th>变化结论</th>
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
    try {
      const auctionDate = compactDate(latestDataDate());
      if (auctionDate) {
        const auctionResponse = await fetch(`./data/auction_snapshots/${auctionDate}.json?v=${Date.now()}`, { cache: "no-store" });
        if (auctionResponse.ok) {
          state.auction = await auctionResponse.json();
          state.auctionError = "";
        } else if (auctionResponse.status === 404) {
          state.auction = null;
          state.auctionError = "";
        } else {
          throw new Error(`HTTP ${auctionResponse.status}`);
        }
      }
    } catch (error) {
      state.auction = null;
      state.auctionError = error.message || String(error);
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
