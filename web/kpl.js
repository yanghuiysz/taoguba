const app = document.querySelector('#app');
const MAX_SECTOR_COUNT = 15;

const state = {
  keyword: '',
  sortKey: 'strength',
  selectedCode: null,
  selectedDate: '',
  stockSortField: 'amount',
  stockSortDirection: 'desc',
  data: null,
  history: [],
  historyData: new Map(),
  currentPath: '',
};

const EXCLUDED_SECTOR_PATTERNS = [
  /^ST/i,
  /摘帽/,
  /季报/,
  /年报/,
  /业绩预/,
  /预增/,
];

const number = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return Number(value).toFixed(digits);
};

const money = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${number(n / 100000000, 1)}亿`;
  if (abs >= 10000) return `${number(n / 10000, 1)}万`;
  return number(n, 0);
};

const shortDate = (date) => (date ? String(date).slice(5) : 'N/A');
const signedClass = (value) => (Number(value) >= 0 ? 'rise' : 'fall');

async function loadDashboard(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`加载失败: ${path}`);
  const data = await response.json();
  state.data = data;
  state.currentPath = path;
  state.historyData.set(path, data);
  state.selectedDate = shortDate(data.date);
  const sectors = sortedSectors();
  if (!sectors.some((sector) => sector.plateCode === state.selectedCode)) {
    state.selectedCode = sectors[0]?.plateCode || null;
  }
}

function orderedHistoryAsc() {
  return [...(state.history || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

async function preloadHistoryData() {
  const items = state.history.slice(0, 15);
  await Promise.all(items.map(async (item) => {
    if (!item.path || state.historyData.has(item.path)) return;
    try {
      const response = await fetch(item.path, { cache: 'no-store' });
      state.historyData.set(item.path, response.ok ? await response.json() : null);
    } catch {
      state.historyData.set(item.path, null);
    }
  }));
}

function isExcludedSector(sector) {
  const name = String(sector?.plateName || '');
  return EXCLUDED_SECTOR_PATTERNS.some((pattern) => pattern.test(name));
}

function sortedSectors() {
  const keyword = state.keyword.trim().toLowerCase();
  const rows = (state.data?.plates || []).filter((sector) => {
    if (isExcludedSector(sector)) return false;
    if (!keyword) return true;
    return [sector.plateName, sector.plateCode].join(' ').toLowerCase().includes(keyword);
  });

  return rows
    .slice()
    .sort((a, b) => (Number(b[state.sortKey]) || -999999) - (Number(a[state.sortKey]) || -999999))
    .slice(0, MAX_SECTOR_COUNT);
}

function activeSector() {
  const sectors = sortedSectors();
  return sectors.find((sector) => sector.plateCode === state.selectedCode) || sectors[0] || null;
}

function sectorDescription(sector) {
  const external = sector.externalLimitMapping?.limitUpStocks?.length || 0;
  const strong = sector.strongStocks?.length || 0;
  if (external || strong) return `当日外部涨停关联 ${external} 只，强势股 ${strong} 只`;
  return '暂无关联个股';
}

function findHistorySector(target, data) {
  const sectors = data?.plates || [];
  return sectors.find((sector) => sector.plateCode === target.plateCode)
    || sectors.find((sector) => sector.plateName === target.plateName)
    || null;
}

function sectorTrendFromHistory(sector) {
  return state.history
    .slice(0, 15)
    .map((item) => {
      const historySector = findHistorySector(sector, state.historyData.get(item.path));
      if (!historySector) return null;
      return {
        date: item.date || historySector.date,
        change: Number(historySector.changePercent) || 0,
        strength: Number(historySector.strength) || 0,
      };
    })
    .filter(Boolean)
    .reverse();
}

function trendChart(points, title) {
  const width = 860;
  const height = 280;
  const pad = { top: 16, right: 56, bottom: 46, left: 56 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const changeValues = points.map((item) => item.change);
  const strengthValues = points.map((item) => item.strength);
  const maxAbsChange = Math.max(1, ...changeValues.map((v) => Math.abs(v)));
  const changeMax = maxAbsChange;
  const changeMin = -maxAbsChange;
  const changeRange = changeMax - changeMin || 1;

  const strengthMax = Math.max(1, ...strengthValues);

  const mapped = points.map((item, index) => {
    const x = pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yChange = pad.top + ((changeMax - item.change) / changeRange) * plotHeight;
    const yStrength = pad.top + ((strengthMax - item.strength) / strengthMax) * plotHeight;
    const overlap = Math.abs(yChange - yStrength) < 18;
    return {
      ...item,
      x,
      yChange,
      yStrength,
      yChangeLabel: overlap ? yChange - 13 : yChange - 9,
      yStrengthLabel: overlap ? yStrength + 15 : yStrength - 9,
    };
  });

  const changeLine = mapped.map((p) => `${p.x},${p.yChange}`).join(' ');
  const strengthLine = mapped.map((p) => `${p.x},${p.yStrength}`).join(' ');
  const zeroY = pad.top + ((changeMax - 0) / changeRange) * plotHeight;
  const axisBottom = height - pad.bottom;

  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
      <line class="zero-line" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>

      <polyline class="trend-line" points="${changeLine}"></polyline>
      <polyline points="${strengthLine}" style="fill:none;stroke:#d9480f;stroke-linecap:round;stroke-linejoin:round;stroke-width:3;"></polyline>

      ${mapped.map((p) => `
        <g>
          <circle cx="${p.x}" cy="${p.yChange}" r="4.5"></circle>
          <circle cx="${p.x}" cy="${p.yStrength}" r="4.5" style="fill:#fff;stroke:#d9480f;stroke-width:2.5;"></circle>
          <text x="${p.x}" y="${p.yChangeLabel}" text-anchor="middle" class="value-label">${number(p.change)}%</text>
          <text x="${p.x}" y="${p.yStrengthLabel}" text-anchor="middle" class="value-label">${number(p.strength, 0)}</text>
          <text x="${p.x}" y="${height - 14}" text-anchor="middle" class="date-label">${shortDate(p.date)}</text>
          <title>${p.date} | 涨跌幅 ${number(p.change)}% | 强度 ${number(p.strength, 0)}</title>
        </g>
      `).join('')}
    </svg>
  `;
}

