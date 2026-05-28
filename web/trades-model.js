(function initTradesModel(root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = model;
  }
  root.TradesModel = model;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTradesModel() {
  const BUY_ACTIONS = new Set(["buy", "add"]);

  function safeNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeCode(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits ? digits.slice(-6).padStart(6, "0") : "";
  }

  function shortDate(date) {
    const text = String(date || "");
    return text.length >= 10 ? text.slice(5) : text || "-";
  }

  function tagsOf(record) {
    return Array.isArray(record?.tags) ? record.tags.filter(Boolean) : [];
  }

  function noteText(record) {
    return String(record?.note || "").trim();
  }

  function formatPrice(value) {
    const parsed = safeNumber(value);
    return parsed === null ? "" : `${parsed.toFixed(2).replace(/\.?0+$/, "")}元`;
  }

  function formatAmount(value) {
    const parsed = safeNumber(value);
    return parsed === null ? "" : `${Math.round(parsed)}元`;
  }

  function tradeMeta(record) {
    const quantity = safeNumber(record?.quantity);
    return [
      quantity === null ? "" : `${quantity}股`,
      formatPrice(record?.price),
      formatAmount(record?.amount),
    ].filter(Boolean);
  }

  function primaryTag(record) {
    const tags = tagsOf(record).filter((tag) => tag !== "买入");
    const outcome = tags.find((tag) => /回落|失败|止损|亏|卖飞/.test(tag));
    return outcome || tags[0] || "买入";
  }

  function enrichRecord(record) {
    const tags = tagsOf(record);
    const note = noteText(record);
    return {
      ...record,
      stockCode: normalizeCode(record?.stockCode) || record?.stockCode || "",
      stockName: record?.stockName || "-",
      boardName: record?.boardName || "-",
      tags,
      note,
      primaryTag: primaryTag(record),
      tradeMeta: tradeMeta(record),
      searchText: [
        record?.stockCode,
        record?.stockName,
        record?.boardName,
        note,
        ...tags,
      ].filter(Boolean).join(" ").toLowerCase(),
    };
  }

  function buyRecords(records) {
    return [...(Array.isArray(records) ? records : [])]
      .filter((record) => BUY_ACTIONS.has(record?.action))
      .map(enrichRecord)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  }

  function filterRecords(records, query = "", activeTag = "") {
    const keyword = String(query || "").trim().toLowerCase();
    const tag = String(activeTag || "").trim();
    return records.filter((record) => {
      const keywordMatched = keyword ? record.searchText.includes(keyword) : true;
      const tagMatched = tag ? record.tags.includes(tag) : true;
      return keywordMatched && tagMatched;
    });
  }

  function groupRecordsByDate(records) {
    const groups = [];
    const groupMap = new Map();
    for (const record of records) {
      const date = String(record.date || "未记录日期");
      if (!groupMap.has(date)) {
        const group = { date, label: shortDate(date), records: [] };
        groupMap.set(date, group);
        groups.push(group);
      }
      groupMap.get(date).records.push(record);
    }
    return groups;
  }

  function tagOptions(records) {
    const counts = new Map();
    for (const record of records) {
      for (const tag of record.tags) {
        if (tag === "买入") continue;
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
  }

  function summaryStats(records) {
    const latestDate = records[0]?.date || "";
    const latestRecords = latestDate ? records.filter((record) => record.date === latestDate) : [];
    return {
      total: records.length,
      latestDate,
      latestStockCount: new Set(latestRecords.map((record) => record.stockCode || record.stockName)).size,
      boardCount: new Set(records.map((record) => record.boardName).filter(Boolean)).size,
    };
  }

  return {
    buyRecords,
    filterRecords,
    groupRecordsByDate,
    shortDate,
    summaryStats,
    tagOptions,
  };
});
