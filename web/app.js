const board = document.querySelector("#topicBoard");
const summaryMetrics = document.querySelector("#summaryMetrics");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");

const formatNumber = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
};

const stockText = (value) => value || "无";

const state = {
  data: null,
  rows: [],
};

function renderSummary(rows) {
  const totalLimitUps = rows.reduce((sum, item) => sum + (item.limitUpStocks || 0), 0);
  const maxHot = Math.max(...rows.map((item) => item.popularValue || 0));
  const maxRate = Math.max(...rows.map((item) => item.materialRate || 0));
  const dateEl = document.querySelector(".eyebrow");
  if (dateEl && state.data) {
    dateEl.textContent = `${state.data.date} · 自动历史榜`;
  }
  summaryMetrics.innerHTML = `
    <div class="metric"><span>题材数量</span><strong>${rows.length}</strong></div>
    <div class="metric"><span>涨停参考</span><strong>${totalLimitUps || "—"}</strong></div>
    <div class="metric"><span>最高热度</span><strong>${formatNumber(maxHot)}</strong></div>
    <div class="metric"><span>最高涨幅</span><strong>${formatNumber(maxRate)}%</strong></div>
  `;
}

function historyMarkup(item) {
  const history = item.history || [];
  if (!history.length) {
    return `
      <div class="history">
        <span class="history-title">多日题材跟踪</span>
        <div class="empty-history">暂无历史</div>
      </div>
    `;
  }

  const points = history
    .slice()
    .reverse();
  const rates = points.map((row) => row.materialRate || 0);
  const maxRate = Math.max(...rates, 1);
  const minRate = Math.min(...rates, -1);
  const range = maxRate - minRate || 1;
  const width = 620;
  const height = 180;
  const padding = { top: 26, right: 28, bottom: 42, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const coords = points.map((row, index) => {
    const x = padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const y = padding.top + ((maxRate - (row.materialRate || 0)) / range) * plotHeight;
    return { ...row, x, y };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const zeroY = padding.top + ((maxRate - 0) / range) * plotHeight;
  const marks = coords
    .map((point) => {
      const isNegative = (point.materialRate || 0) < 0;
      const labelY = point.y + (isNegative ? 20 : -10);
      return `
        <g class="chart-point">
          <circle cx="${point.x}" cy="${point.y}" r="4.5"></circle>
          <text class="value-label" x="${point.x}" y="${labelY}" text-anchor="middle">${formatNumber(point.materialRate)}%</text>
          <text class="date-label" x="${point.x}" y="${height - 14}" text-anchor="middle">${point.date.slice(5)}</text>
          <title>${point.date} 题材涨幅 ${formatNumber(point.materialRate)}% | 中军 ${stockText(point.middleTroops)} | 日内龙 ${stockText(point.dayDragon)}</title>
        </g>
      `;
    })
    .join("");

  return `
    <div class="history">
      <span class="history-title">多日题材跟踪</span>
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${item.materialName} 多日题材涨幅折线图">
        <line class="zero-line" x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}"></line>
        <polyline class="rate-line" points="${line}"></polyline>
        ${marks}
      </svg>
      <div class="history-detail">
        ${history.map((row) => `
          <div class="history-day">
            <strong>${row.date}</strong>
            <span>${formatNumber(row.materialRate)}% · 中军 ${stockText(row.middleTroops)} · 日内龙 ${stockText(row.dayDragon)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function cardMarkup(item) {
  return `
    <article class="topic-card">
      <div class="topic-head">
        <div class="topic-title">
          <div class="rank">${item.rank}</div>
          <div>
            <h2 class="topic-name">${item.materialName}</h2>
            <p class="topic-id">materialSeq ${item.materialSeq}</p>
          </div>
        </div>
        <div class="badge">${item.limitUpStocks || 0} 只涨停</div>
      </div>

      <div class="data-grid">
        <div class="data-point"><span>题材涨幅</span><strong>${formatNumber(item.materialRate)}%</strong></div>
        <div class="data-point"><span>热度值</span><strong>${formatNumber(item.popularValue)}</strong></div>
        <div class="data-point"><span>新事件</span><strong>${item.newEventNum || 0}</strong></div>
      </div>

      <div class="stock-lines">
        <div class="stock-line"><span>中军</span><strong>${stockText(item.middleTroops)}</strong></div>
        <div class="stock-line"><span>代表涨停</span><strong>${stockText(item.dayDragon)}</strong></div>
        <div class="stock-line"><span>人气龙</span><strong>${stockText(item.humanDragon)}</strong></div>
      </div>

      ${historyMarkup(item)}
    </article>
  `;
}

function filteredRows() {
  const keyword = searchInput.value.trim().toLowerCase();
  let rows = state.rows.filter((item) => {
    if (!keyword) return true;
    const text = [item.materialName, item.middleTroops, item.dayDragon, item.humanDragon]
      .join(" ")
      .toLowerCase();
    return text.includes(keyword);
  });

  const sortKey = sortSelect.value;
  if (sortKey !== "rank") {
    rows = rows.slice().sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  }
  return rows;
}

function render() {
  const rows = filteredRows();
  renderSummary(rows);
  board.innerHTML = rows.length ? rows.map(cardMarkup).join("") : '<p class="empty">没有匹配的题材</p>';
}

async function boot() {
  const response = await fetch("./data/dashboard.json");
  state.data = await response.json();
  state.rows = state.data.top10;
  render();
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);

boot().catch((error) => {
  board.innerHTML = `<p class="empty">数据加载失败：${error.message}</p>`;
});
