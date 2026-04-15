const summaryMetrics = document.querySelector("#summaryMetrics");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const rankList = document.querySelector("#rankList");
const detailPanel = document.querySelector("#detailPanel");
const stockPanel = document.querySelector("#stockPanel");
const listCount = document.querySelector("#listCount");

const state = {
  data: null,
  rows: [],
  selectedSeq: null,
};

const formatNumber = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
};

const stockText = (value) => value || "未记录";

const limitUpRepresentatives = (item) => {
  const names = Array.isArray(item.limitUpStockNames) ? item.limitUpStockNames.filter(Boolean) : [];
  if (names.length) return names;
  return item.dayDragon ? [item.dayDragon] : [];
};

function renderSummary(rows) {
  const totalLimitUps = rows.reduce((sum, item) => sum + (item.limitUpStocks || 0), 0);
  const maxRate = Math.max(...rows.map((item) => item.materialRate || 0));
  const dateEl = document.querySelector(".eyebrow");
  if (dateEl && state.data) {
    dateEl.textContent = `${state.data.date} · 自动历史榜`;
  }
  summaryMetrics.innerHTML = `
    <div class="metric"><span>板块</span><strong>${rows.length}</strong></div>
    <div class="metric"><span>涨停参考</span><strong>${totalLimitUps || "—"}</strong></div>
    <div class="metric"><span>最强涨幅</span><strong>${formatNumber(maxRate)}%</strong></div>
  `;
}

function filteredRows() {
  const keyword = searchInput.value.trim().toLowerCase();
  let rows = state.rows.filter((item) => {
    if (!keyword) return true;
    return [item.materialName, item.middleTroops, item.dayDragon, item.humanDragon]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });

  const sortKey = sortSelect.value;
  return rows.slice().sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
}

function selectRow(materialSeq) {
  state.selectedSeq = materialSeq;
  render();
}

function renderRankList(rows) {
  listCount.textContent = rows.length;
  rankList.innerHTML = rows.map((item, index) => {
    const active = item.materialSeq === state.selectedSeq ? " active" : "";
    return `
      <button class="rank-item${active}" data-seq="${item.materialSeq}">
        <span class="rank-num">${index + 1}</span>
        <span class="rank-main">
          <strong>${item.materialName}</strong>
          <small>${formatNumber(item.materialRate)}% · ${item.limitUpStocks || "—"} 只涨停</small>
        </span>
        <span class="rank-hot">${item.limitUpStocks ?? "—"} 板</span>
      </button>
    `;
  }).join("");
}

function chartMarkup(item) {
  const history = item.history || [];
  if (!history.length) {
    return `<div class="empty-history">暂无多日数据</div>`;
  }

  const points = history.slice().reverse();
  const rates = points.map((row) => row.materialRate || 0);
  const maxRate = Math.max(...rates, 1);
  const minRate = Math.min(...rates, -1);
  const range = maxRate - minRate || 1;
  const width = 760;
  const height = 220;
  const padding = { top: 30, right: 34, bottom: 48, left: 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const coords = points.map((row, index) => {
    const x = padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const y = padding.top + ((maxRate - (row.materialRate || 0)) / range) * plotHeight;
    return { ...row, x, y };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const zeroY = padding.top + ((maxRate - 0) / range) * plotHeight;
  const marks = coords.map((point) => {
    const isNegative = (point.materialRate || 0) < 0;
    const labelY = point.y + (isNegative ? 22 : -10);
    return `
      <g class="chart-point">
        <circle cx="${point.x}" cy="${point.y}" r="5"></circle>
        <text class="value-label" x="${point.x}" y="${labelY}" text-anchor="middle">${formatNumber(point.materialRate)}%</text>
        <text class="date-label" x="${point.x}" y="${height - 16}" text-anchor="middle">${point.date.slice(5)}</text>
        <title>${point.date} | ${formatNumber(point.materialRate)}% | 中军 ${stockText(point.middleTroops)} | 涨停 ${stockText(point.dayDragon)}</title>
      </g>
    `;
  }).join("");

  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${item.materialName} 多日题材涨幅">
      <line class="zero-line" x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}"></line>
      <polyline class="rate-line" points="${line}"></polyline>
      ${marks}
    </svg>
  `;
}

function renderDetail(item) {
  detailPanel.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="detail-label">板块</p>
        <h2>${item.materialName}</h2>
        <p class="detail-sub">ID ${item.materialSeq}</p>
      </div>
      <div class="strength">${formatNumber(item.materialRate)}%</div>
    </div>

    <div class="detail-metrics">
      <div><span>中军</span><strong>${stockText(item.middleTroops)}</strong></div>
      <div><span>涨停参考</span><strong>${item.limitUpStocks ?? "—"}</strong></div>
      <div><span>人气龙</span><strong>${stockText(item.humanDragon)}</strong></div>
    </div>

    <section class="chart-section">
      <div class="section-title">多日强度</div>
      ${chartMarkup(item)}
    </section>

    <section class="history-section">
      <div class="section-title">逐日记录</div>
      <div class="history-table">
        ${(item.history || []).map((row) => `
          <div class="history-row">
            <strong>${row.date}</strong>
            <span>${formatNumber(row.materialRate)}%</span>
            <span>中军 ${stockText(row.middleTroops)}</span>
            <span>涨停 ${stockText(row.dayDragon)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function stockBlock(title, value, helper) {
  return `
    <div class="stock-block">
      <span>${title}</span>
      <strong>${stockText(value)}</strong>
      <small>${helper}</small>
    </div>
  `;
}

function limitUpRepresentativeBlock(item) {
  const names = limitUpRepresentatives(item);
  const sourceText = "公开历史源只提供日内代表股，不提供完整涨停池";
  const body = names.length
    ? `<div class="limit-up-list">${names.map((name) => `<span>${name}</span>`).join("")}</div>`
    : `<strong>未记录</strong>`;
  return `
    <div class="stock-block limit-up-block">
      <span>涨停代表</span>
      ${body}
      <small>${sourceText}</small>
    </div>
  `;
}

function renderStocks(item) {
  stockPanel.innerHTML = `
    ${stockBlock("中军", item.middleTroops, "板块容量与趋势锚点")}
    ${limitUpRepresentativeBlock(item)}
    ${stockBlock("人气龙", item.humanDragon, "市场辨识度核心")}
    <div class="stock-note">当前自动化只使用淘股吧公开静态历史源；完整涨停股列表需要签名 App 明细接口，已排除在流程外。</div>
  `;
}

function render() {
  const rows = filteredRows();
  if (!rows.some((row) => row.materialSeq === state.selectedSeq)) {
    state.selectedSeq = rows[0]?.materialSeq || null;
  }
  renderSummary(rows);
  renderRankList(rows);

  const selected = rows.find((row) => row.materialSeq === state.selectedSeq);
  if (!selected) {
    detailPanel.innerHTML = '<div class="empty">没有匹配的题材</div>';
    stockPanel.innerHTML = "";
    return;
  }
  renderDetail(selected);
  renderStocks(selected);

  rankList.querySelectorAll(".rank-item").forEach((button) => {
    button.addEventListener("click", () => selectRow(button.dataset.seq));
  });
}

async function boot() {
  const response = await fetch("./data/dashboard.json");
  state.data = await response.json();
  state.rows = state.data.top10;
  state.selectedSeq = state.rows[0]?.materialSeq || null;
  render();
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);

boot().catch((error) => {
  detailPanel.innerHTML = `<div class="empty">数据加载失败：${error.message}</div>`;
});
