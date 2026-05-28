(function initTradesPage() {
  const app = document.querySelector("#trades-app");
  const DATA_URL = "./data/trades.json";
  const model = window.TradesModel;

  const state = {
    records: [],
    error: "",
    query: "",
    activeTag: "",
    loading: true,
  };
  let restoreSearchFocus = false;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  function postResize() {
    window.parent?.postMessage({ type: "dashboard:resize" }, window.location.origin);
  }

  function allBuyRecords() {
    return model.buyRecords(state.records);
  }

  function visibleRecords() {
    return model.filterRecords(allBuyRecords(), state.query, state.activeTag);
  }

  function renderStat(label, value, tone = "") {
    return `
      <div class="trade-stat ${tone}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderHeader(records) {
    const stats = model.summaryStats(records);
    return `
      <header class="trades-head">
        <div>
          <p class="eyebrow">交易复盘台账</p>
          <h1>买入记录</h1>
          <p>把当时的买入逻辑和盘后反馈放在同一行，方便复盘时回看决策质量。</p>
        </div>
        <div class="trade-stats" aria-label="买入记录概览">
          ${renderStat("总买入", `${stats.total} 笔`)}
          ${renderStat("最近交易日", stats.latestDate ? model.shortDate(stats.latestDate) : "暂无")}
          ${renderStat("当日标的", `${stats.latestStockCount} 只`, "accent")}
        </div>
      </header>
    `;
  }

  function renderTags(records) {
    const tags = model.tagOptions(records);
    if (!tags.length) return "";
    return `
      <div class="trade-tag-row" aria-label="按复盘标签筛选">
        <button class="trade-tag ${state.activeTag ? "" : "active"}" type="button" data-tag="">全部</button>
        ${tags.map(({ tag, count }) => `
          <button class="trade-tag ${state.activeTag === tag ? "active" : ""}" type="button" data-tag="${escapeHtml(tag)}">
            <span>${escapeHtml(tag)}</span>
            <small>${count}</small>
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderToolbar(records, filteredCount) {
    return `
      <section class="trades-toolbar" aria-label="买入记录筛选">
        <label class="trade-search">
          <span>搜索股票、板块、原因</span>
          <input
            type="search"
            id="tradeSearchInput"
            value="${escapeHtml(state.query)}"
            placeholder="输入股票、代码、板块或复盘关键词"
          >
        </label>
        <div class="toolbar-meta">
          <span>${filteredCount} / ${records.length} 笔</span>
          <small>${state.activeTag ? `当前标签：${escapeHtml(state.activeTag)}` : "显示全部复盘标签"}</small>
        </div>
        ${renderTags(records)}
      </section>
    `;
  }

  function renderTradeMeta(record) {
    if (!record.tradeMeta.length) {
      return `<span class="trade-meta-empty">未记录成交价/数量</span>`;
    }
    return record.tradeMeta.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  }

  function renderRecord(record) {
    return `
      <article class="trade-entry">
        <div class="trade-entry-main">
          <div class="trade-stock-block">
            <strong>${escapeHtml(record.stockName)}</strong>
            <small>${escapeHtml(record.stockCode || "-")}</small>
          </div>
          <div class="trade-board-block">
            <span>${escapeHtml(record.boardName)}</span>
            <small>所属板块</small>
          </div>
          <div class="trade-reason">
            <div class="trade-reason-head">
              <span class="trade-primary-tag">${escapeHtml(record.primaryTag)}</span>
              <div class="trade-meta">${renderTradeMeta(record)}</div>
            </div>
            <p>${escapeHtml(record.note || "暂无买入原因")}</p>
            ${record.tags.length ? `
              <div class="trade-entry-tags">
                ${record.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
              </div>
            ` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function renderLedger(records) {
    if (state.loading) {
      return `<div class="empty">正在加载买入记录...</div>`;
    }

    if (!records.length) {
      return `<div class="empty">没有匹配的买入记录</div>`;
    }

    const groups = model.groupRecordsByDate(records);
    return `
      <section class="trade-ledger" aria-label="按日期分组的买入复盘台账">
        ${groups.map((group) => `
          <section class="trade-day">
            <div class="trade-day-head">
              <time datetime="${escapeHtml(group.date)}">${escapeHtml(group.label)}</time>
              <span>${group.records.length} 笔买入</span>
            </div>
            <div class="trade-day-list">
              ${group.records.map(renderRecord).join("")}
            </div>
          </section>
        `).join("")}
      </section>
    `;
  }

  function bindEvents() {
    const input = app.querySelector("#tradeSearchInput");
    if (input) {
      input.addEventListener("input", () => {
        state.query = input.value;
        restoreSearchFocus = true;
        render();
      });
    }

    app.querySelectorAll("[data-tag]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTag = button.dataset.tag || "";
        render();
      });
    });
  }

  function render() {
    if (!model) {
      app.innerHTML = `<div class="error-state">买入记录模型加载失败</div>`;
      postResize();
      return;
    }

    if (state.error) {
      app.innerHTML = `<div class="error-state">${escapeHtml(state.error)}</div>`;
      postResize();
      return;
    }

    const records = allBuyRecords();
    const filtered = visibleRecords();
    app.innerHTML = `
      <div class="trades-page">
        ${renderHeader(records)}
        ${renderToolbar(records, filtered.length)}
        ${renderLedger(filtered)}
      </div>
    `;

    bindEvents();
    if (restoreSearchFocus) {
      const input = app.querySelector("#tradeSearchInput");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      restoreSearchFocus = false;
    }
    postResize();
  }

  async function load() {
    render();
    try {
      const recordResponse = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!recordResponse.ok) throw new Error(`操作记录 HTTP ${recordResponse.status}`);

      const recordData = await recordResponse.json();
      state.records = Array.isArray(recordData.records) ? recordData.records : [];
    } catch (error) {
      state.error = `买入记录加载失败：${error.message || error}`;
    } finally {
      state.loading = false;
    }
    render();
  }

  load();
})();