function sortButton(label, field) {
  const active = state.stockSortField === field;
  const suffix = active ? (state.stockSortDirection === 'asc' ? ' ↑' : ' ↓') : '';
  return `<button class="sort-btn" data-sort="${field}">${label}${suffix}</button>`;
}

function fieldValue(row, field) {
  if (field === 'reasonTags') return String(row.reasonTags || '');
  if (field === 'boardLabel') return String(row.boardLabel || '');
  if (field === 'industry') return String(row.industry || '');
  return Number(row[field]) || 0;
}

function sortedRows(rows) {
  return [...(rows || [])].sort((a, b) => {
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

function renderStrongStocksTable(sector) {
  const rows = sortedRows(sector.strongStocks || []);
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>KPL 关联强势股</h2>
          <p class="muted">跟随当前日期与当前板块变化。</p>
        </div>
        <div class="count-pill">${rows.length} 只</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>${sortButton('涨跌幅', 'changePercent')}</th>
              <th>${sortButton('成交额', 'amount')}</th>
              <th>${sortButton('换手率', 'turnoverRate')}</th>
              <th>${sortButton('板型', 'boardLabel')}</th>
              <th>${sortButton('行业', 'industry')}</th>
              <th>${sortButton('题材标签', 'reasonTags')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td class="code">${row.code || '-'}</td>
                <td class="name-nowrap"><strong title="${row.name || ''}">${row.name || '-'}</strong></td>
                <td class="${signedClass(row.changePercent)}">${number(row.changePercent)}%</td>
                <td>${money(row.amount)}</td>
                <td>${number(row.turnoverRate)}%</td>
                <td>${row.boardLabel || '-'}</td>
                <td>${row.industry || '-'}</td>
                <td>${row.reasonTags || '-'}</td>
              </tr>
            `).join('') : '<tr><td colspan="8" class="empty">暂无强势股数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function matchTypeText(value) {
  const labels = {
    exact: '精确匹配',
    alias: '别名匹配',
    name_contains: '名称包含',
    industry_or_concept: '行业/概念',
    industry_or_reason_tag: '行业/题材标签',
  };
  return labels[value] || value || '未知';
}

function conceptText(row) {
  const concepts = row.matchedConcepts || [];
  if (!concepts.length) return '-';
  return concepts.map((item) => `${item.name}·${matchTypeText(item.matchType)}`).join(' / ');
}

function timeText(value) {
  const text = String(value || '').padStart(6, '0');
  if (!/^\d{6}$/.test(text) || text === '000000') return '-';
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}`;
}

function renderExternalLimitToday(sector) {
  const mapping = sector.externalLimitMapping;
  if (!mapping) return '';
  const rows = mapping.limitUpStocks || [];
  const concepts = mapping.matchedConcepts || [];

  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>当日外部涨停关联</h2>
          <p class="muted">仅展示当前日期的外部涨停映射。</p>
        </div>
        <div class="count-pill">${rows.length} 只</div>
      </div>
      <div class="source-box">
        <strong>匹配概念</strong>
        <p>${concepts.length ? concepts.map((item) => `${item.name}·${matchTypeText(item.matchType)}`).join(' / ') : '暂无'}</p>
        <small>${mapping.source || ''}</small>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>匹配概念</th>
              <th>涨跌幅</th>
              <th>连板</th>
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
                <td class="code">${row.code || '-'}</td>
                <td class="name-nowrap"><strong title="${row.name || ''}">${row.name || '-'}</strong><br>${row.limitStats || '-'}</td>
                <td>${conceptText(row)}</td>
                <td class="${signedClass(row.changePercent)}">${number(row.changePercent)}%</td>
                <td>${row.consecutiveBoards ?? '-'}</td>
                <td>${timeText(row.firstSealTime)}</td>
                <td>${timeText(row.lastSealTime)}</td>
                <td>${money(row.sealAmount)}</td>
                <td>${row.openCount ?? '-'}</td>
                <td>${row.industry || '-'}</td>
              </tr>
            `).join('') : '<tr><td colspan="10" class="empty">暂无外部涨停映射数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTrendCard(sector) {
  const trend = sectorTrendFromHistory(sector);
  if (!trend.length) {
    return `
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>${sector.plateName} · 近15日走势</h2>
            <p class="muted">暂无历史数据。</p>
          </div>
        </div>
        <div class="chart-box"><div>暂无可绘制数据</div></div>
      </section>
    `;
  }

  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>${sector.plateName} · 近15日走势</h2>
          <p class="muted">横轴为交易日日期，蓝线为涨跌幅(%)，橙线为强度。</p>
        </div>
        <div class="badges">
          <span class="badge">蓝线：涨跌幅</span>
          <span class="badge">橙线：强度</span>
        </div>
      </div>
      <div class="chart-box">${trendChart(trend, `${sector.plateName} 近15日走势`)}</div>
    </section>
  `;
}

function renderDetailContent(sector) {
  if (!sector) {
    return '<div class="card section-card empty">暂无可用板块数据</div>';
  }
  return `
    <div class="stack">
      ${renderTrendCard(sector)}
      ${renderStrongStocksTable(sector)}
      ${renderExternalLimitToday(sector)}
    </div>
  `;
}

function renderListPage() {
  const sectors = sortedSectors();
  const sector = activeSector();
  const orderedHistory = orderedHistoryAsc();
  const currentIndex = orderedHistory.findIndex((item) => item.path === state.currentPath);
  const prevItem = currentIndex > 0 ? orderedHistory[currentIndex - 1] : null;
  const nextItem = currentIndex >= 0 && currentIndex < orderedHistory.length - 1 ? orderedHistory[currentIndex + 1] : null;

  app.innerHTML = `
    <div class="workspace-layout">
      <aside class="card sidebar-card">
        <div class="sidebar-controls">
          <div class="kpl-toolbar-row">
            <label class="kpl-search-shell">
              <input id="keywordInput" value="${state.keyword}" placeholder="搜索板块名 / 代码">
            </label>
            <label class="kpl-date-shell">
              <span>日期</span>
              <button class="date-nav-btn" id="datePrevBtn" type="button" ${prevItem ? '' : 'disabled'} aria-label="前一天">◀</button>
              <select id="dateSelect">
                ${state.history.map((item) => `
                  <option value="${item.path}" ${item.path === state.currentPath ? 'selected' : ''}>${shortDate(item.date)}</option>
                `).join('')}
              </select>
              <button class="date-nav-btn" id="dateNextBtn" type="button" ${nextItem ? '' : 'disabled'} aria-label="后一天">▶</button>
            </label>
          </div>
          <div class="kpl-sort-row">
            <span>排序</span>
            <div class="kpl-sort-group" role="group" aria-label="板块排序">
              <button class="kpl-sort-btn${state.sortKey === 'strength' ? ' active' : ''}" type="button" data-sort-key="strength">强度</button>
              <button class="kpl-sort-btn${state.sortKey === 'changePercent' ? ' active' : ''}" type="button" data-sort-key="changePercent">涨幅</button>
              <button class="kpl-sort-btn${state.sortKey === 'mainNetAmount' ? ' active' : ''}" type="button" data-sort-key="mainNetAmount">主力净额</button>
              <button class="kpl-sort-btn${state.sortKey === 'largeOrderNetAmount' ? ' active' : ''}" type="button" data-sort-key="largeOrderNetAmount">大单净额</button>
            </div>
          </div>
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

  document.querySelector('#keywordInput')?.addEventListener('input', (event) => {
    state.keyword = event.target.value;
    render();
  });

  document.querySelectorAll('.kpl-sort-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.sortKey = button.dataset.sortKey;
      render();
    });
  });

  document.querySelector('#dateSelect')?.addEventListener('change', async (event) => {
    await loadDashboard(event.target.value);
    await preloadHistoryData();
    render();
  });

  document.querySelector('#datePrevBtn')?.addEventListener('click', async () => {
    if (!prevItem) return;
    await loadDashboard(prevItem.path);
    await preloadHistoryData();
    render();
  });

  document.querySelector('#dateNextBtn')?.addEventListener('click', async () => {
    if (!nextItem) return;
    await loadDashboard(nextItem.path);
    await preloadHistoryData();
    render();
  });

  document.querySelectorAll('.sidebar-sector').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCode = button.dataset.code;
      render();
    });
  });

  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.sort;
      if (state.stockSortField === field) {
        state.stockSortDirection = state.stockSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.stockSortField = field;
        state.stockSortDirection = ['reasonTags', 'boardLabel', 'industry'].includes(field) ? 'asc' : 'desc';
      }
      render();
    });
  });
}

function notifyParentResize() {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'taoguba:resize' }, '*');
  }
}

function render() {
  renderListPage();
  notifyParentResize();
  setTimeout(notifyParentResize, 80);
}

async function boot() {
  try {
    const indexResponse = await fetch('./data/kpl/index.json', { cache: 'no-store' });
    const index = await indexResponse.json();
    state.history = index.items || [];
  } catch {
    state.history = [{ date: '', path: './data/kpl_dashboard.json' }];
  }

  const latestPath = state.history[0]?.path || './data/kpl_dashboard.json';
  await loadDashboard(latestPath);
  await preloadHistoryData();
  if (!state.history.length) {
    state.history = [{ date: state.data.date, path: latestPath }];
  }

  state.selectedCode = sortedSectors()[0]?.plateCode || null;
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">开盘啦数据加载失败：${error.message}</div>`;
});
