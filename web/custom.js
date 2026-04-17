const app = document.querySelector('#app');

const state = {
  data: null,
  selectedCode: null,
  editable: false,
  busy: false,
  message: '',
};

const number = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '暂无';
  return Number(value).toFixed(digits);
};

const shortDate = (date) => date ? String(date).slice(5) : '暂无';

const signedClass = (value) => Number(value) >= 0 ? 'rise' : 'fall';

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
  state.message = action === 'add' ? '正在加入个股并刷新均值...' : '正在删除个股并刷新均值...';
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
    state.message = action === 'add' ? '已加入并刷新数据。' : '已删除并刷新数据。';
  } catch (error) {
    state.message = `更新失败：${error.message}`;
  } finally {
    state.busy = false;
    render();
  }
}

function sortedBoards() {
  return [...(state.data?.boards || [])].sort(
    (a, b) => sortChangeValue(b.latestAverageChange) - sortChangeValue(a.latestAverageChange),
  );
}

function activeBoard() {
  const boards = sortedBoards();
  return boards.find((board) => board.code === state.selectedCode) || boards[0];
}

function trendValues(board) {
  return (board?.trend || []).filter((item) => item.averageChange !== null && item.averageChange !== undefined);
}

function renderTrendChart(board) {
  const trend = trendValues(board);
  if (!trend.length) {
    return `
      <div>
        <strong>暂无走势</strong>
        <p>板块股票还没有可用的最近 15 日行情。</p>
      </div>
    `;
  }

  const width = 760;
  const height = 240;
  const pad = { top: 30, right: 34, bottom: 46, left: 48 };
  const values = trend.map((item) => Number(item.averageChange));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, -1);
  const range = max - min || 1;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const points = trend.map((item, index) => {
    const change = Number(item.averageChange) || 0;
    const x = pad.left + (trend.length === 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
    const y = pad.top + ((max - change) / range) * plotHeight;
    return { ...item, change, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const zeroY = pad.top + ((max - 0) / range) * plotHeight;

  return `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${board.name} 近 15 日平均涨跌幅">
      <line class="zero-line" x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}"></line>
      <polyline class="trend-line" points="${line}"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.y}" r="5"></circle>
          <text x="${point.x}" y="${point.y - 10}" text-anchor="middle" class="value-label">${number(point.change)}%</text>
          <text x="${point.x}" y="${height - 16}" text-anchor="middle" class="date-label">${shortDate(point.date)}</text>
          <title>${point.date} 平均涨跌幅 ${number(point.change)}% · 有效股票 ${point.stockCount}</title>
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
            <p class="muted">当前是只读模式。需要在界面增删个股时，用 scripts/serve_custom_boards.py 启动本地服务。</p>
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
          <p class="muted">新增或删除后会更新配置，并重新计算该板块的均值线。</p>
        </div>
        <div class="count-pill">${state.busy ? '更新中' : '可编辑'}</div>
      </div>
      <form class="stock-form" id="addStockForm">
        <input name="code" inputmode="numeric" autocomplete="off" placeholder="股票代码，例如 300750" ${state.busy ? 'disabled' : ''}>
        <input name="name" autocomplete="off" placeholder="股票名称，可留空" ${state.busy ? 'disabled' : ''}>
        <button type="submit" ${state.busy ? 'disabled' : ''}>加入当前板块</button>
      </form>
      ${state.message ? `<div class="editor-message">${state.message}</div>` : ''}
      <p class="muted editor-path">当前板块：${board.name}，配置文件 web/data/custom_boards_config.json</p>
    </section>
  `;
}

function renderStocksTable(board) {
  const stocks = [...(board?.stocks || [])].sort(
    (a, b) => sortChangeValue(b.latestChangePercent) - sortChangeValue(a.latestChangePercent),
  );
  const actionColumn = state.editable ? '<th>操作</th>' : '';
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>板块个股</h2>
          <p class="muted">按自定义清单生成，最新行情来自脚本拉取的 A 股日线。</p>
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
              <th>最新涨跌幅</th>
              <th>可用天数</th>
              ${actionColumn}
            </tr>
          </thead>
          <tbody>
            ${stocks.length ? stocks.map((stock) => `
              <tr>
                <td class="code">${stock.code}</td>
                <td><strong>${stock.name}</strong></td>
                <td>${stock.latestDate || '暂无'}</td>
                <td>${number(stock.latestClose)}</td>
                <td class="${signedClass(stock.latestChangePercent)}">${number(stock.latestChangePercent)}%</td>
                <td>${stock.availableDays ?? 0}</td>
                ${state.editable ? `<td><button class="remove-stock" data-code="${stock.code}" data-name="${stock.name}" ${state.busy ? 'disabled' : ''}>删除</button></td>` : ''}
              </tr>
            `).join('') : `<tr><td colspan="${state.editable ? 7 : 6}" class="empty">这个自定义板块还没有配置个股</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDailyTable(board) {
  const rows = [...(board?.trend || [])].reverse();
  return `
    <section class="card section-card">
      <div class="section-head">
        <div>
          <h2>每日均值</h2>
          <p class="muted">每一天取板块内所有有行情股票的涨跌幅算术平均。</p>
        </div>
        <div class="count-pill">${trendValues(board).length}/15 天</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>平均涨跌幅</th>
              <th>有效股票数</th>
              <th>个股涨跌幅</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td>${row.date}</td>
                <td class="${signedClass(row.averageChange)}">${number(row.averageChange)}%</td>
                <td>${row.stockCount}</td>
                <td>${[...(row.stocks || [])].sort((a, b) => sortChangeValue(b.changePercent) - sortChangeValue(a.changePercent)).map((stock) => `${stock.name} ${number(stock.changePercent)}%`).join(' / ')}</td>
              </tr>
            `).join('') : '<tr><td colspan="4" class="empty">暂无每日均值</td></tr>'}
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
      <section class="card detail-head">
        <div>
          <div class="muted">自定义板块</div>
          <h1>${board.name}</h1>
          <p class="muted">最近 15 个交易日，按板块内所有股票每日涨跌幅计算平均值。</p>
        </div>
        <div class="badges">
          <span class="badge">最新均值 ${number(board.latestAverageChange)}%</span>
          <span class="badge">最新有效 ${board.availableStockCount}/${board.stockCount} 只</span>
          <span class="badge">数据日期 ${state.data.date}</span>
        </div>
      </section>

      <section class="card section-card">
        <div class="section-head">
          <div>
            <h2>近 15 日平均涨跌幅</h2>
            <p class="muted">折线越高，代表该自定义板块当日股票平均表现越强。</p>
          </div>
          <div class="count-pill">均值线</div>
        </div>
        <div class="chart-box">${renderTrendChart(board)}</div>
      </section>

      ${renderEditor(board)}
      ${renderStocksTable(board)}
      ${renderDailyTable(board)}
    </div>
  `;
}

function render() {
  const boards = sortedBoards();
  const board = activeBoard();
  app.innerHTML = `
    <div class="workspace-layout">
      <aside class="card sidebar-card">
        <div class="sidebar-head">
          <div>
            <h2>自定义板块</h2>
            <p class="muted">清单来自 web/data/custom_boards_config.json</p>
          </div>
          <div class="count-pill">${boards.length} 个</div>
        </div>
        <div class="board-list">
          ${boards.map((item) => `
            <button class="board-button${item.code === board?.code ? ' active' : ''}" data-code="${item.code}">
              <span>
                <strong>${item.name}</strong>
                <small>${item.availableStockCount}/${item.stockCount} 只有最新行情</small>
              </span>
              <span class="board-score">
                <small>均值</small>
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
  document.querySelector('#addStockForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    updateStock('add', board.code, data.get('code'), data.get('name'));
  });
  document.querySelectorAll('.remove-stock').forEach((button) => {
    button.addEventListener('click', () => {
      if (confirm(`从 ${board.name} 删除 ${button.dataset.name || button.dataset.code}？`)) {
        updateStock('remove', board.code, button.dataset.code);
      }
    });
  });
}

async function boot() {
  await detectEditingApi();
  const response = await fetch('./data/custom_boards.json');
  state.data = await response.json();
  state.selectedCode = sortedBoards()[0]?.code || null;
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="card section-card empty">自定义板块数据加载失败：${error.message}</div>`;
});
