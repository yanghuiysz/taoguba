const app = document.querySelector('#app');

const state = {
  data: null,
  labels: [],
  selectedCode: null,
  sortMode: 'limit_up',
  sortDate: null,
  editable: false,
  busy: false,
  message: '',
};

const number = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无';
  return Number(value).toFixed(digits);
};

const shortDate = (date) => (date ? String(date).slice(5) : '暂无');

const signedClass = (value) => (Number(value) >= 0 ? 'rise' : 'fall');

const sortChangeValue = (value) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? -999999 : parsed;
};

async function detectEditingApi() {
  try {
    const response = await fetch('/api/custom-boards/status', { cache: 'no-store' });
    const payload = await response.json();
    state.editable = Boolean(payload.editable);
  } catch {
    state.editable = false;
  }
}

async function updateStock(action, boardCode, code, name = '') {
  state.busy = true;
  state.message = action === 'add' ? '正在加入个股并刷新数据...' : '正在删除个股并刷新数据...';
  render();
  try {
    const response = await fetch('/api/custom-boards/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, boardCode, code, name }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '更新失败');
    }
    state.data = payload.data;
    state.selectedCode = boardCode;
    state.message = action === 'add' ? '已加入并刷新。' : '已删除并刷新。';
  } catch (error) {
    state.message = `更新失败：${error.message}`;
  } finally {
    state.busy = false;
    render();
  }
}

function sortedBoards() {
  return [...(state.data?.boards || [])].sort(
    (a, b) => {
      if (state.sortMode === 'limit_up') {
        const limitDiff = limitUpCountByDate(b, state.sortDate) - limitUpCountByDate(a, state.sortDate);
        if (limitDiff !== 0) return limitDiff;
      } else {
        const avgDiff = sortChangeValue(b.latestAverageChange) - sortChangeValue(a.latestAverageChange);
        if (avgDiff !== 0) return avgDiff;
      }
      return sortChangeValue(b.latestAverageChange) - sortChangeValue(a.latestAverageChange);
    },
  );
}

function activeBoard() {
  const boards = sortedBoards();
  return boards.find((board) => board.code === state.selectedCode) || boards[0];
}

function trendValues(board) {
  return (board?.trend || []).filter((item) => item.averageChange !== null && item.averageChange !== undefined);
}

function limitUpThresholdByCode(code) {
  const normalized = String(code || '');
  if (normalized.startsWith('300') || normalized.startsWith('301') || normalized.startsWith('688')) return 20;
  if (normalized.startsWith('8') || normalized.startsWith('4')) return 30;
  return 10;
}

function isLimitUp(stock) {
  const change = Number(stock?.changePercent);
  if (Number.isNaN(change)) return false;
  const threshold = limitUpThresholdByCode(stock?.code);
  return change >= threshold - 0.05;
}

function latestLimitUpCount(board) {
  return (board?.stocks || []).filter((stock) =>
    isLimitUp({ code: stock.code, changePercent: stock.latestChangePercent })).length;
}

function availableTrendDates() {
  const dateSet = new Set();
  for (const board of state.data?.boards || []) {
    for (const row of board?.trend || []) {
      if (row?.date) dateSet.add(row.date);
    }
  }
  return [...dateSet].sort((a, b) => String(b).localeCompare(String(a)));
}

function trendDatesAsc() {
  return [...availableTrendDates()].sort((a, b) => String(a).localeCompare(String(b)));
}

function limitUpCountByDate(board, date) {
  if (!date) return latestLimitUpCount(board);
  const row = (board?.trend || []).find((item) => item.date === date);
  if (!row) return 0;
  return (row.stocks || []).filter(isLimitUp).length;
}

function limitUpSeries(board) {
  const trend = trendValues(board);
  return trend.map((row) => ({
    date: row.date,
    limitUpCount: (row.stocks || []).filter(isLimitUp).length,
  }));
}

function stockSnapshotByDate(board, date) {
  const row = (board?.trend || []).find((item) => item.date === date);
  if (!row) return new Map();
  return new Map((row.stocks || []).map((item) => [String(item.code || ''), item]));
}

