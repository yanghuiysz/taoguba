(function installCustomDecisionView() {
  if (window.__customDecisionViewInstalled) return;
  window.__customDecisionViewInstalled = true;

  let scheduled = false;
  let enhancing = false;
  let overviewSort = {
    key: 'default',
    direction: 'desc',
  };
  let overviewTransitionFilter = new Set();

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

  function fmtDelta(value, digits = 0) {
    const parsed = safeNumber(value);
    if (parsed === null) return '暂无';
    return `${parsed >= 0 ? '+' : ''}${fmt(parsed, digits)}`;
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

  function rows(board) {
    if (typeof trendValues === 'function') return trendValues(board);
    return (board?.trend || []).filter((row) => row?.averageChange !== null && row?.averageChange !== undefined);
  }

  function selectedIndex(trendRows, offset = 0) {
    if (!trendRows.length) return -1;
    let index = trendRows.length - 1;
    if (state?.sortDate) {
      const selected = trendRows.findIndex((row) => row.date === state.sortDate);
      if (selected >= 0) index = selected;
    }
    return Math.max(0, Math.min(trendRows.length - 1, index + offset));
  }

  function rowsToSelected(board, days, offset = 0) {
    const trendRows = rows(board);
    const end = selectedIndex(trendRows, offset);
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

  function attackQualityMetric(row) {
    const stocks = (row?.stocks || []).filter((stock) => safeNumber(stock.changePercent) !== null);
    if (!stocks.length) return { score: 0, high5Rate: null, high3Rate: null, redRate: null };
    const high5Rate = stocks.filter((stock) => Number(stock.changePercent) >= 5).length / stocks.length * 100;
    const high3Rate = stocks.filter((stock) => Number(stock.changePercent) >= 3).length / stocks.length * 100;
    const redRateValue = stocks.filter((stock) => Number(stock.changePercent) > 0).length / stocks.length * 100;
    const score = clampValue(
      0.42 * scoreRange(high5Rate, 0, 35)
      + 0.34 * scoreRange(high3Rate, 5, 55)
      + 0.24 * scoreRange(redRateValue, 35, 85),
      0,
      100,
    );
    return { score, high5Rate, high3Rate, redRate: redRateValue };
  }

  function stageForStatus(status) {
    if (['主升', '启动', '二波观察'].includes(status)) return '进攻段';
    if (status === '良性回踩') return '良性回踩';
    if (status === '恶性回踩') return '恶性回踩';
    return '退潮段';
  }

  function stageRank(stage) {
    return {
      进攻段: 0,
      良性回踩: 1,
      恶性回踩: 2,
      退潮段: 3,
    }[stage] ?? 9;
  }

  function transitionLabel(metric, previous) {
    if (!previous?.latestRow) return { label: '暂无对比', tone: 'watch' };
    const heatDelta = metric.heatScore - previous.heatScore;
    const qualityDelta = metric.attackQuality.score - previous.attackQuality.score;
    if (metric.stage !== previous.stage) {
      if (metric.stage === '退潮段' || metric.stage === '恶性回踩') return { label: `${previous.stage}转弱`, tone: 'risk' };
      if (metric.stage === '进攻段') return { label: `${previous.stage}转强`, tone: 'strong' };
      return { label: `${previous.stage}转${metric.stage}`, tone: metric.action.tone };
    }
    if (metric.stage === '进攻段') {
      if (heatDelta >= 0 && qualityDelta >= 0) return { label: '进攻增强', tone: 'strong' };
      if (qualityDelta < -12 && heatDelta < -8) return { label: '进攻钝化', tone: 'risk' };
      if (qualityDelta < -5 || heatDelta < -5) return { label: '弱分歧', tone: 'test' };
      return { label: '进攻延续', tone: 'strong' };
    }
    if (metric.stage === '良性回踩') return { label: qualityDelta >= -8 ? '承接观察' : '回踩走弱', tone: qualityDelta >= -8 ? 'test' : 'risk' };
    if (metric.stage === '恶性回踩') return { label: '恶化', tone: 'risk' };
    return { label: '退潮延续', tone: 'risk' };
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

  function metricWithPrevious(metric) {
    const previous = boardDecisionMetric(metric.board, -1);
    const stageHistory = [-4, -3, -2, -1, 0].map((offset) => boardDecisionMetric(metric.board, offset));
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
    if (overviewSort.key === 'transition') {
      const direction = overviewSort.direction === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) =>
        direction * (transitionRank(a.transition.label) - transitionRank(b.transition.label))
        || b.decisionScore - a.decisionScore
        || b.attackQuality.score - a.attackQuality.score);
    }
    return [...rows].sort((a, b) =>
      stageRank(a.stage) - stageRank(b.stage)
      || b.decisionScore - a.decisionScore
      || b.attackQuality.score - a.attackQuality.score);
  }

  function transitionFilterOptions(rows) {
    const labels = [...new Set(rows.map((item) => item.transition.label))]
      .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    return [
      ...labels.map((label) => `<option value="${label}" ${overviewTransitionFilter.has(label) ? 'selected' : ''}>${label}</option>`),
    ].join('');
  }

  function renderStageHistory(metric) {
    return metric.stageHistory.map((item) => `<span class="decision-badge ${toneFor(item.status, item.heatScore)}">${item.stage}</span>`).join('<span class="stage-arrow">-&gt;</span>');
  }

  function boardDecisionMetric(board, offset = 0) {
    const recent3 = rowsToSelected(board, 3, offset);
    const recent5 = rowsToSelected(board, 5, offset);
    const recent10 = rowsToSelected(board, 10, offset);
    const recent20 = rowsToSelected(board, 20, offset);
    const latestRow = recent20.at(-1) || null;
    const latestChange = boardChange(board, latestRow);
    const return3 = compoundReturn(recent3.map((row) => boardChange(board, row)));
    const return5 = compoundReturn(recent5.map((row) => boardChange(board, row)));
    const return10 = compoundReturn(recent10.map((row) => boardChange(board, row)));
    const index3 = compoundReturn(recent3.map((row) => indexChange(row.date)));
    const index5 = compoundReturn(recent5.map((row) => indexChange(row.date)));
    const index10 = compoundReturn(recent10.map((row) => indexChange(row.date)));
    const excess3 = return3 !== null && index3 !== null ? return3 - index3 : null;
    const excess5 = return5 !== null && index5 !== null ? return5 - index5 : null;
    const excess10 = return10 !== null && index10 !== null ? return10 - index10 : null;
    const redRateToday = redRate(latestRow);
    const redRate3 = average(recent3.map(redRate));
    const redRate5 = average(recent5.map(redRate));
    const changes3 = recent3.map((row) => boardChange(board, row));
    const changes10 = recent10.map((row) => boardChange(board, row));
    const drawdown3 = maxDrawdown(changes3);
    const drawdown10 = maxDrawdown(changes10);
    const turnoverNow = latestRow ? rowTurnoverValue(latestRow) : null;
    const avgTurnover5 = average(recent5.map(rowTurnoverValue));
    const turnoverRatio = turnoverNow !== null && avgTurnover5 ? turnoverNow / avgTurnover5 : null;
    const attackQuality = attackQualityMetric(latestRow);

    const heatScore = clampValue(
      0.28 * scoreRange(latestChange, -3, 6)
      + 0.22 * scoreRange(return3, -3, 8)
      + 0.18 * scoreRange(excess3, -3, 6)
      + 0.14 * scoreRange(redRateToday, 30, 80)
      + 0.10 * scoreRange(redRate3, 35, 85)
      + 0.08 * scoreRange(turnoverRatio, 0.75, 1.6),
      0,
      100,
    );

    const trend = trendMetricFromChanges(recent20.map((row) => boardChange(board, row)));
    const pullback = pullbackMetric(latestChange, turnoverNow, average(recent10.slice(0, -1).map(rowTurnoverValue)));
    const positionScore = Math.round(0.65 * trend.score + 0.35 * pullback.score);
    const decisionScore = Math.round(0.60 * heatScore + 0.40 * positionScore);

    let status = '趋势走弱';
    const backgroundOk = ((excess5 ?? 0) >= 0) || ((return5 ?? 0) > 0) || ((excess10 ?? 0) > 1);
    const badPullback = (latestChange ?? 0) < 0
      && heatScore >= 35
      && ((excess3 ?? 0) < -1 || (redRateToday ?? 0) < 35 || drawdown3 > 6 || (pullback.ratio ?? 0) > 1.25);
    if (heatScore < 35 || ((excess3 ?? 0) < -2 && (redRateToday ?? 0) < 35) || ((excess5 ?? 0) < -1 && (excess10 ?? 0) < -2)) status = '热度退潮';
    else if (heatScore >= 65 && (latestChange ?? 0) >= 0 && (return3 ?? 0) > 0 && (excess3 ?? 0) >= 0 && (redRateToday ?? 0) >= 50 && backgroundOk) status = '主升';
    else if ((latestChange ?? 0) < 0 && heatScore >= 50 && (excess3 ?? 0) >= -0.5 && (redRateToday ?? 0) >= 40 && (pullback.ratio ?? 0) <= 1.15 && backgroundOk) status = '良性回踩';
    else if (badPullback) status = '恶性回踩';
    else if (heatScore >= 55 && (latestChange ?? 0) >= 0 && (return3 ?? 0) > 0 && (excess3 ?? 0) >= -0.5 && backgroundOk) status = '启动';
    else if (heatScore >= 45 && drawdown3 >= 4) status = '高位震荡';

    const action = actionFor({ decisionScore, status, trend, pullback, excess10 });
    return {
      board,
      latestRow,
      latestChange,
      return3,
      return5,
      return10,
      excess3,
      excess5,
      excess10,
      redRateToday,
      redRate3,
      redRate5,
      drawdown3,
      drawdown10,
      turnoverRatio,
      heatScore,
      attackQuality,
      trend,
      pullback,
      positionScore,
      decisionScore,
      status,
      stage: stageForStatus(status),
      action,
    };
  }

  function toneFor(text, score = 0) {
    if (String(text).includes('风险') || String(text).includes('退潮') || String(text).includes('恶性') || String(text).includes('放量下跌')) return 'risk';
    if (String(text).includes('主升') || String(text).includes('均线多头') || score >= 80) return 'strong';
    if (String(text).includes('良性') || String(text).includes('缩量') || score >= 65) return 'test';
    if (String(text).includes('二波') || String(text).includes('修复')) return 'turn';
    if (String(text).includes('弱')) return 'weak';
    return 'watch';
  }

  function actionFor(metric) {
    if (metric.status === '热度退潮' || metric.status === '恶性回踩' || metric.pullback.label === '放量下跌') return { label: '暂时回避', tone: 'risk' };
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
      const ret3 = compoundReturn(changes.slice(-3));
      const ret5 = compoundReturn(changes.slice(-5));
      const ret10 = compoundReturn(changes.slice(-10));
      const boardRet3 = compoundReturn(items.slice(-3).map((item) => boardChange(board, item.row)));
      const boardRet5 = compoundReturn(items.slice(-5).map((item) => boardChange(board, item.row)));
      const boardRet10 = compoundReturn(items.slice(-10).map((item) => boardChange(board, item.row)));
      const rel3 = ret3 !== null && boardRet3 !== null ? ret3 - boardRet3 : null;
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
      const amount5 = items.slice(-5)
        .map((item) => stockTurnoverValue(item.stock))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
      const amount3 = items.slice(-3)
        .map((item) => stockTurnoverValue(item.stock))
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
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
      const sortScore = clampValue(
        0.58 * scoreRange(amount5, 0, 5000000000)
        + 0.42 * scoreRange(ret5, -5, 18),
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
        ret3,
        rel5,
        rel10,
        rel3,
        amount3,
        amount5,
        drawdown,
        trendLabel,
        trendScore,
        pullback,
        macdLabel,
        macdScore,
        resilienceScore,
        sortScore,
        action,
      };
    }).sort((a, b) => b.sortScore - a.sortScore || b.amount5 - a.amount5 || (b.rel5 ?? -999) - (a.rel5 ?? -999));
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
              <span class="decision-badge ${toneFor(metric.status, metric.heatScore)}">${metric.stage}</span>
              <span class="decision-badge ${toneFor(metric.trend.label, metric.trend.score)}">${metric.trend.label}</span>
              <span class="decision-badge ${toneFor(metric.pullback.label, metric.pullback.score)}">${metric.pullback.label}</span>
              <span class="decision-action ${metric.action.tone}">${metric.action.label}</span>
            </div>
          </div>
          <div class="decision-score-number">${fmt(metric.decisionScore, 0)}</div>
        </div>

        <div class="decision-metrics">
          ${metricCard('短线热度', fmt(metric.heatScore, 0), '今日/3日强度')}
          ${metricCard('进攻质量', fmt(metric.attackQuality.score, 0), `5%占比 ${fmtPercent(metric.attackQuality.high5Rate, 0)}`)}
          ${metricCard('3日超额', fmtPercent(metric.excess3), '板块 - 指数', changeClass(metric.excess3))}
          ${metricCard('今日红盘率', metric.redRateToday === null ? '暂无' : fmtPercent(metric.redRateToday, 0), '内部扩散')}
          ${metricCard('趋势确认', metric.trend.label, `趋势分 ${fmt(metric.trend.score, 0)}`)}
          ${metricCard('回踩状态', metric.pullback.label, `量比 ${metric.pullback.ratio === null ? '暂无' : fmt(metric.pullback.ratio, 2)}`)}
          ${metricCard('3日回撤', fmtPercent(metric.drawdown3), '短线风险')}
        </div>

        <div class="decision-section-title">
          <strong>韧性股 Top 10</strong>
          <span>只保留决策需要的核心列</span>
        </div>
        <div class="table-wrap decision-stock-table">
          <table>
            <thead>
              <tr>
                <th>排名</th><th>股票</th><th>综合排序</th><th>3日成交额</th><th>5日成交额</th><th>3日涨幅</th><th>5日涨幅</th><th>3日相对板块</th><th>5日相对板块</th><th>趋势</th><th>MACD</th><th>回踩</th><th>操作标签</th>
              </tr>
            </thead>
            <tbody>
              ${stocks.map((item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${item.name}</strong><br><span class="code">${item.code}</span></td>
                  <td><strong>${fmt(item.sortScore, 0)}</strong></td>
                  <td>${typeof amountText === 'function' ? amountText(item.amount3) : fmt(item.amount3 / 100000000, 2) + '亿'}</td>
                  <td>${typeof amountText === 'function' ? amountText(item.amount5) : fmt(item.amount5 / 100000000, 2) + '亿'}</td>
                  <td class="${changeClass(item.ret3)}">${fmtPercent(item.ret3)}</td>
                  <td class="${changeClass(item.ret5)}">${fmtPercent(item.ret5)}</td>
                  <td class="${changeClass(item.rel3)}">${fmtPercent(item.rel3)}</td>
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
          <p>波段综合分 = 短线热度 60% + 位置分 40%。短线热度看今日、3日涨幅、3日超额、今日红盘率、3日红盘率和量能；5/10日只作为背景确认。个股韧性分看相对板块强度、回撤、趋势和回踩状态。</p>
        </details>
      </section>
    `;
  }

  function overviewBuckets() {
    const metrics = (state?.data?.boards || [])
      .map(boardDecisionMetric)
      .filter((metric) => metric.latestRow)
      .map(metricWithPrevious)
      .filter((metric) => metric.stage !== '退潮段');
    return {
      baseRows: metrics,
      rows: sortOverviewRows(metrics.filter((metric) => overviewTransitionFilter.size === 0 || overviewTransitionFilter.has(metric.transition.label))),
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
    const { baseRows, rows } = overviewBuckets();
    return `
      <section class="card section-card decision-overview-panel">
        <div class="section-head">
          <div><h2>今日波段决策总览</h2><p class="muted">表格展示四段、短线热度、进攻质量和关键证据，点击板块进入波段决策。</p></div>
          <span class="count-pill">表格版</span>
        </div>
        <div class="table-wrap decision-overview-table">
          <table>
            <thead>
              <tr>
                <th>板块</th>
                <th>四段变化</th>
                <th>
                  <div class="column-filter">
                    <button class="table-sort-btn" type="button" data-decision-overview-sort-key="transition">变化结论${overviewSortLabel('transition')}</button>
                    <select class="overview-filter" data-decision-transition-filter multiple size="1" title="按变化结论筛选">
                      ${transitionFilterOptions(baseRows)}
                    </select>
                  </div>
                </th>
                <th>短线热度</th>
                <th>进攻质量</th>
                <th>今日涨幅</th>
                <th>3日超额</th>
                <th>量能比</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((metric) => `
                <tr>
                  <td>
                    <button class="decision-board-item decision-board-link" data-board-code="${metric.board.code}" type="button">
                      <strong>${metric.board.name}</strong>
                    </button>
                  </td>
                  <td class="stage-flow">
                    ${renderStageHistory(metric)}
                    <br><small>${metric.stageHistory.map((item) => item.latestRow?.date ? String(item.latestRow.date).slice(5) : '暂无').join(' -> ')}</small>
                  </td>
                  <td><span class="decision-action ${metric.transition.tone}">${metric.transition.label}</span></td>
                  <td><strong>${fmt(metric.heatScore, 0)}</strong><br><small class="${deltaClass(metric.heatDelta)}">${fmtDelta(metric.heatDelta, 0)}</small></td>
                  <td><strong>${fmt(metric.attackQuality.score, 0)}</strong><br><small class="${deltaClass(metric.qualityDelta)}">${fmtDelta(metric.qualityDelta, 0)}</small></td>
                  <td class="${changeClass(metric.latestChange)}">${fmtPercent(metric.latestChange)}<br><small class="${deltaClass(metric.changeDelta)}">${fmtDelta(metric.changeDelta, 2)}</small></td>
                  <td class="${changeClass(metric.excess3)}">${fmtPercent(metric.excess3)}</td>
                  <td>${metric.turnoverRatio === null ? '暂无' : fmt(metric.turnoverRatio, 2)}</td>
                  <td><span class="decision-action ${metric.action.tone}">${metric.action.label}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
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
    const sortButton = event.target.closest?.('[data-decision-overview-sort-key]');
    if (sortButton) {
      event.preventDefault();
      const key = sortButton.dataset.decisionOverviewSortKey;
      if (overviewSort.key === key) {
        overviewSort.direction = overviewSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        overviewSort = { key, direction: 'asc' };
      }
      document.querySelectorAll('.decision-overview-panel').forEach((node) => node.remove());
      scheduleEnhance();
      return;
    }

    const item = event.target.closest?.('.decision-board-item');
    if (item && typeof state !== 'undefined') {
      state.selectedCode = item.dataset.boardCode || state.selectedCode;
      state.detailTab = 'swing';
      if (typeof render === 'function') render();
      scheduleEnhance();
    }
  }, true);

  document.addEventListener('change', (event) => {
    const filter = event.target.closest?.('[data-decision-transition-filter]');
    if (!filter) return;
    overviewTransitionFilter = new Set([...filter.selectedOptions].map((option) => option.value).filter(Boolean));
    document.querySelectorAll('.decision-overview-panel').forEach((node) => node.remove());
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
