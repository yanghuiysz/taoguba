const app = document.querySelector('#app');

const state = {
  page: 'list',
  keyword: '',
  sortKey: 'strength',
  selectedCode: null,
  selectedDate: '',
  stockSortField: 'amount',
  stockSortDirection: 'desc',
  data: null,
  history: [],
};

const number = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无接口';
  return Number(value).toFixed(digits);
};

const money = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无接口';
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${number(n / 100000000, 1)}亿`;
  if (abs >= 10000) return `${number(n / 10000, 1)}万`;
  return number(n, 0);
};

const shortDate = (date) => date ? date.slice(5) : '暂无';

async function loadDashboard(path) {
  const response = await fetch(path);
  const data = await response.json();
  state.data = data;
  state.selectedDate = shortDate(data.date);
  if (!data.plates?.some((sector) => sector.plateCode === state.selectedCode)) {
    state.selectedCode = data.plates?.[0]?.plateCode || null;
  }
}

function sortedSectors() {
  const keyword = state.keyword.trim().toLowerCase();
  const rows = (state.data?.plates || []).filter((sector) => {
    if (!keyword) return true;
    return [sector.plateName, sector.plateCode].join(' ').toLowerCase().includes(keyword);
  });
  return rows.slice().sort((a, b) => (Number(b[state.sortKey]) || -999999) - (Number(a[state.sortKey]) || -999999));
}

function activeSector() {
  const sectors = state.data?.plates || [];
  return sectors.find((sector) => sector.plateCode === state.selectedCode) || sectors[0];
}

function sectorDescription(sector) {
  const limit = sector.limitUpStocks?.length || 0;
  const strong = sector.strongStocks?.length || 0;
  if (limit || strong) return `已关联 ${limit} 只涨停/连板股、${strong} 只强势股`;
  return '当前开盘啦接口未关联到板块内个股';
}

function metricCard(label, value, helper = '', dark = false) {
  return `
    <div class="metric${dark ? ' dark' : ''}">
      <span>${label}</span>
      <strong>${value}</strong>
      ${helper ? `<small>${helper}</small>` : ''}
    </div>
  `;
}

function renderListPage() {
  const sectors = sortedSectors();
  const top = sectors[0];
  const summary = state.data.summary || {};

  app.innerHTML = `
    <div class="stack">
      <section class="card hero-card">
        <div class="hero-row">
          <div>
            <p class="eyebrow">🔥 板块列表页</p>
            <h1>每日强度前 20 板块</h1>
            <p class="muted">这里只负责看板块；点击某个板块进入详情页。数据来自开盘啦可访问接口。</p>
          </div>
          <div class="controls">
            <label class="input-shell">
              <span>搜索</span>
              <input id="keywordInput" value="${state.keyword}" placeholder="搜索板块，如 医药 / 算力">
            </label>
            <label class="select-shell">
              <span>排序</span>
              <select id="sortSelect">
                <option value="strength" ${state.sortKey === 'strength' ? 'selected' : ''}>强度</option>
                <option value="changePercent" ${state.sortKey === 'changePercent' ? 'selected' : ''}>涨幅</option>
                <option value="mainNetAmount" ${state.sortKey === 'mainNetAmount' ? 'selected' : ''}>主力净额</option>
                <option value="largeOrderNetAmount" ${state.sortKey === 'largeOrderNetAmount' ? 'selected' : ''}>大单净额</option>
              </select>
            </label>
            <label class="select-shell">
              <span>日期</span>
              <select id="dateSelect">
                ${state.history.map((item) => `
                  <option value="${item.path}" ${item.date === state.data.date ? 'selected' : ''}>${item.date}</option>
                `).join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="metrics">
          ${metricCard('今日最强板块', top?.plateName || '暂无', `强度 ${number(top?.strength, 0)}`, true)}
          ${metricCard('涨停家数', summary.limitUpStockCount || 0, '已按板块标签归纳')}
          ${metricCard('总成交额', money((state.data.plates || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0)), '用于判断强度是否有资金支撑')}
        </div>
      </section>

      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>板块排行</h2>
            <p class="muted">点击后进入单独详情页</p>
          </div>
          <div class="count-pill">共 ${sectors.length} 个板块</div>
        </div>
        <div class="sector-grid">
          ${sectors.slice(0, 20).map((sector, index) => `
            <button class="sector-card" data-code="${sector.plateCode}">
              <div class="sector-main">
                <div class="sector-left">
                  <div class="rank-box">#${index + 1}</div>
                  <div class="sector-title">
                    <strong>${sector.plateName}</strong>
                    <p>${sectorDescription(sector)}</p>
                    <div class="tags">
                      <span class="tag">涨跌幅 ${number(sector.changePercent)}%</span>
                      <span class="tag">龙头涨停 ${sector.limitUpStocks.length} 家</span>
                      <span class="tag">成交额 ${money(sector.amount)}</span>
                    </div>
                  </div>
                </div>
                <div class="score">
                  <span>强度</span>
                  <strong>${number(sector.strength, 0)}</strong>
                </div>
              </div>
            </button>
          `).join('')}
        </div>
      </section>
    </div>
  `;

  document.querySelector('#keywordInput').addEventListener('input', (event) => {
    state.keyword = event.target.value;
    render();
  });
  document.querySelector('#sortSelect').addEventListener('change', (event) => {
    state.sortKey = event.target.value;
    render();
  });
  document.querySelector('#dateSelect')?.addEventListener('change', async (event) => {
    await loadDashboard(event.target.value);
    render();
  });
  document.querySelectorAll('.sector-card').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCode = button.dataset.code;
      state.selectedDate = shortDate(state.data.date);
      state.page = 'detail';
      render();
    });
  });
}

function sortedLimitRows(sector) {
  const rows = [...(sector.limitUpStocks || [])];
  return rows.sort((a, b) => {
    const av = fieldValue(a, state.stockSortField);
    const bv = fieldValue(b, state.stockSortField);
    if (typeof av === 'number' && typeof bv === 'number') {
      return state.stockSortDirection === 'asc' ? av - bv : bv - av;
    }
    return state.stockSortDirection === 'asc'
      ? String(av).localeCompare(String(bv), 'zh-CN')
      : String(bv).localeCompare(String(av), 'zh-CN');
  });
}

function fieldValue(row, field) {
  if (field === 'reason') return row.reasonTags || '';
  if (field === 'hitTime') return '';
  return Number(row[field]) || 0;
}

function sortButton(label, field) {
  const active = state.stockSortField === field;
  const suffix = active ? (state.stockSortDirection === 'asc' ? ' 升序' : ' 降序') : '';
  return `<button class="sort-btn" data-sort="${field}">${label}${suffix}</button>`;
}

function renderTrendCard(sector) {
  const trend = sector.trend || [];
  const chart = trend.length ? trendChart(trend, sector.plateName) : `
    <div>
      <strong>暂无历史</strong>
      <p>还没有保存到 ${sector.plateName} 的历史快照。每天运行构建脚本后，这里会自动累积近 15 日涨跌幅。</p>
    </div>
  `;
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>近 15 日走势</h2>
          <p class="muted">来自每日保存的开盘啦历史快照，展示板块涨跌幅、强度与涨停家数。</p>
        </div>
        <div class="count-pill">当前选中：${state.selectedDate}</div>
      </div>
      <div class="chart-box">
        ${chart}
      </div>
      <div class="date-row">
        ${state.history.map((item) => `
          <button class="date-btn" data-history-path="${item.path}">${shortDate(item.date)} · ${item.date === state.data.date ? '当前' : '历史'}</button>
        `).join('')}
      </div>
    </section>
  `;
}