function boardHasDateSnapshot(board, date) {
  if (!date) return false;
  return (board?.trend || []).some((item) => item.date === date);
}

function labelFor(board, date) {
  if (!board || !date) return null;
  return state.labels.find((item) =>
    item.date === date && (
      item.boardCode === board.code
      || item.boardName === board.name
    ));
}

function renderTrendChart(board) {
  const trend = trendValues(board);
  if (!trend.length) {
    return `
      <div>
        <strong>暂无走势</strong>
        <p>这个板块最近没有可用行情数据。</p>
      </div>
    `;
  }

  const width = 760;
  const height = 240;
  const pad = { top: 30, right: 48, bottom: 46, left: 52 };
  const avgValues = trend.map((item) => Number(item.averageChange));
  const avgMax = Math.max(...avgValues, 1);
  const avgMin = Math.min(...avgValues, -1);
  const avgRange = avgMax - avgMin || 1;
  const limitValues = limitUpSeries(board).map((item) => Number(item.limitUpCount) || 0);
  const limitMax = Math.max(...limitValues, 1);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const points = trend.map((item, index) => {
    const change = Number(item.averageChange) || 0;
    const limitUpCount = limitValues[index] ?? 0;
    const x = pad.left + (trend.length === 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
    const yAvg = pad.top + ((avgMax - change) / avgRange) * plotHeight;
    const yLimit = pad.top + ((limitMax - limitUpCount) / limitMax) * plotHeight;
    const label = labelFor(board, item.date);
    const close = Math.abs(yAvg - yLimit) < 16;
    return {
      ...item,
      change,
      limitUpCount,
      x,
      yAvg,
      yLimit,
      yAvgLabel: close ? yAvg - 14 : yAvg - 10,
      yLimitLabel: close ? yLimit + 16 : yLimit - 10,
      tag: label?.label || null,
    };
  });
  const avgLine = points.map((point) => `${point.x},${point.yAvg}`).join(' ');
  const limitLine = points.map((point) => `${point.x},${point.yLimit}`).join(' ');
  const zeroY = pad.top + ((avgMax - 0) / avgRange) * plotHeight;
  const axisBottom = height - pad.bottom;

  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 近15日平均涨跌幅与涨停家数走势">
      <line class="zero-line" x1="${pad.left}" y1="${axisBottom}" x2="${width - pad.right}" y2="${axisBottom}"></line>
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <polyline points="${avgLine}" style="fill:none;stroke:#0b7893;stroke-linecap:round;stroke-width:3;"></polyline>
      <polyline points="${limitLine}" style="fill:none;stroke:#d9480f;stroke-linecap:round;stroke-width:3;"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.yAvg}" r="4.5" style="fill:#fff;stroke:#0b7893;stroke-width:2.2;"></circle>
          <circle cx="${point.x}" cy="${point.yLimit}" r="4.5" style="fill:#fff;stroke:#d9480f;stroke-width:2.2;"></circle>
          <text x="${point.x}" y="${point.yAvgLabel}" text-anchor="middle" class="value-label">${number(point.change)}%</text>
          <text x="${point.x}" y="${point.yLimitLabel}" text-anchor="middle" class="value-label">${point.limitUpCount}</text>
          ${point.tag ? `<text x="${point.x}" y="${point.yAvg - 26}" text-anchor="middle" class="tag-label">${point.tag}</text>` : ''}
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} 平均涨跌幅 ${number(point.change)}% | 涨停家数 ${point.limitUpCount} 家 | 有效股票 ${point.stockCount}</title>
        </g>
      `).join('')}
    </svg>
  `;
}

