const DATA_URL = "./data/high_dividend/latest.json";
const STATES = ["可关注", "等待", "偏贵", "风险观察", "数据不足"];
const stateRank = Object.fromEntries(STATES.map((state,index)=>[state,index]));
let payload={stocks:[],summary:{states:{},pools:{}}},pool="stable",selectedCode=null,sortKey="state",sortDirection=1;
const el=(id)=>document.getElementById(id);
const pct=(v)=>v==null?"—":`${(Number(v)*100).toFixed(2)}%`;
const money=(v)=>v==null?"—":`¥${Number(v).toFixed(2)}`;
const safe=(v,fallback="—")=>v==null||v===""?fallback:String(v);

function statePill(state){return `<span class="state-pill state-${state}">${state}</span>`}
function renderSummary(){
  el("summary").innerHTML=STATES.map(state=>`<article class="summary-card"><b>${payload.summary.states?.[state]||0}</b><span>${state}</span></article>`).join("");
  const bond=payload.bond||{};el("bond-card").innerHTML=`<small>中国10年期国债</small><br><strong>${pct(bond.yield)}</strong><br><small>${safe(bond.date)} · 双锚估值基准</small>`;
  el("data-note").textContent=`快照 ${safe(payload.date)} · 生成 ${safe(payload.generatedAt)} · 共 ${payload.summary.total||0} 只`;
}
function setFilterOptions(){
  el("status-filter").innerHTML='<option value="">全部状态</option>'+STATES.map(x=>`<option>${x}</option>`).join("");
  const industries=[...new Set(payload.stocks.map(x=>x.industry).filter(Boolean))].sort();
  el("industry-filter").innerHTML='<option value="">全部行业</option>'+industries.map(x=>`<option>${x}</option>`).join("");
}
function filteredStocks(){
  const query=el("search-input").value.trim().toLowerCase(),status=el("status-filter").value,industry=el("industry-filter").value,watch=el("watch-only").checked;
  return payload.stocks.filter(s=>s.pool===pool&&(!query||`${s.name}${s.code}`.toLowerCase().includes(query))&&(!status||s.state===status)&&(!industry||s.industry===industry)&&(!watch||s.watchlisted)).sort((a,b)=>{
    const av=sortKey==="state"?stateRank[a.state]:a[sortKey],bv=sortKey==="state"?stateRank[b.state]:b[sortKey];
    if(av==null)return 1;if(bv==null)return-1;return (typeof av==="string"?av.localeCompare(bv,"zh-CN"):av-bv)*sortDirection;
  });
}
function reasonText(s){return (s.reasons||[]).slice(0,2).join(" · ")||"暂无判断原因"}
function renderList(){
  const stocks=filteredStocks();el("result-count").textContent=`${stocks.length} 只`;
  el("stock-rows").innerHTML=stocks.length?stocks.map(s=>`<tr data-code="${s.code}" class="${selectedCode===s.code?'selected':''}"><td class="name-cell"><b>${safe(s.name)}</b><small>${s.code} · ${safe(s.industry)}</small></td><td>${pct(s.currentYield)}</td><td>${pct(s.targetYield)}</td><td>${s.qualityScore==null?'—':Number(s.qualityScore).toFixed(0)}</td><td>${pct(s.distanceToAttention)}</td><td>${statePill(s.state)}<div><small class="muted">${reasonText(s)}</small></div></td></tr>`).join(""):'<tr><td colspan="6" class="empty-row">当前筛选没有结果</td></tr>';
  el("stock-cards").innerHTML=stocks.map(s=>`<article class="stock-card" data-code="${s.code}"><div class="stock-card-top"><b>${safe(s.name)} <small>${s.code}</small></b>${statePill(s.state)}</div><div class="stock-card-metrics"><span>当前 ${pct(s.currentYield)}</span><span>目标 ${pct(s.targetYield)}</span><span>质量 ${safe(s.qualityScore)}</span></div><small class="muted">${reasonText(s)}</small></article>`).join("");
  document.querySelectorAll("[data-code]").forEach(node=>node.addEventListener("click",()=>selectStock(node.dataset.code)));
}
function selectStock(code){selectedCode=code;const s=payload.stocks.find(x=>x.code===code);if(!s)return;renderList();
  const errors=(payload.errors||[]).length?`<div class="warning-banner">${payload.errors.join("；")}</div>`:"";
  el("stock-detail").innerHTML=`${errors}<div class="detail-head"><div><small>${safe(s.industry)} · ${s.pool==='stable'?'稳定收息池':'周期高息池'}</small><h2>${safe(s.name)} <small>${s.code}</small></h2></div><div>${statePill(s.state)} <button id="watch-button" class="pool-tab">${s.watchlisted?'移出观察':'加入观察'}</button></div></div>
  <section class="detail-section"><h3>当前判断原因</h3><ul class="reason-list">${(s.reasons||[]).map(x=>`<li>${x}</li>`).join("")}</ul></section>
  <section class="detail-section"><div class="metric-grid"><div class="metric"><span>最新价</span><b>${money(s.price)}</b></div><div class="metric"><span>当前股息率</span><b>${pct(s.currentYield)}</b></div><div class="metric"><span>目标股息率</span><b>${pct(s.targetYield)}</b></div><div class="metric"><span>正常化分红</span><b>${money(s.normalizedDividend)}</b></div><div class="metric"><span>目标关注价</span><b>${money(s.attentionPrice)}</b></div><div class="metric"><span>质量分</span><b>${safe(s.qualityScore)}</b></div></div></section>
  <section class="detail-section"><h3>质量检查</h3><div class="check-list">${(s.checks||[]).map(c=>`<div class="check-item check-${c.status}"><b>${c.label}</b><span>${c.reason}</span></div>`).join("")||'<p class="muted">暂无可用检查项</p>'}</div></section>
  <section class="detail-section"><h3>近年每股分红</h3><p>${(s.dividends||[]).map((v,i)=>`${(s.dividendYears||[])[i]||'—'}：${money(v)}`).join("　")||"—"}</p></section>
  <section class="detail-section"><h3>股息率价格阶梯</h3><table class="ladder"><thead><tr><th>目标股息率</th><th>参考价格</th></tr></thead><tbody>${(s.yieldLadder||[]).map(x=>`<tr><td>${pct(x.yield)}</td><td>${money(x.price)}</td></tr>`).join("")||'<tr><td colspan="2">数据不足</td></tr>'}</tbody></table></section>
  <section class="detail-section"><h3>数据口径</h3><p class="muted">价格 ${safe(payload.date)} · 国债 ${safe(payload.bond?.date)} · 财务 ${safe(payload.source?.financialAsOf)} · 分红 ${safe(payload.source?.dividendAsOf)}</p></section>`;
  el("watch-button").addEventListener("click",()=>setWatchlist(s,!s.watchlisted));
}
async function setWatchlist(stock, enabled){
  const response=await fetch("/api/high-dividend/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:enabled?"add":"remove",code:stock.code})});
  if(!response.ok)throw new Error("观察名单保存失败，请使用可编辑服务启动看板");
  stock.watchlisted=enabled;selectStock(stock.code);
}
function bind(){document.querySelectorAll(".pool-tab").forEach(btn=>btn.addEventListener("click",()=>{pool=btn.dataset.pool;document.querySelectorAll(".pool-tab").forEach(x=>x.classList.toggle("active",x===btn));selectedCode=null;renderList();}));["search-input","status-filter","industry-filter","watch-only"].forEach(id=>el(id).addEventListener(id==="search-input"?"input":"change",renderList));document.querySelectorAll("th[data-sort]").forEach(th=>th.addEventListener("click",()=>{sortDirection=sortKey===th.dataset.sort?-sortDirection:1;sortKey=th.dataset.sort;renderList();}));}
async function init(){try{const response=await fetch(DATA_URL,{cache:"no-store"});if(!response.ok)throw new Error(`HTTP ${response.status}`);payload=await response.json();renderSummary();setFilterOptions();bind();renderList();const first=filteredStocks()[0];if(first)selectStock(first.code);}catch(error){document.body.innerHTML=`<main class="dividend-shell"><div class="warning-banner">高股息快照读取失败：${error.message}</div></main>`;}}
init();
