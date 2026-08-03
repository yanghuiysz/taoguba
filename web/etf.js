(function (root) {
  "use strict";

  const DATA_URL = "./data/etf_fund_flow.json";
  const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  const compactFormatter = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const state = { payload: null, sortKey: "netSubscription1d", sortDirection: "desc" };

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function formatMoney(value) {
    if (!isFiniteNumber(value)) return "—";
    const absolute = Math.abs(value);
    if (absolute >= 100_000_000) return `${compactFormatter.format(value / 100_000_000)}亿`;
    if (absolute >= 10_000) return `${compactFormatter.format(value / 10_000)}万`;
    return numberFormatter.format(value);
  }

  function formatShares(value) {
    if (!isFiniteNumber(value)) return "—";
    const absolute = Math.abs(value);
    if (absolute >= 100_000_000) return `${compactFormatter.format(value / 100_000_000)}亿份`;
    if (absolute >= 10_000) return `${compactFormatter.format(value / 10_000)}万份`;
    return `${numberFormatter.format(value)}份`;
  }

  function formatPercent(value) {
    return isFiniteNumber(value) ? `${compactFormatter.format(value)}%` : "—";
  }

  function formatRatio(value) {
    return isFiniteNumber(value) ? `${compactFormatter.format(value)}×` : "—";
  }

  function sortEtfs(rows, key, direction = "desc") {
    const multiplier = direction === "asc" ? 1 : -1;
    const windowSizes = { netSubscription5d: 5, netSubscription20d: 20 };
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
      const a = left?.[key];
      const b = right?.[key];
      const aMissing = a === null || a === undefined || a === "";
      const bMissing = b === null || b === undefined || b === "";
      if (aMissing && bMissing) return String(left?.code || "").localeCompare(String(right?.code || ""), "zh-CN");
      if (aMissing) return 1;
      if (bMissing) return -1;
      const windowSize = windowSizes[key];
      if (windowSize) {
        const windowKey = key === "netSubscription5d" ? "windowDays5d" : "windowDays20d";
        const aCoverage = isFiniteNumber(left?.[windowKey]) ? Math.min(left[windowKey], windowSize) : 0;
        const bCoverage = isFiniteNumber(right?.[windowKey]) ? Math.min(right[windowKey], windowSize) : 0;
        if (aCoverage !== bCoverage) return bCoverage - aCoverage;
      }
      if (typeof a === "number" && typeof b === "number") return (a - b) * multiplier;
      return String(a).localeCompare(String(b), "zh-CN", { numeric: true }) * multiplier;
    });
  }

  function selectRankedFlows(rows, mode, limit = 10) {
    const isOutflow = mode === "outflow";
    const candidates = (Array.isArray(rows) ? rows : []).filter((row) => {
      const value = row?.netSubscription1d;
      return isFiniteNumber(value) && (isOutflow ? value < 0 : value > 0);
    });
    return sortEtfs(candidates, "netSubscription1d", isOutflow ? "asc" : "desc").slice(0, limit);
  }

  function valueClass(value) {
    if (!isFiniteNumber(value) || value === 0) return "neutral";
    return value > 0 ? "positive" : "negative";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendPendingValue(container, value, formatter, extraClass = "") {
    const pending = !isFiniteNumber(value);
    const node = el("span", `metric-value ${pending ? "pending neutral" : valueClass(value)} ${extraClass}`.trim());
    node.textContent = formatter(value);
    container.appendChild(node);
    return node;
  }

  function statusText(status) {
    return status === "confirmed" ? "已确认" : "待确认";
  }

  function windowLabel(days, size, suffix = "") {
    return isFiniteNumber(days) ? `${days}/${size}日${suffix}` : `${size}日${suffix}`;
  }

  function renderSourceErrors(payload) {
    const container = document.getElementById("source-errors");
    container.textContent = "";
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    if (!errors.length) {
      container.appendChild(el("li", "source-error-empty", "当前日期未记录数据源异常"));
      return;
    }
    errors.forEach((error) => {
      const item = el("li", "source-error-item");
      item.appendChild(el("strong", "source-error-code", error?.code || "全局"));
      item.appendChild(el("span", "source-error-source", error?.source || "unknown"));
      item.appendChild(el("span", "source-error-message", error?.message || "未知错误"));
      container.appendChild(item);
    });
  }

  function renderHeader(payload) {
    const summary = payload?.summary?.all || {};
    const total = Number.isFinite(summary.count) ? summary.count : 0;
    const confirmed = Number.isFinite(summary.confirmedCount) ? summary.confirmedCount : 0;
    const statusNames = { confirmed: "全部确认", partial: "部分确认", pending: "待确认" };
    document.getElementById("report-date").textContent = payload?.date || "—";
    document.getElementById("report-status").textContent = statusNames[payload?.status] || "待确认";
    document.getElementById("confirmed-count").textContent = total ? `${confirmed} / ${total}` : "—";

    const warning = document.getElementById("confirmed-warning");
    warning.className = "confirmed-warning";
    if (total && confirmed === total) {
      warning.classList.add("is-complete");
      warning.textContent = `全市场 ${total} 只样本均已确认份额日期，净申购数据可比。`;
    } else if (total) {
      warning.textContent = `仅 ${confirmed} / ${total} 只样本完成确认；其余申赎显示“— / 待确认”，不以 0 代替。`;
    } else {
      warning.textContent = "暂无可用 ETF 样本，申赎数据待确认。";
    }

    const generated = document.getElementById("generated-at");
    const generatedDate = payload?.generatedAt ? new Date(payload.generatedAt) : null;
    generated.textContent = generatedDate && !Number.isNaN(generatedDate.getTime())
      ? `生成时间 ${dateFormatter.format(generatedDate)}`
      : "生成时间 —";
  }

  function renderBroad(rows) {
    const container = document.getElementById("broad-preference");
    container.textContent = "";
    if (!rows.length) {
      container.appendChild(el("p", "empty-state", "暂无宽基 ETF 数据"));
      return;
    }
    rows.forEach((row) => {
      const card = el("article", "broad-card");
      const top = el("div", "card-topline");
      const identity = el("div");
      identity.appendChild(el("p", "card-category", row.category || "宽基"));
      identity.appendChild(el("h3", "card-name", row.name || "未命名 ETF"));
      identity.appendChild(el("p", "card-code", `${row.code || "—"} · ${row.direction || "—"}`));
      const status = el("span", `status-pill ${row.status === "confirmed" ? "" : "pending"}`.trim(), statusText(row.status));
      top.append(identity, status);
      card.appendChild(top);

      const primary = el("div", "card-primary");
      primary.appendChild(el("span", "metric-label", "1日净申购"));
      appendPendingValue(primary, row.netSubscription1d, formatMoney);
      card.appendChild(primary);

      const secondary = el("div", "card-secondary");
      const fiveDay = el("div");
      fiveDay.appendChild(el("span", "metric-label", windowLabel(row.windowDays5d, 5, "累计")));
      appendPendingValue(fiveDay, row.netSubscription5d, formatMoney);
      const change = el("div");
      change.appendChild(el("span", "metric-label", "当日涨跌"));
      appendPendingValue(change, row.changePercent, formatPercent);
      secondary.append(fiveDay, change);
      card.appendChild(secondary);
      container.appendChild(card);
    });
  }

  function renderRankList(targetId, rows, mode) {
    const container = document.getElementById(targetId);
    container.textContent = "";
    const ranked = selectRankedFlows(rows, mode, 10);
    if (!ranked.length) {
      const message = rows.some((row) => isFiniteNumber(row?.netSubscription1d))
        ? `当日暂无净${mode === "outflow" ? "流出" : "流入"}样本`
        : "净申购数据待确认";
      container.appendChild(el("li", "empty-state", message));
      return;
    }
    ranked.forEach((row, index) => {
      const item = el("li", "rank-item");
      item.appendChild(el("span", "rank-number", String(index + 1).padStart(2, "0")));
      const main = el("span", "rank-main");
      main.appendChild(el("span", "rank-name", row.name || "未命名 ETF"));
      main.appendChild(el("span", "rank-direction", `${row.category || "—"} · ${row.direction || "—"}`));
      item.appendChild(main);
      item.appendChild(el("strong", `rank-value ${valueClass(row.netSubscription1d)}`, formatMoney(row.netSubscription1d)));
      container.appendChild(item);
    });
  }

  function addLabel(container, text, className = "") {
    if (!text) return;
    container.appendChild(el("span", `mini-label ${className}`.trim(), text));
  }

  function renderPersistence(rows) {
    const container = document.getElementById("persistent-flow");
    container.textContent = "";
    const persistent = rows
      .filter((row) => row.persistenceLabel && isFiniteNumber(row.netSubscription5d))
      .sort((a, b) => Math.abs(b.netSubscription5d) - Math.abs(a.netSubscription5d));
    if (!persistent.length) {
      container.appendChild(el("li", "empty-state", "需累计完整 5 日确认数据后生成"));
      return;
    }
    persistent.slice(0, 10).forEach((row) => {
      const item = el("li", "persistence-item");
      const main = el("div");
      main.appendChild(el("strong", "", row.name || "未命名 ETF"));
      const meta = el("div", "persistence-meta");
      addLabel(meta, row.persistenceLabel, row.netSubscription5d > 0 ? "" : "pending");
      if (row.mainlineCandidate) addLabel(meta, "主线候选", "mainline-label");
      if (row.breadthConfirmed && isFiniteNumber(row.stockBreadth)) {
        addLabel(meta, `上涨覆盖 ${formatPercent(row.stockBreadth * 100)}`);
      }
      main.appendChild(meta);
      item.appendChild(main);
      item.appendChild(el("strong", valueClass(row.netSubscription5d), formatMoney(row.netSubscription5d)));
      container.appendChild(item);
    });
  }

  function appendDataCell(rowNode, value, formatter, options = {}) {
    const cell = el("td");
    const pending = !isFiniteNumber(value);
    cell.className = pending ? "pending-cell" : options.tone === false ? "neutral" : valueClass(value);
    cell.textContent = formatter(value);
    if (pending && options.confirm !== false) cell.appendChild(el("small", "", "待确认"));
    if (!pending && options.coverage) {
      const { days, size } = options.coverage;
      const partial = isFiniteNumber(days) && days < size;
      cell.appendChild(
        el(
          "small",
          `window-coverage ${partial ? "is-partial" : "is-full"}`,
          windowLabel(days, size),
        ),
      );
    }
    rowNode.appendChild(cell);
  }

  function renderIndustryTable(rows) {
    const body = document.getElementById("industry-table-body");
    body.textContent = "";
    const sorted = sortEtfs(rows, state.sortKey, state.sortDirection);
    if (!sorted.length) {
      const row = el("tr");
      const cell = el("td", "table-empty", "暂无行业 ETF 数据");
      cell.colSpan = 13;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    sorted.forEach((item) => {
      const row = el("tr");
      const identity = el("td", "identity-cell");
      identity.appendChild(el("strong", "", item.name || "未命名 ETF"));
      identity.appendChild(el("span", "", `${item.code || "—"} · ${item.category || "—"} · ${item.direction || "—"}`));
      row.appendChild(identity);
      appendDataCell(row, item.netSubscription1d, formatMoney);
      appendDataCell(row, item.netSubscription5d, formatMoney, {
        coverage: { days: item.windowDays5d, size: 5 },
      });
      appendDataCell(row, item.netSubscription20d, formatMoney, {
        coverage: { days: item.windowDays20d, size: 20 },
      });
      appendDataCell(row, item.scale, formatMoney, { tone: false });
      appendDataCell(row, item.shareChange, formatShares);

      const status = el("td");
      status.appendChild(el("span", `status-pill ${item.status === "confirmed" ? "" : "pending"}`.trim(), statusText(item.status)));
      row.appendChild(status);
      appendDataCell(row, item.changePercent, formatPercent);
      appendDataCell(row, item.excessReturn1d, formatPercent);
      appendDataCell(row, item.excessReturn5d, formatPercent);
      appendDataCell(row, item.turnover, formatMoney, { tone: false });
      appendDataCell(row, item.turnoverVs5d, formatRatio, { tone: false });

      const labelCell = el("td");
      const labels = el("div", "label-stack");
      const flowClass = item.flowLabel === "待确认"
        ? "pending"
        : item.flowLabel === "无净申赎"
          ? "neutral-label"
          : "";
      addLabel(labels, item.flowLabel || "待确认", flowClass);
      addLabel(labels, item.persistenceLabel);
      if (item.mainlineCandidate) addLabel(labels, "主线候选", "mainline-label");
      labelCell.appendChild(labels);
      row.appendChild(labelCell);
      body.appendChild(row);
    });
  }

  function announceSort() {
    const labels = {
      name: "ETF名称",
      netSubscription1d: "1日净申购",
      netSubscription5d: "5日净申购",
      netSubscription20d: "20日净申购",
      scale: "规模",
      shareChange: "份额变化",
      status: "申购确认",
      changePercent: "涨跌幅",
      excessReturn1d: "1日超额",
      excessReturn5d: "5日超额",
      turnover: "当日成交额",
      turnoverVs5d: "成交额/5日均值",
      flowLabel: "资金标签",
    };
    const direction = state.sortDirection === "asc" ? "升序" : "降序";
    document.getElementById("sort-description").textContent = `按${labels[state.sortKey] || state.sortKey}${direction}排列；点击表头可切换。`;
  }

  function notifyResize() {
    if (typeof root?.parent?.postMessage === "function" && root.location?.origin) {
      root.parent.postMessage({ type: "dashboard:resize" }, root.location.origin);
    }
  }

  function renderEtfRadar(payload) {
    if (typeof document === "undefined") return payload;
    const rows = Array.isArray(payload?.etfs) ? payload.etfs : [];
    const broad = rows.filter((row) => row?.scope === "broad");
    const industry = rows.filter((row) => row?.scope === "industry");
    state.payload = payload || {};
    renderHeader(state.payload);
    renderSourceErrors(state.payload);
    renderBroad(broad);
    renderRankList("industry-inflow", industry, "inflow");
    renderRankList("industry-outflow", industry, "outflow");
    renderPersistence(industry);
    renderIndustryTable(industry);
    announceSort();
    notifyResize();
    return state.payload;
  }

  function renderLoadError(error) {
    const warning = document.getElementById("confirmed-warning");
    warning.className = "confirmed-warning is-error";
    warning.textContent = "ETF 资金数据读取失败，请稍后刷新；当前不展示推测值。";
    renderEtfRadar({ status: "pending", summary: { all: { count: 0, confirmedCount: 0 } }, etfs: [] });
    warning.className = "confirmed-warning is-error";
    warning.textContent = `ETF 资金数据读取失败：${error?.message || "未知错误"}`;
    notifyResize();
  }

  function bindSorting() {
    document.querySelectorAll("[data-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.sort;
        if (state.sortKey === key) state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
        else {
          state.sortKey = key;
          state.sortDirection = key === "name" || key === "status" || key === "flowLabel" ? "asc" : "desc";
        }
        document.querySelectorAll("[data-sort]").forEach((candidate) => candidate.removeAttribute("aria-sort"));
        button.setAttribute("aria-sort", state.sortDirection === "asc" ? "ascending" : "descending");
        const industry = (state.payload?.etfs || []).filter((row) => row?.scope === "industry");
        renderIndustryTable(industry);
        announceSort();
        notifyResize();
      });
    });
  }

  async function loadRadar() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderEtfRadar(await response.json());
    } catch (error) {
      renderLoadError(error);
    }
  }

  const api = { formatMoney, renderEtfRadar, selectRankedFlows, sortEtfs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") {
    bindSorting();
    loadRadar();
  }
})(typeof window !== "undefined" ? window : globalThis);