function renderEditor(board) {
  if (!state.editable) {
    return `
      <section class="card section-card editor-card">
        <div class="section-head">
          <div>
            <h2>编辑自定义板块</h2>
            <p class="muted">当前是只读模式。请运行 scripts/serve_custom_boards.py 以启用增删个股。</p>
          </div>
          <div class="count-pill">只读</div>
        </div>
      </section>
    `;
  }

  return `
    <section class="card section-card editor-card">
      <div class="section-head">
        <div>
          <h2>编辑自定义板块</h2>
          <p class="muted">新增或删除个股后，会更新配置并刷新派生数据。</p>
        </div>
        <div class="count-pill">${state.busy ? '更新中' : '可编辑'}</div>
      </div>
      <form class="stock-form" id="addStockForm">
        <input name="code" inputmode="numeric" autocomplete="off" placeholder="股票代码，例如 300750" ${state.busy ? 'disabled' : ''}>
        <input name="name" autocomplete="off" placeholder="股票名称（可选）" ${state.busy ? 'disabled' : ''}>
        <button type="submit" ${state.busy ? 'disabled' : ''}>加入当前板块</button>
      </form>
      ${state.message ? `<div class="editor-message">${state.message}</div>` : ''}
      <p class="muted editor-path">当前板块：${board.name}，配置文件：web/data/custom_boards_config.json</p>
    </section>
  `;
}