function trendChart(trend, plateName) {
  const width = 760;
  const height = 220;
  const pad = { top: 28, right: 34, bottom: 44, left: 48 };
  const values = trend.map((item) => Number(item.change)).filter((value) => !Number.isNaN(value));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, -1);
  const range = max - min || 1;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const points = trend.map((item, index) => {
    const change = Number(item.change) || 0;
    const x = pad.left + (trend.length === 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
    const y = pad.top + ((max - change) / range) * plotHeight;
    return { ...item, change, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const zeroY = pad.top + ((max - 0) / range) * plotHeight;
  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${plateName} 近 15 日涨跌幅">
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <polyline class="trend-line" points="${line}"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.y}" r="5"></circle>
          <text x="${point.x}" y="${point.y - 10}" text-anchor="middle" class="value-label">${number(point.change)}%</text>
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} 涨跌幅 ${number(point.change)}% · 强度 ${number(point.strength, 0)} · 涨停 ${point.limitUps}</title>
        </g>
      `).join('')}
    </svg>
  `;
}

function renderLimitTable(sector) {
  const rows = sortedLimitRows(sector);
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>${state.selectedDate} 涨停数据</h2>
          <p class="muted">字段支持排序：涨停原因、成交额、涨停时间。缺失字段按原位置明示。</p>
        </div>
        <div class="count-pill">当前板块：${sector.plateName}</div>
      </div>
      <div class="warn">涨停时间、首次封板、封单占比、完整长文本涨停原因：当前接口暂无返回。</div>
      <div class="table-wrap" style="margin-top: 12px;">
        <table>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>${sortButton('涨停原因', 'reason')}</th>
              <th>${sortButton('成交额', 'amount')}</th>
              <th>${sortButton('涨停时间', 'hitTime')}</th>
              <th>首次封板</th>
              <th>封单占比</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td class="code">${row.code || '暂无'}</td>
                <td><strong>${row.name || '暂无'}</strong><div class="muted">${row.boardLabel || '暂无接口'}</div></td>
                <td>${row.reasonTags || '暂无接口'}</td>
                <td>${money(row.amount)}</td>
                <td class="missing">暂无接口</td>
                <td class="missing">暂无接口</td>
                <td class="missing">暂无接口</td>
              </tr>
            `).join('') : `<tr><td colspan="7" class="empty">当前接口没有归纳到该板块涨停股</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDetailPage() {
  const sector = activeSector();
  if (!sector) {
    app.innerHTML = '<div class="card section-card empty">暂无开盘啦数据</div>';
    return;
  }

  app.innerHTML = `
    <div class="stack">
      <section class="card detail-head">
        <div class="detail-title">
          <button class="back-btn" id="backBtn">‹</button>
          <div>
            <div class="muted">板块详情页</div>
            <h1>${sector.plateName}</h1>
            <p class="muted">这里单独展示板块走势、每日数据切换以及当日涨停个股明细。</p>
          </div>
        </div>
        <div class="badges">
          <span class="badge">强度 ${number(sector.strength, 0)}</span>
          <span class="badge">涨跌幅 ${number(sector.changePercent)}%</span>
          <span class="badge">龙头涨停 ${sector.limitUpStocks.length} 家</span>
          <span class="badge">成交额 ${money(sector.amount)}</span>
        </div>
      </section>

      ${renderTrendCard(sector)}
      ${renderLimitTable(sector)}
    </div>
  `;

  document.querySelector('#backBtn').addEventListener('click', () => {
    state.page = 'list';
    render();
  });
  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.sort;
      if (state.stockSortField === field) {
        state.stockSortDirection = state.stockSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.stockSortField = field;
        state.stockSortDirection = field === 'hitTime' ? 'asc' : 'desc';
      }
      render();
    });
  });
  document.querySelectorAll('[data-history-path]').forEach((button) => {
    button.addEventListener('click', async () => {
      await loadDashboard(button.dataset.historyPath);
      render();
    });
  });
}

function render() {
  if (state.page === 'detail') renderDetailPage();
  else renderListPage();
}

async function boot() {
  try {
    const indexResponse = await fetch('./data/kpl/index.json');
    const index = await indexResponse.json();
    state.history = index.items || [];
  } catch {
    state.history = [{ date: '', path: './data/kpl_dashboard.json' }];
  }
  const latestPath = state.history[0]?.path || './data/kpl_dashboard.json';
  await loadDashboard(latestPath);
  if (!state.history.length) {
    state.history = [{ date: state.data.date, path: './data/kpl_dashboard.json' }];
  }
  state.selectedCode = state.data.plates?.[0]?.plateCode || null;
  state.selectedDate = shortDate(state.data.date);
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">开盘啦数据加载失败：${error.message}</div>`;
});
