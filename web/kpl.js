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
  historyData: new Map(),
};

const number = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无接口';
  return Number(value).toFixed(digits);
};

const EXCLUDED_SECTOR_PATTERNS = [
  /^ST/i,
  /摘帽/,
  /一季报/,
  /一季度/,
  /半年报/,
  /三季报/,
  /年报/,
  /业绩预/,
  /预增/,
];

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
  state.historyData.set(path, data);
  state.selectedDate = shortDate(data.date);
  if (!sortedSectors().some((sector) => sector.plateCode === state.selectedCode)) {
    state.selectedCode = sortedSectors()[0]?.plateCode || null;
  }
}

async function preloadHistoryData() {
  const items = state.history.slice(0, 15);
  await Promise.all(items.map(async (item) => {
    if (!item.path || state.historyData.has(item.path)) return;
    try {
      const response = await fetch(item.path);
      state.historyData.set(item.path, await response.json());
    } catch {
      state.historyData.set(item.path, null);
    }
  }));
}

function sortedSectors() {
  const keyword = state.keyword.trim().toLowerCase();
  const rows = (state.data?.plates || []).filter((sector) => {
    if (isExcludedSector(sector)) return false;
    if (!keyword) return true;
    return [sector.plateName, sector.plateCode].join(' ').toLowerCase().includes(keyword);
  });
  return rows.slice().sort((a, b) => (Number(b[state.sortKey]) || -999999) - (Number(a[state.sortKey]) || -999999));
}

function isExcludedSector(sector) {
  const name = String(sector?.plateName || '');
  return EXCLUDED_SECTOR_PATTERNS.some((pattern) => pattern.test(name));
}

function excludedSectorCount() {
  return (state.data?.plates || []).filter(isExcludedSector).length;
}

function activeSector() {
  const sectors = sortedSectors();
  return sectors.find((sector) => sector.plateCode === state.selectedCode) || sectors[0];
}

function sectorDescription(sector) {
  const external = sector.externalLimitMapping?.limitUpStocks?.length || 0;
  const strong = sector.strongStocks?.length || 0;
  if (external) return `外部映射 ${external} 只涨停股，强势股 ${strong} 只`;
  if (strong) return `已关联 ${strong} 只强势股`;
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
  const sector = activeSector();

  app.innerHTML = `
    <div class="workspace-layout">
      <aside class="card sidebar-card">
        <div class="sidebar-head">
          <div>
            <h2>板块排行</h2>
            <p class="muted">点击左侧板块，右侧查看详情</p>
          </div>
          <div class="count-pill">显示 ${sectors.length} 个，已过滤 ${excludedSectorCount()} 个</div>
        </div>
        <div class="sidebar-controls">
          <label class="input-shell">
            <span>搜索</span>
            <input id="keywordInput" value="${state.keyword}" placeholder="板块名 / 代码">
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
        <div class="sector-list">
          ${sectors.map((item, index) => `
            <button class="sidebar-sector${item.plateCode === sector?.plateCode ? ' active' : ''}" data-code="${item.plateCode}">
              <span class="sidebar-rank">#${index + 1}</span>
              <span class="sidebar-title">
                <strong>${item.plateName}</strong>
                <small>${sectorDescription(item)}</small>
              </span>
              <span class="sidebar-score">
                <small>强度</small>
                <strong>${number(item.strength, 0)}</strong>
              </span>
            </button>
          `).join('')}
        </div>
      </aside>
      <main class="detail-pane">
        ${renderDetailContent(sector)}
      </main>
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
    await preloadHistoryData();
    render();
  });
  document.querySelectorAll('.sidebar-sector').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCode = button.dataset.code;
      state.selectedDate = shortDate(state.data.date);
      render();
    });
  });
  bindDetailEvents();
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

function timeText(value) {
  const text = String(value || '').padStart(6, '0');
  if (!/^\d{6}$/.test(text) || text === '000000') return '暂无接口';
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`;
}

function conceptText(row) {
  const concepts = row.matchedConcepts || [];
  if (!concepts.length) return '暂无映射';
  return concepts.map((item) => `${item.name} · ${matchTypeText(item.matchType)}`).join(' / ');
}

function matchTypeText(value) {
  const labels = {
    exact: '同名',
    alias: '关联',
    name_contains: '包含',
    industry_or_concept: '行业/题材',
  };
  return labels[value] || value || '未知';
}

function historyItems() {
  return state.history.slice(0, 15);
}

function findHistorySector(target, data) {
  const sectors = data?.plates || [];
  return sectors.find((sector) => sector.plateCode === target.plateCode)
    || sectors.find((sector) => sector.plateName === target.plateName);
}

function sectorTrendFromHistory(sector) {
  return historyItems()
    .map((item) => {
      const historySector = findHistorySector(sector, state.historyData.get(item.path));
      if (!historySector) return null;
      const rows = historySector.externalLimitMapping?.limitUpStocks || historySector.limitUpStocks || [];
      return {
        date: item.date || historySector.date,
        change: historySector.changePercent,
        strength: historySector.strength,
        limitUps: rows.length,
      };
    })
    .filter(Boolean)
    .reverse();
}

function externalLimitHistory(sector) {
  return historyItems().map((item) => {
    const data = state.historyData.get(item.path);
    const historySector = findHistorySector(sector, data);
    return {
      date: item.date,
      sector: historySector,
      mapping: historySector?.externalLimitMapping || null,
    };
  });
}