function renderStocksTable(board) {
  const snapshot = stockSnapshotByDate(board, state.sortDate);
  const hasDateSnapshot = boardHasDateSnapshot(board, state.sortDate);
  const stocks = [...(board?.stocks || [])]
    .map((stock) => {
      const current = snapshot.get(String(stock.code || ''));
      const useDateSnapshot = Boolean(state.sortDate && hasDateSnapshot);
      return {
        ...stock,
        displayDate: useDateSnapshot ? state.sortDate : stock.latestDate,
        displayClose: useDateSnapshot ? (current?.close ?? null) : stock.latestClose,
        displayChangePercent: useDateSnapshot ? (current?.changePercent ?? null) : stock.latestChangePercent,
      };
    })
    .sort((a, b) => sortChangeValue(b.displayChangePercent) - sortChangeValue(a.displayChangePercent));
  const actionColumn = state.editable ? '<th>操作</th>' : '';
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>板块个股</h2>
          <p class="muted">根据自定义配置生成，并展示 ${state.sortDate || '最新'} 行情（随日期切换联动）。</p>
        </div>
        <div class="count-pill">${stocks.length} 只</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>最新日期</th>
              <th>收盘价</th>
              <th>涨跌幅</th>
              <th>可用天数</th>
              ${actionColumn}
            </tr>
          </thead>
          <tbody>
            ${stocks.length ? stocks.map((stock) => `
              <tr>
                <td class="code">${stock.code}</td>
                <td><strong>${stock.name}</strong></td>
                <td>${stock.displayDate || '暂无'}</td>
                <td>${number(stock.displayClose)}</td>
                <td class="${signedClass(stock.displayChangePercent)}">${number(stock.displayChangePercent)}%</td>
                <td>${stock.availableDays ?? 0}</td>
                ${state.editable ? `<td><button class="remove-stock" data-code="${stock.code}" data-name="${stock.name}" ${state.busy ? 'disabled' : ''}>删除</button></td>` : ''}
              </tr>
            `).join('') : `<tr><td colspan="${state.editable ? 7 : 6}" class="empty">该板块暂无已配置个股</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDetail(board) {
  if (!board) {
    return '<div class="card section-card empty">暂无自定义板块数据</div>';
  }

  return `
    <div class="stack">
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>${board.name} · 近15日平均涨跌幅与涨停家数</h2>
            <p class="muted">横轴为交易日日期，左轴为平均涨跌幅(%)，右轴为涨停家数(家)。</p>
          </div>
          <div class="badges">
            <span class="badge">蓝线：平均涨跌幅</span>
            <span class="badge">橙线：涨停家数</span>
          </div>
        </div>
        <div class="chart-box">${renderTrendChart(board)}</div>
      </section>

      ${renderStocksTable(board)}
    </div>
  `;
}

function render() {
  const boards = sortedBoards();
  const board = activeBoard();
  const ascDates = trendDatesAsc();
  const currentIndex = ascDates.findIndex((date) => date === state.sortDate);
  const prevDate = currentIndex > 0 ? ascDates[currentIndex - 1] : null;
  const nextDate = currentIndex >= 0 && currentIndex < ascDates.length - 1 ? ascDates[currentIndex + 1] : null;
  app.innerHTML = `
    <div class="workspace-layout">
      <aside class="card sidebar-card">
        <div class="sort-inline">
          <div class="sort-mode-group" role="group" aria-label="排序方式">
            <button class="sort-mode-btn${state.sortMode === 'limit_up' ? ' active' : ''}" type="button" data-mode="limit_up">涨停</button>
            <button class="sort-mode-btn${state.sortMode === 'avg_change' ? ' active' : ''}" type="button" data-mode="avg_change">均值</button>
          </div>
          <label class="sort-date-label">
            <span>日期</span>
            <button class="date-nav-btn" id="sortDatePrevBtn" type="button" ${prevDate ? '' : 'disabled'} aria-label="前一天">◀</button>
            <select id="sortDateSelect">
              ${availableTrendDates().map((date) => `<option value="${date}" ${date === state.sortDate ? 'selected' : ''}>${shortDate(date)}</option>`).join('')}
            </select>
            <button class="date-nav-btn" id="sortDateNextBtn" type="button" ${nextDate ? '' : 'disabled'} aria-label="后一天">▶</button>
          </label>
        </div>
        <div class="board-list">
          ${boards.map((item) => `
            <button class="board-button${item.code === board?.code ? ' active' : ''}" data-code="${item.code}">
              <span>
                <strong>${item.name}</strong>
                <small>${item.availableStockCount}/${item.stockCount} 只有最新行情</small>
              </span>
              <span class="board-score">
                <small>涨停(${shortDate(state.sortDate)}) ${limitUpCountByDate(item, state.sortDate)} | 均值</small>
                <strong class="${signedClass(item.latestAverageChange)}">${number(item.latestAverageChange)}%</strong>
              </span>
            </button>
          `).join('')}
        </div>
      </aside>
      <main class="detail-pane">${renderDetail(board)}</main>
    </div>
  `;

  document.querySelectorAll('.board-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCode = button.dataset.code;
      render();
    });
  });

  document.querySelectorAll('.sort-mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.sortMode = button.dataset.mode;
      render();
    });
  });

  document.querySelector('#sortDateSelect')?.addEventListener('change', (event) => {
    state.sortDate = event.target.value;
    render();
  });
  document.querySelector('#sortDatePrevBtn')?.addEventListener('click', () => {
    if (!prevDate) return;
    state.sortDate = prevDate;
    render();
  });
  document.querySelector('#sortDateNextBtn')?.addEventListener('click', () => {
    if (!nextDate) return;
    state.sortDate = nextDate;
    render();
  });

  document.querySelector('#addStockForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    updateStock('add', board.code, data.get('code'), data.get('name'));
  });

  document.querySelectorAll('.remove-stock').forEach((button) => {
    button.addEventListener('click', () => {
      if (confirm(`确定从 ${board.name} 删除 ${button.dataset.name || button.dataset.code} 吗？`)) {
        updateStock('remove', board.code, button.dataset.code);
      }
    });
  });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'taoguba:resize' }, '*');
    setTimeout(() => window.parent.postMessage({ type: 'taoguba:resize' }, '*'), 80);
  }
}

async function boot() {
  await detectEditingApi();
  const response = await fetch('./data/custom_boards.json');
  state.data = await response.json();
  try {
    const labelResponse = await fetch('./data/custom_board_labels.json');
    const labelPayload = await labelResponse.json();
    const rawLabels = Array.isArray(labelPayload.labels) ? labelPayload.labels : [];
    const today = state.data?.date;
    state.labels = rawLabels.map((item) => {
      if (item?.date === today && item?.label === '强2') {
        return { ...item, label: '强1' };
      }
      return item;
    });
  } catch {
    state.labels = [];
  }
  const dates = availableTrendDates();
  state.sortDate = dates[0] || state.data.date || null;
  state.selectedCode = sortedBoards()[0]?.code || null;
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">自定义板块数据加载失败：${error.message}</div>`;
});
