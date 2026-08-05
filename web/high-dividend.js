const DATA_URL = "./data/high_dividend/latest.json";
const STATES = ["可关注", "等待", "偏贵", "风险观察", "数据不足"];
const stateRank = Object.fromEntries(STATES.map((state, index) => [state, index]));
let payload = {stocks: [], summary: {states: {}, pools: {}}};
let pool = "stable", selectedCode = null, sortKey = "fitScore", sortDirection = -1;
const el = (id) => document.getElementById(id);
const pct = (value) => value == null ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
const money = (value) => value == null ? "—" : `¥${Number(value).toFixed(2)}`;
const number = (value, digits = 1) => value == null ? "—" : Number(value).toFixed(digits);
const signedPct = (value) => value == null ? "—" : `${Number(value) > 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;
const safe = (value, fallback = "—") => value == null || value === "" ? fallback : String(value);

function statePill(state) { return `<span class="state-pill state-${state}">${state}</span>`; }
function signalPill(signal) { return `<span class="signal-pill signal-${signal}">${safe(signal)}</span>`; }
function peZone(percentile) { if (percentile == null) return "—"; if (percentile <= 30) return "历史偏低"; if (percentile <= 70) return "历史中位"; return "历史偏高"; }
function renderSummary() {
  el("summary").innerHTML = STATES.map(state => `<article class="summary-card"><b>${payload.summary.states?.[state] || 0}</b><span>${state}</span></article>`).join("");
  const bond = payload.bond || {};
  el("bond-card").innerHTML = `<small>中国10年期国债</small><br><strong>${pct(bond.yield)}</strong><br><small>${safe(bond.date)} · 股息估值基准</small>`;
  el("data-note").textContent = `快照 ${safe(payload.date)} · 生成 ${safe(payload.generatedAt)} · 共 ${payload.summary.total || 0} 只`;
}
function setFilterOptions() {
  el("status-filter").innerHTML = '<option value="">全部状态</option>' + STATES.map(x => `<option>${x}</option>`).join("");
  const industries = [...new Set(payload.stocks.map(x => x.industry).filter(Boolean))].sort();
  el("industry-filter").innerHTML = '<option value="">全部行业</option>' + industries.map(x => `<option>${x}</option>`).join("");
}
function filteredStocks() {
  const query = el("search-input").value.trim().toLowerCase();
  const status = el("status-filter").value, industry = el("industry-filter").value, watch = el("watch-only").checked;
  return payload.stocks.filter(s => s.pool === pool && (!query || `${s.name}${s.code}`.toLowerCase().includes(query)) && (!status || s.state === status) && (!industry || s.industry === industry) && (!watch || s.watchlisted)).sort((a, b) => {
    const av = sortKey === "state" ? stateRank[a.state] : sortKey === "tSignal" ? a.technicalGuide?.signal : a[sortKey];
    const bv = sortKey === "state" ? stateRank[b.state] : sortKey === "tSignal" ? b.technicalGuide?.signal : b[sortKey];
    if (av == null) return 1; if (bv == null) return -1;
    return (typeof av === "string" ? av.localeCompare(bv, "zh-CN") : av - bv) * sortDirection;
  });
}
function reasonText(stock) { return (stock.reasons || []).slice(0, 2).join(" · ") || "暂无判断原因"; }
function renderList() {
  const stocks = filteredStocks();
  el("result-count").textContent = `${stocks.length} 只`;
  el("stock-rows").innerHTML = stocks.length ? stocks.map(s => `<tr data-code="${s.code}" class="${selectedCode === s.code ? "selected" : ""}">
    <td class="name-cell"><b>${safe(s.name)}</b><small>${s.code} · ${safe(s.industry)}</small></td>
    <td class="yield-compare"><b>${pct(s.currentYield)}</b><small>目标 ${pct(s.targetYield)}</small></td><td class="distance-cell ${Number(s.distanceToAttention) <= 0 ? "inside" : "outside"}">${signedPct(s.distanceToAttention)}</td><td class="pe-position"><b>${number(s.peTtm)}</b><small>${number(s.pePercentile5y, 0)}% · ${peZone(s.pePercentile5y)}</small></td><td><b class="fit-score">${number(s.fitScore)}</b><small class="fit-label">${safe(s.fitLabel)}</small></td>
    <td>${signalPill(s.technicalGuide?.signal)}</td><td>${statePill(s.state)}<div><small class="muted">${reasonText(s)}</small></div></td>
  </tr>`).join("") : '<tr><td colspan="7" class="empty-row">当前筛选没有结果</td></tr>';
  el("stock-cards").innerHTML = stocks.map(s => `<article class="stock-card" data-code="${s.code}"><div class="stock-card-top"><b>${safe(s.name)} <small>${s.code}</small></b>${statePill(s.state)}</div><div class="stock-card-metrics"><span>股息 ${pct(s.currentYield)} / ${pct(s.targetYield)}</span><span>距关注价 ${signedPct(s.distanceToAttention)}</span><span>PE ${number(s.peTtm)}</span><span>综合 ${number(s.fitScore)}</span></div>${signalPill(s.technicalGuide?.signal)} <small class="muted">${reasonText(s)}</small></article>`).join("");
  document.querySelectorAll("[data-code]").forEach(node => node.addEventListener("click", () => selectStock(node.dataset.code)));
}
function tGuidance(stock) {
  const guide = stock.technicalGuide || {};
  if (guide.signal === "低吸观察") return `价格接近20日支撑 ${money(guide.support20)}。只考虑用交易仓分批低吸，若有效跌破支撑则停止操作。`;
  if (guide.signal === "高抛观察") return `价格接近20日压力 ${money(guide.resistance20)} 或 RSI 偏高。只考虑减交易仓，不动长期底仓。`;
  if (guide.signal === "持有等待") return `当前位于支撑与压力之间，不追涨、不频繁交易，等待靠近 ${money(guide.support20)} 或 ${money(guide.resistance20)}。`;
  return "技术数据不足，不提供做 T 辅助。";
}
function selectStock(code) {
  selectedCode = code; const s = payload.stocks.find(x => x.code === code); if (!s) return; renderList();
  const guide = s.technicalGuide || {};
  const errors = (payload.errors || []).length ? `<div class="warning-banner">${payload.errors.join("；")}</div>` : "";
  el("stock-detail").innerHTML = `${errors}<div class="detail-head"><div><small>${safe(s.industry)} · ${s.pool === "stable" ? "稳定收息池" : "周期高息池"}</small><h2>${safe(s.name)} <small>${s.code}</small></h2></div><div>${statePill(s.state)} <button id="watch-button" class="pool-tab">${s.watchlisted ? "移出观察" : "加入观察"}</button></div></div>
  <section class="decision-banner"><div><span>综合适配分</span><b>${number(s.fitScore)}</b><small>${safe(s.fitLabel)}</small></div><p>${reasonText(s)}</p></section>
  <section class="detail-section"><h3>股息与估值</h3><div class="metric-grid"><div class="metric"><span>最新价</span><b>${money(s.price)}</b></div><div class="metric"><span>当前股息率</span><b>${pct(s.currentYield)}</b></div><div class="metric"><span>目标股息率</span><b>${pct(s.targetYield)}</b></div><div class="metric"><span>市盈率 TTM</span><b>${number(s.peTtm)}</b></div><div class="metric"><span>PE近5年分位</span><b>${number(s.pePercentile5y, 0)}%</b><small>${peZone(s.pePercentile5y)}</small></div><div class="metric"><span>近5年PE区间</span><b>${number(s.peHistoryLow5y)}–${number(s.peHistoryHigh5y)}</b></div><div class="metric"><span>市净率</span><b>${number(s.pb)}</b></div><div class="metric"><span>质量分</span><b>${number(s.qualityScore, 0)}</b></div></div><p class="muted">估值日期 ${safe(s.valuationDate)}，样本 ${safe(s.peHistorySamples5y)} 个交易日。分位越低代表相对自身历史越便宜，不代表绝对安全；周期股低 PE 仍可能处于盈利高点。</p></section>
  <section class="detail-section t-guide"><div class="section-title"><h3>做 T 辅助</h3>${signalPill(guide.signal)}</div><p>${tGuidance(s)}</p><div class="metric-grid"><div class="metric"><span>20日支撑</span><b>${money(guide.support20)}</b></div><div class="metric"><span>20日压力</span><b>${money(guide.resistance20)}</b></div><div class="metric"><span>MA20 / MA60</span><b>${money(guide.ma20)} / ${money(guide.ma60)}</b></div><div class="metric"><span>RSI14</span><b>${number(guide.rsi14)}</b></div><div class="metric"><span>20日波动</span><b>${pct(guide.volatility20)}</b></div><div class="metric"><span>技术日期</span><b>${safe(guide.asOf)}</b></div></div><div class="risk-note">纪律：底仓与交易仓分开；交易仓建议不超过该股计划仓位的 20%–30%；A股实行 T+1，当日买入不能当日卖出；区间会随每日行情变化。</div></section>
  <section class="detail-section"><h3>质量检查</h3><div class="check-list">${(s.checks || []).map(c => `<div class="check-item check-${c.status}"><b>${c.label}</b><span>${c.reason}</span></div>`).join("") || '<p class="muted">暂无可用检查项</p>'}</div></section>
  <section class="detail-section"><h3>近年每股分红</h3><p>${(s.dividends || []).map((v, i) => `${(s.dividendYears || [])[i] || "—"}：${money(v)}`).join("　") || "—"}</p></section>
  <section class="detail-section"><h3>股息率价格阶梯</h3><table class="ladder"><thead><tr><th>目标股息率</th><th>参考价格</th></tr></thead><tbody>${(s.yieldLadder || []).map(x => `<tr><td>${pct(x.yield)}</td><td>${money(x.price)}</td></tr>`).join("") || '<tr><td colspan="2">数据不足</td></tr>'}</tbody></table></section>
  <section class="detail-section"><h3>数据口径</h3><p class="muted">行情 ${safe(guide.asOf || payload.date)} · 国债 ${safe(payload.bond?.date)} · 财务 ${safe(payload.source?.financialAsOf)} · 分红 ${safe(payload.source?.dividendAsOf)}</p></section>`;
  el("watch-button").addEventListener("click", () => setWatchlist(s, !s.watchlisted));
}
async function setWatchlist(stock, enabled) {
  const response = await fetch("/api/high-dividend/config", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: enabled ? "add" : "remove", code: stock.code})});
  if (!response.ok) throw new Error("观察名单保存失败，请使用可编辑服务启动看板");
  stock.watchlisted = enabled; selectStock(stock.code);
}
function bind() {
  document.querySelectorAll(".pool-tab[data-pool]").forEach(btn => btn.addEventListener("click", () => {pool = btn.dataset.pool; document.querySelectorAll(".pool-tab[data-pool]").forEach(x => x.classList.toggle("active", x === btn)); selectedCode = null; renderList();}));
  ["search-input", "status-filter", "industry-filter", "watch-only"].forEach(id => el(id).addEventListener(id === "search-input" ? "input" : "change", renderList));
  document.querySelectorAll("th[data-sort]").forEach(th => th.addEventListener("click", () => {sortDirection = sortKey === th.dataset.sort ? -sortDirection : th.dataset.sort === "fitScore" ? -1 : 1; sortKey = th.dataset.sort; renderList();}));
}
async function init() {
  try {const response = await fetch(DATA_URL, {cache: "no-store"}); if (!response.ok) throw new Error(`HTTP ${response.status}`); payload = await response.json(); renderSummary(); setFilterOptions(); bind(); renderList(); const first = filteredStocks()[0]; if (first) selectStock(first.code);}
  catch (error) {document.body.innerHTML = `<main class="dividend-shell"><div class="warning-banner">高股息快照读取失败：${error.message}</div></main>`;}
}
init();