function renderTrendCard(sector) {
  const trend = sectorTrendFromHistory(sector);
  const chart = trend.length ? trendChart(trend, sector.plateName) : `
    <div>
      <strong>暂无历史</strong>
      <p>近 15 个快照里还没有匹配到 ${sector.plateName} 的历史数据。</p>
    </div>
  `;
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>近 15 日走势</h2>
          <p class="muted">来自每日保存的开盘啦历史快照，展示板块涨跌幅、强度与涨停家数。</p>
        </div>
        <div class="count-pill">有数据：${trend.length}/${historyItems().length} 天</div>
      </div>
      <div class="chart-box">
        ${chart}
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

function renderExternalRows(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>匹配概念</th>
            <th>涨跌幅</th>
            <th>连板数</th>
            <th>首次封板</th>
            <th>最后封板</th>
            <th>封板资金</th>
            <th>炸板次数</th>
            <th>所属行业</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td class="code">${row.code || '暂无'}</td>
              <td><strong>${row.name || '暂无'}</strong><div class="muted">${row.limitStats || '暂无统计'}</div></td>
              <td>${conceptText(row)}</td>
              <td class="${Number(row.changePercent) >= 0 ? 'rise' : 'fall'}">${number(row.changePercent)}%</td>
              <td>${row.consecutiveBoards ?? '暂无接口'}</td>
              <td>${timeText(row.firstSealTime)}</td>
              <td>${timeText(row.lastSealTime)}</td>
              <td>${money(row.sealAmount)}</td>
              <td>${row.openCount ?? '暂无接口'}</td>
              <td>${row.industry || '暂无接口'}</td>
            </tr>
          `).join('') : `<tr><td colspan="10" class="empty">没有通过同花顺概念和东财涨停池映射到涨停股</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderStrongStocksTable(sector) {
  const rows = [...(sector.strongStocks || [])].sort((a, b) => (Number(b.changePercent) || 0) - (Number(a.changePercent) || 0));
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>KPL 关联强势股</h2>
          <p class="muted">来自开盘啦股票排行字段，按行业或题材标签与当前板块关联。</p>
        </div>
        <div class="count-pill">${rows.length} 只</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>题材标签</th>
              <th>涨跌幅</th>
              <th>成交额</th>
              <th>换手率</th>
              <th>板型</th>
              <th>行业</th>
              <th>匹配方式</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td class="code">${row.code || '暂无'}</td>
                <td><strong>${row.name || '暂无'}</strong><div class="muted">排行 #${row.rank ?? '暂无'}</div></td>
                <td>${row.reasonTags || '暂无接口'}</td>
                <td class="${Number(row.changePercent) >= 0 ? 'rise' : 'fall'}">${number(row.changePercent)}%</td>
                <td>${money(row.amount)}</td>
                <td>${number(row.turnoverRate)}%</td>
                <td>${row.boardLabel || '暂无'}</td>
                <td>${row.industry || '暂无'}</td>
                <td>${matchTypeText(row.matchType)}</td>
              </tr>
            `).join('') : `<tr><td colspan="9" class="empty">当前 KPL 股票排行没有关联到强势股</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderExternalLimitTable(sector) {
  const snapshots = externalLimitHistory(sector);
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>近 15 日外部映射涨停股</h2>
          <p class="muted">按日期下拉展开，查看同花顺概念与东方财富涨停池求交后的全部股票。</p>
        </div>
        <div class="count-pill">当前板块：${sector.plateName}</div>
      </div>
      <div class="external-list">
        ${snapshots.map((snapshot) => {
          const rows = snapshot.mapping?.limitUpStocks || [];
          const concepts = snapshot.mapping?.matchedConcepts || [];
          const isCurrent = snapshot.date === state.data.date;
          return `
            <details class="external-day" ${isCurrent ? 'open' : ''}>
              <summary>
                <span>${shortDate(snapshot.date)} 外部映射涨停股</span>
                <strong>${rows.length} 只</strong>
              </summary>
              <div class="source-box">
                <strong>匹配概念</strong>
                <p>${concepts.length ? concepts.map((item) => `${item.name} · ${matchTypeText(item.matchType)}`).join(' / ') : '暂无匹配概念'}</p>
                <small>这不是开盘啦官方板块详情接口；它用于替代登录态接口不可用时的可解释映射。</small>
              </div>
              ${snapshot.sector ? renderExternalRows(rows) : '<div class="empty">当天快照里没有匹配到这个板块</div>'}
            </details>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderDetailContent(sector) {
  if (!sector) {
    return '<div class="card section-card empty">暂无开盘啦数据</div>';
  }

  return `
    <div class="stack">
      <section class="card detail-head">
        <div class="detail-title">
          <div>
            <div class="muted">板块详情</div>
            <h1>${sector.plateName}</h1>
            <p class="muted">展示板块走势、外部映射涨停股和当日关键数据。</p>
          </div>
        </div>
        <div class="badges">
          <span class="badge">强度 ${number(sector.strength, 0)}</span>
          <span class="badge">涨跌幅 ${number(sector.changePercent)}%</span>
          <span class="badge">外部涨停 ${sector.externalLimitMapping?.limitUpStocks?.length || 0} 家</span>
          <span class="badge">强势股 ${sector.strongStocks?.length || 0} 只</span>
          <span class="badge">成交额 ${money(sector.amount)}</span>
        </div>
      </section>

      ${renderTrendCard(sector)}
      ${renderStrongStocksTable(sector)}
      ${renderExternalLimitTable(sector)}
    </div>
  `;
}

function bindDetailEvents() {
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
}

function render() {
  renderListPage();
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
  await preloadHistoryData();
  if (!state.history.length) {
    state.history = [{ date: state.data.date, path: './data/kpl_dashboard.json' }];
  }
  state.selectedCode = sortedSectors()[0]?.plateCode || null;
  state.selectedDate = shortDate(state.data.date);
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">开盘啦数据加载失败：${error.message}</div>`;
});
