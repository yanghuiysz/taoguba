(function initTradesPage() {
  const app = document.querySelector("#trades-app");
  const DATA_URL = "./data/trades.json";

  const state = {
    records: [],
    error: "",
    expanded: new Set(),
    filters: {
      query: "",
      action: "all",
      status: "all",
      board: "all",
    },
  };

  const actionLabels = {
    buy: "买入",
    sell: "卖出",
    add: "加仓",
    reduce: "减仓",
    watch: "观察",
  };

  const actionTone = {
    buy: "buy",
    add: "buy",
    sell: "sell",
    reduce: "sell",
    watch: "watch",
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
          key,
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
    if (group.netQuantity > 0) return { value: "holding", label: "持仓中", tone: "buy" };
    if (group.sellQuantity > 0) return { value: "closed", label: "已清仓", tone: "sell" };
    return { value: "watch", label: "观察", tone: "watch" };
  }

  function recordSearchText(record) {
    return [
      record.stockCode,
      record.stockName,
      record.boardName,
      actionLabels[record.action],
      ...tagsOf(record),
      record.note,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function filteredGroups(records) {
    const query = state.filters.query.trim().toLowerCase();
    return groupByStock(records)
      .filter((group) => {
        const status = statusOfGroup(group);
        if (state.filters.status !== "all" && status.value !== state.filters.status) return false;
        if (state.filters.board !== "all" && group.boardName !== state.filters.board) return false;
        if (state.filters.action !== "all" && !group.records.some((record) => record.action === state.filters.action)) return false;
        if (query && !group.records.some((record) => recordSearchText(record).includes(query))) return false;
        return true;
      });
  }

  function filteredRecords(records, groups) {
    const keys = new Set(groups.map((group) => group.key));
    const query = state.filters.query.trim().toLowerCase();
    return records.filter((record) => {
      const key = record.stockCode || record.stockName || record.id;
      if (!keys.has(key)) return false;
      if (state.filters.action !== "all" && record.action !== state.filters.action) return false;
      if (query && !recordSearchText(record).includes(query)) return false;
      return true;
    });
  }

  function boardOptions(records) {
    return [...new Set(records.map((record) => record.boardName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function metrics(groups, records) {
    return {
      recordCount: records.length,
      stockCount: groups.length,
      holdingCount: groups.filter((group) => group.netQuantity > 0).length,
      closedCount: groups.filter((group) => group.netQuantity <= 0 && group.sellQuantity > 0).length,
      netCost: groups.reduce((sum, group) => sum + group.netCost, 0),
      realized: groups.reduce((sum, group) => sum + (group.realizedEstimate ?? 0), 0),
    };
  }

  function renderChip(record) {
    const tone = actionTone[record.action] || "watch";
    return `<span class="trade-chip ${tone}">${escapeHtml(actionLabels[record.action] || record.action || "-")}</span>`;
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

  function modeLabel(note) {
    return String(note || "").split("：")[0] || "";
  }

  function renderTags(record) {
    const chips = [
      record.boardName ? `<span class="trade-chip board">${escapeHtml(record.boardName)}</span>` : "",
      ...tagsOf(record).map((tag) => `<span class="trade-chip tag">${escapeHtml(tag)}</span>`),
    ].filter(Boolean);
    return chips.length ? `<div class="trade-tags">${chips.join("")}</div>` : "";
  }

  function renderSummary(metric) {
    return `
      <section class="trades-summary" aria-label="操作汇总">
        <div class="trade-metric primary">
          <span>持仓标的</span>
          <strong>${integer(metric.holdingCount)}</strong>
          <small>${integer(metric.stockCount)} 只纳入复盘</small>
        </div>
        <div class="trade-metric">
          <span>净投入</span>
          <strong>${currency(metric.netCost)}</strong>
          <small>买入金额 - 卖出金额</small>
        </div>
        <div class="trade-metric">
          <span>估算已兑现</span>
          <strong class="${metric.realized >= 0 ? "rise" : "fall"}">${currency(metric.realized)}</strong>
          <small>${integer(metric.closedCount)} 只已清仓</small>
        </div>
        <div class="trade-metric">
          <span>逐笔记录</span>
          <strong>${integer(metric.recordCount)}</strong>
          <small>来自 trades.json</small>
        </div>
      </section>
    `;
  }

  function renderFilters(records) {
    const boards = boardOptions(records);
    return `
      <section class="trades-toolbar" aria-label="操作记录筛选">
        <label class="trade-search">
          <span>搜索</span>
          <input type="search" data-filter="query" value="${escapeHtml(state.filters.query)}" placeholder="代码 / 名称 / 板块 / 原因，回车筛选">
        </label>
        <label>
          <span>动作</span>
          <select data-filter="action">
            ${renderOption("all", "全部动作", state.filters.action)}
            ${Object.entries(actionLabels).map(([value, label]) => renderOption(value, label, state.filters.action)).join("")}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select data-filter="status">
            ${renderOption("all", "全部状态", state.filters.status)}
            ${renderOption("holding", "持仓中", state.filters.status)}
            ${renderOption("closed", "已清仓", state.filters.status)}
            ${renderOption("watch", "观察", state.filters.status)}
          </select>
        </label>
        <label>
          <span>板块</span>
          <select data-filter="board">
            ${renderOption("all", "全部板块", state.filters.board)}
            ${boards.map((board) => renderOption(board, board, state.filters.board)).join("")}
          </select>
        </label>
        <button class="trade-reset" type="button" data-reset-filters>重置</button>
      </section>
    `;
  }

  function renderOption(value, label, selected) {
    return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function renderStockGroups(groups) {
    if (!groups.length) return `<div class="empty">没有匹配的操作记录</div>`;
    return `
      <div class="stock-group-list">
        ${groups.map((group) => {
          const status = statusOfGroup(group);
          const isExpanded = state.expanded.has(group.key);
          const latest = group.records[0];
          const latestMode = modeLabel(latest.note);
          return `
            <article class="stock-group-card ${status.value}${isExpanded ? " expanded" : ""}">
              <button class="stock-group-main" type="button" data-stock-key="${escapeHtml(group.key)}" aria-expanded="${isExpanded ? "true" : "false"}">
                <span class="stock-identity">
                  <strong>${escapeHtml(group.stockName)}</strong>
                  <small>${escapeHtml(group.stockCode || "-")}</small>
                </span>
                <span class="stock-board">${escapeHtml(group.boardName || "未归属板块")}</span>
                <span class="trade-chip ${status.tone}">${status.label}</span>
                <span class="stock-amount ${group.netCost >= 0 ? "fall" : "rise"}">${currency(group.netCost)}</span>
                <span class="stock-window">${escapeHtml(shortDate(group.firstDate))} - ${escapeHtml(shortDate(group.lastDate))}</span>
                <span class="stock-expand">${isExpanded ? "收起" : "展开"}</span>
              </button>
              <div class="stock-stats">
                <div><span>当前股数</span><strong>${integer(group.netQuantity)}</strong></div>
                <div><span>买入均价</span><strong>${currency(group.avgBuyPrice)}</strong></div>
                <div><span>卖出均价</span><strong>${currency(group.avgSellPrice)}</strong></div>
                <div><span>估算兑现</span><strong class="${Number(group.realizedEstimate) >= 0 ? "rise" : "fall"}">${group.realizedEstimate === null ? "-" : currency(group.realizedEstimate)}</strong></div>
              </div>
              <div class="stock-latest-note">
                <span class="muted">最近</span>
                ${renderChip(latest)}
                <span>${escapeHtml(shortDate(latest.date))}</span>
                ${latestMode ? `<span class="mode-chip ${modeTone(latest.note)}">${escapeHtml(latestMode)}</span>` : ""}
                <span>${latest.note ? renderNote(latest.note) : "暂无原因"}</span>
              </div>
              ${isExpanded ? renderStockRecords(group.records) : ""}
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderStockRecords(records) {
    return `
      <div class="stock-records">
        ${records.map((record) => `
          <div class="stock-record">
            <span>${escapeHtml(shortDate(record.date))}</span>
            ${renderChip(record)}
            <span>${integer(record.quantity)} 股</span>
            <span>${currency(record.price)}</span>
            <span>${currency(record.amount)}</span>
            <span>${record.note ? renderNote(record.note) : "-"}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderLedger(records) {
    if (!records.length) return `<div class="empty">没有匹配的流水</div>`;
    return `
      <div class="trade-ledger">
        <div class="ledger-row ledger-head">
          <span>日期</span>
          <span>标的</span>
          <span>动作</span>
          <span>数量</span>
          <span>价格</span>
          <span>金额</span>
          <span>依据</span>
        </div>
        ${records.map((record) => {
          const label = modeLabel(record.note);
          return `
            <div class="ledger-row">
              <span>${escapeHtml(shortDate(record.date))}</span>
              <span class="ledger-stock"><strong>${escapeHtml(record.stockName || "-")}</strong><small>${escapeHtml(record.stockCode || "")}</small></span>
              ${renderChip(record)}
              <span>${integer(record.quantity)}</span>
              <span>${currency(record.price)}</span>
              <span>${currency(record.amount)}</span>
              <span class="ledger-note">
                ${renderTags(record)}
                ${label ? `<span class="mode-chip ${modeTone(record.note)}">${escapeHtml(label)}</span>` : ""}
                ${record.note ? `<em>${renderNote(record.note)}</em>` : "<em>-</em>"}
              </span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function bindEvents() {
    app.querySelectorAll("[data-filter]").forEach((field) => {
      field.addEventListener("change", () => {
        state.filters[field.dataset.filter] = field.value;
        render();
      });
      if (field.dataset.filter === "query") {
        field.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          state.filters.query = field.value;
          render();
        });
      }
    });

    app.querySelector("[data-reset-filters]")?.addEventListener("click", () => {
      state.filters = { query: "", action: "all", status: "all", board: "all" };
      render();
    });

    app.querySelectorAll("[data-stock-key]").forEach((button) => {
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
    const groups = filteredGroups(records);
    const ledger = filteredRecords(records, groups);
    const metric = metrics(groups, ledger);

    app.innerHTML = `
      <div class="trades-page">
        <header class="trades-head">
          <div>
            <h1>操作记录</h1>
            <p>把逐笔动作、仓位状态和复盘依据放在同一屏里，先看风险和持仓，再回看每一笔为什么发生。</p>
          </div>
          <span class="count-pill">${escapeHtml(records.length ? `更新 ${shortDate(records[0].date)}` : "暂无数据")}</span>
        </header>
        ${renderSummary(metric)}
        ${renderFilters(records)}
        <div class="trades-layout">
          <section class="trades-section positions-panel">
            <div class="section-title">
              <h2>持仓归集</h2>
              <span class="badge">${integer(groups.length)} 只</span>
            </div>
            ${renderStockGroups(groups)}
          </section>
          <section class="trades-section ledger-panel">
            <div class="section-title">
              <h2>逐笔流水</h2>
              <span class="badge">${integer(ledger.length)} 笔</span>
            </div>
            ${renderLedger(ledger)}
          </section>
        </div>
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
      const firstGroup = groupByStock(normalizedRecords())[0];
      if (firstGroup) state.expanded.add(firstGroup.key);
    } catch (error) {
      state.error = `操作记录加载失败：${error.message || error}`;
    }
    render();
  }

  load();
})();
