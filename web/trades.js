(function initTradesPage() {
  const app = document.querySelector("#trades-app");
  const DATA_URL = "./data/trades.json";

  const state = {
    records: [],
    error: "",
    expanded: new Set(),
  };

  const actionLabels = {
    buy: "买入",
    sell: "卖出",
    add: "加仓",
    reduce: "减仓",
    watch: "观察",
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const safeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const currency = (value) => {
    const parsed = safeNumber(value);
    if (parsed === null) return "-";
    return parsed.toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const integer = (value) => {
    const parsed = safeNumber(value);
    return parsed === null ? "-" : parsed.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  };

  const shortDate = (date) => {
    const text = String(date || "");
    return text.length >= 10 ? text.slice(5) : text || "-";
  };

  const tagsOf = (record) => Array.isArray(record.tags) ? record.tags.filter(Boolean) : [];

  function renderTagList(record) {
    const chips = [
      record.boardName ? `<span class="trade-chip board">${escapeHtml(record.boardName)}</span>` : "",
      ...tagsOf(record).map((tag) => `<span class="trade-chip tag">${escapeHtml(tag)}</span>`),
    ].filter(Boolean);
    return chips.length ? `<div class="trade-tags">${chips.join("")}</div>` : "";
  }

  function renderNote(note) {
    const text = String(note || "");
    if (!text) return "";
    const marker = "不足";
    const index = text.indexOf(marker);
    if (index < 0) return escapeHtml(text);
    return `${escapeHtml(text.slice(0, index))}<span class="trade-note-risk">${escapeHtml(text.slice(index))}</span>`;
  }

  function modeTone(note) {
    const text = String(note || "");
    if (text.startsWith("符合")) return "mode-ok";
    if (text.startsWith("半符合")) return "mode-half";
    if (text.startsWith("不符合")) return "mode-bad";
    return "";
  }

  function postResize() {
    window.parent?.postMessage({ type: "dashboard:resize" }, window.location.origin);
  }

  function normalizedRecords() {
    return [...state.records]
      .map((record) => {
        const quantity = safeNumber(record.quantity) ?? 0;
        const price = safeNumber(record.price) ?? 0;
        const amount = safeNumber(record.amount) ?? quantity * price;
        return { ...record, quantity, price, amount };
      })
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  }

  function summary(records) {
    const buyRecords = records.filter((record) => record.action === "buy");
    const groups = groupByStock(records);
    const totalAmount = records.reduce((sum, record) => sum + record.amount, 0);
    const totalQuantity = records.reduce((sum, record) => sum + record.quantity, 0);
    const dates = new Set(records.map((record) => record.date).filter(Boolean));
    return {
      count: records.length,
      buyCount: buyRecords.length,
      stockCount: groups.length,
      totalAmount,
      totalQuantity,
      dayCount: dates.size,
    };
  }

  function renderSummary(records) {
    const metric = summary(records);
    return `
      <section class="trades-summary" aria-label="操作汇总">
        <div class="setup-metric">
          <span>记录数</span>
          <strong>${integer(metric.count)}</strong>
          <small>${integer(metric.dayCount)} 个交易日</small>
        </div>
        <div class="setup-metric">
          <span>标的数</span>
          <strong>${integer(metric.stockCount)}</strong>
          <small>按个股归集</small>
        </div>
        <div class="setup-metric">
          <span>买入笔数</span>
          <strong>${integer(metric.buyCount)}</strong>
          <small>当前仅统计已记录动作</small>
        </div>
        <div class="setup-metric">
          <span>流水股数</span>
          <strong>${integer(metric.totalQuantity)}</strong>
          <small>买卖动作合计</small>
        </div>
      </section>
    `;
  }

  function actionSign(action) {
    if (action === "sell" || action === "reduce") return -1;
    if (action === "buy" || action === "add") return 1;
    return 0;
  }

  function groupByStock(records) {
    const groups = new Map();
    records.forEach((record) => {
      const key = record.stockCode || record.stockName || record.id;
      if (!groups.has(key)) {
        groups.set(key, {
          stockCode: record.stockCode || "",
          stockName: record.stockName || record.stockCode || "-",
          boardName: record.boardName || "",
          records: [],
          buyQuantity: 0,
          sellQuantity: 0,
          buyAmount: 0,
          sellAmount: 0,
          netQuantity: 0,
          firstDate: record.date || "",
          lastDate: record.date || "",
        });
      }
      const group = groups.get(key);
      group.records.push(record);
      if (record.boardName && !group.boardName) group.boardName = record.boardName;
      if (String(record.date || "").localeCompare(String(group.firstDate || "")) < 0) group.firstDate = record.date || group.firstDate;
      if (String(record.date || "").localeCompare(String(group.lastDate || "")) > 0) group.lastDate = record.date || group.lastDate;

      const sign = actionSign(record.action);
      if (sign > 0) {
        group.buyQuantity += record.quantity;
        group.buyAmount += record.amount;
      } else if (sign < 0) {
        group.sellQuantity += record.quantity;
        group.sellAmount += record.amount;
      }
      group.netQuantity += sign * record.quantity;
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        records: [...group.records].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || ""))),
        avgBuyPrice: group.buyQuantity ? group.buyAmount / group.buyQuantity : null,
        avgSellPrice: group.sellQuantity ? group.sellAmount / group.sellQuantity : null,
        netCost: group.buyAmount - group.sellAmount,
        realizedEstimate: group.sellQuantity && group.buyQuantity ? group.sellAmount - (group.sellQuantity * (group.buyAmount / group.buyQuantity)) : null,
      }))
      .sort((a, b) => String(b.lastDate || "").localeCompare(String(a.lastDate || "")) || String(a.stockCode || "").localeCompare(String(b.stockCode || "")));
  }

  function statusOfGroup(group) {
    if (group.netQuantity > 0) return { label: "持仓中", tone: "buy" };
    if (group.sellQuantity > 0) return { label: "已清仓", tone: "sell" };
    return { label: "观察", tone: "watch" };
  }

  function renderRecordRows(records) {
    return `
      <div class="stock-records">
        ${records.map((record) => `
          <div class="stock-record">
            <div class="stock-record-date">
              <strong>${escapeHtml(shortDate(record.date))}</strong>
              <span>${escapeHtml(record.date || "-")}</span>
            </div>
            <span class="trade-chip ${escapeHtml(record.action || "")}">${escapeHtml(actionLabels[record.action] || record.action || "-")}</span>
            <span>${integer(record.quantity)} 股</span>
            <span>${currency(record.price)}</span>
            <span>${currency(record.amount)}</span>
            <div>
              ${renderTagList(record) || ""}
              ${record.note ? `<span class="mode-chip ${modeTone(record.note)}">${escapeHtml(String(record.note).split("：")[0])}</span>` : ""}
              ${record.note ? `<p class="trade-note">${renderNote(record.note)}</p>` : "<span class=\"muted\">-</span>"}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderStockGroups(records) {
    const groups = groupByStock(records);
    if (!groups.length) return `<div class="empty">暂无操作记录</div>`;
    return `
      <div class="stock-group-list">
        ${groups.map((group) => {
          const status = statusOfGroup(group);
          const key = group.stockCode || group.stockName;
          const isExpanded = state.expanded.has(key);
          const latestRecord = group.records[0];
          return `
            <article class="stock-group-card${isExpanded ? " expanded" : ""}">
              <div class="stock-group-head">
                <div class="stock-title">
                  <strong>${escapeHtml(group.stockName)}</strong>
                  <span>${escapeHtml(group.stockCode || "-")}</span>
                </div>
                <div class="stock-head-tags">
                  ${group.boardName ? `<span class="trade-chip board">${escapeHtml(group.boardName)}</span>` : ""}
                  <span class="trade-chip ${status.tone}">${status.label}</span>
                  <button class="trade-toggle" type="button" data-stock-key="${escapeHtml(key)}">${isExpanded ? "收起" : "展开"}</button>
                </div>
              </div>

              <div class="stock-stats">
                <div><span>当前股数</span><strong>${integer(group.netQuantity)}</strong></div>
                <div><span>买入均价</span><strong>${currency(group.avgBuyPrice)}</strong></div>
                <div><span>卖出均价</span><strong>${currency(group.avgSellPrice)}</strong></div>
                <div><span>净投入</span><strong>${currency(group.netCost)}</strong></div>
                <div><span>估算已兑现</span><strong class="${Number(group.realizedEstimate) >= 0 ? "rise" : "fall"}">${group.realizedEstimate === null ? "-" : currency(group.realizedEstimate)}</strong></div>
                <div><span>操作区间</span><strong>${escapeHtml(shortDate(group.firstDate))} - ${escapeHtml(shortDate(group.lastDate))}</strong></div>
              </div>

              <div class="stock-latest-note">
                <span class="muted">最近：</span>
                <span class="trade-chip ${escapeHtml(latestRecord.action || "")}">${escapeHtml(actionLabels[latestRecord.action] || latestRecord.action || "-")}</span>
                <span>${escapeHtml(shortDate(latestRecord.date))}</span>
                <span>${latestRecord.note ? renderNote(latestRecord.note) : "暂无原因"}</span>
              </div>

              ${isExpanded ? `
                <div class="stock-record-header">
                  <span>日期</span>
                  <span>动作</span>
                  <span>股数</span>
                  <span>成交价</span>
                  <span>金额</span>
                  <span>原因</span>
                </div>
                ${renderRecordRows(group.records)}
              ` : ""}
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function bindEvents() {
    app.querySelectorAll(".trade-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.stockKey;
        if (!key) return;
        if (state.expanded.has(key)) state.expanded.delete(key);
        else state.expanded.add(key);
        render();
      });
    });
  }

  function render() {
    if (state.error) {
      app.innerHTML = `<div class="error-state">${escapeHtml(state.error)}</div>`;
      postResize();
      return;
    }

    const records = normalizedRecords();
    app.innerHTML = `
      <div class="trades-page">
        <header class="trades-head">
          <div>
            <h1>操作记录</h1>
            <p>按个股归集买卖动作、成本和仓位，方便复盘每只票的计划执行。</p>
          </div>
          <span class="count-pill">数据源：web/data/trades.json</span>
        </header>
        ${renderSummary(records)}
        <section class="trades-section">
          <div class="section-title">
            <h2>个股操作</h2>
            <span class="badge">${groupByStock(records).length} 只</span>
          </div>
          ${renderStockGroups(records)}
        </section>
      </div>
    `;
    bindEvents();
    postResize();
  }

  async function load() {
    render();
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.records = Array.isArray(data.records) ? data.records : [];
    } catch (error) {
      state.error = `操作记录加载失败：${error.message || error}`;
    }
    render();
  }

  load();
})();
