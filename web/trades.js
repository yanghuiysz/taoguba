(function initTradesPage() {
  const app = document.querySelector("#trades-app");
  const DATA_URL = "./data/trades.json";
  const CUSTOM_DATA_URL = "./data/custom_boards.json";
  const BUY_ACTIONS = new Set(["buy", "add"]);

  const state = {
    records: [],
    marketData: null,
    error: "",
    query: "",
  };

  const safeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const tagsOf = (record) => Array.isArray(record.tags) ? record.tags.filter(Boolean) : [];

  function shortDate(date) {
    const text = String(date || "");
    return text.length >= 10 ? text.slice(5) : text || "-";
  }

  function normalizeCode(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits ? digits.slice(-6).padStart(6, "0") : "";
  }

  function signedPercent(value, digits = 2) {
    const parsed = safeNumber(value);
    if (parsed === null) return "暂无";
    return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(digits)}%`;
  }

  function plainPercent(value, digits = 0) {
    const parsed = safeNumber(value);
    if (parsed === null) return "暂无";
    return `${parsed.toFixed(digits)}%`;
  }

  function amountText(value) {
    const parsed = safeNumber(value);
    if (parsed === null) return "暂无";
    if (parsed >= 1e8) return `${(parsed / 1e8).toFixed(2)}亿`;
    if (parsed >= 1e4) return `${(parsed / 1e4).toFixed(0)}万`;
    return parsed.toFixed(0);
  }

  function postResize() {
    window.parent?.postMessage({ type: "dashboard:resize" }, window.location.origin);
  }

  function buyRecords() {
    return [...state.records]
      .filter((record) => BUY_ACTIONS.has(record.action))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  }

  function noteSummary(record) {
    const parts = [
      ...tagsOf(record),
      String(record.note || "").trim(),
    ].filter(Boolean);
    return parts.length ? parts.join(" / ") : "暂无";
  }

  function enrichRecord(record) {
    return {
      ...record,
      stockCode: normalizeCode(record.stockCode) || record.stockCode || "",
      noteText: noteSummary(record),
    };
  }

  function filteredRecords() {
    const query = state.query.trim().toLowerCase();
    const records = buyRecords().map(enrichRecord);
    if (!query) return records;
    return records.filter((record) => [
      record.stockCode,
      record.stockName,
      record.boardName,
      record.noteText,
    ].filter(Boolean).join(" ").toLowerCase().includes(query));
  }

  function renderToolbar(records) {
    return `
      <section class="trades-toolbar" aria-label="买入记录搜索">
        <label class="trade-search">
          <span>搜索股票</span>
          <input
            type="search"
            id="tradeSearchInput"
            value="${escapeHtml(state.query)}"
            placeholder="输入股票代码或名称，回车搜索"
          >
        </label>
        <div class="toolbar-meta">
          <span>${records.length} 条买入记录</span>
          <small>${records[0]?.date ? `最新 ${escapeHtml(shortDate(records[0].date))}` : "暂无数据"}</small>
        </div>
      </section>
    `;
  }

  function renderList(records) {
    if (!records.length) {
      return `<div class="empty">没有匹配的买入记录</div>`;
    }

    return `
      <section class="trade-list" aria-label="买入记录列表">
        <div class="trade-list-head">
          <span>日期</span>
          <span>股票</span>
          <span>板块</span>
          <span>买入原因</span>
        </div>
        ${records.map((record) => `
          <article class="trade-list-row">
            <div class="trade-cell trade-date">${escapeHtml(shortDate(record.date))}</div>
            <div class="trade-cell trade-stock">
              <strong>${escapeHtml(record.stockName || "-")}</strong>
              <small>${escapeHtml(record.stockCode || "-")}</small>
            </div>
            <div class="trade-cell">${escapeHtml(record.boardName || "-")}</div>
            <div class="trade-cell trade-text">${escapeHtml(record.noteText)}</div>
          </article>
        `).join("")}
      </section>
    `;
  }

  function bindEvents() {
    const input = app.querySelector("#tradeSearchInput");
    if (!input) return;
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      state.query = input.value;
      render();
    });
    input.addEventListener("search", () => {
      state.query = input.value;
      render();
    });
  }

  function render() {
    if (state.error) {
      app.innerHTML = `<div class="error-state">${escapeHtml(state.error)}</div>`;
      postResize();
      return;
    }

    const records = filteredRecords();
    app.innerHTML = `
      <div class="trades-page">
        <header class="trades-head">
          <div>
            <h1>买入记录</h1>
            <p>按列表查看当天买入，只保留你自己填写的买入原因。</p>
          </div>
        </header>
        ${renderToolbar(records)}
        ${renderList(records)}
      </div>
    `;

    bindEvents();
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
    }
    render();
  }

  load();
})();
