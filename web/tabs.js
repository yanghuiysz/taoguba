const tabs = [...document.querySelectorAll(".tab")];
const panels = Object.fromEntries(
  [...document.querySelectorAll(".panel")].map((panel) => [panel.id.replace("panel-", ""), panel]),
);
const frameSrc = {
  kpl: "./kpl.html",
  custom: "./custom.html?v=20260429-intraday-tab-v1",
  intraday: "./intraday.html?v=20260429-intraday-tab-v1",
};
const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const INTRADAY_REFRESH_TARGET = "intraday";

function withCacheBust(src) {
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}auto=${Date.now()}`;
}

function minutesSinceMidnight(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

function isTradingRefreshWindow(now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = minutesSinceMidnight(now);
  return (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes <= 15 * 60 + 5);
}

function resizeFrame(frame) {
  try {
    const doc = frame?.contentDocument;
    if (!doc) return;
    const bodyHeight = doc.body ? doc.body.scrollHeight : 0;
    const htmlHeight = doc.documentElement ? doc.documentElement.scrollHeight : 0;
    const height = Math.max(bodyHeight, htmlHeight, 520);
    frame.style.height = `${height}px`;
  } catch {
    // Ignore cross-document timing errors; next load/resize will retry.
  }
}

function activate(target) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.target === target));
  Object.entries(panels).forEach(([name, panel]) => {
    panel.classList.toggle("active", name === target);
    if (name === target) {
      const frame = panel.querySelector("iframe");
      const expected = frameSrc[name];
      if (frame && expected && !String(frame.getAttribute("src") || "").startsWith(expected)) {
        frame.setAttribute("src", expected);
      }
      resizeFrame(frame);
    }
  });
}

function refreshIntradayFrame() {
  if (!isTradingRefreshWindow()) return;
  const panel = panels[INTRADAY_REFRESH_TARGET];
  const frame = panel?.querySelector("iframe");
  const expected = frameSrc[INTRADAY_REFRESH_TARGET];
  if (!frame || !expected) return;
  frame.setAttribute("src", withCacheBust(expected));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activate(tab.dataset.target));
});

Object.values(panels).forEach((panel) => {
  const frame = panel.querySelector("iframe");
  frame?.addEventListener("load", () => resizeFrame(frame));
});

window.addEventListener("resize", () => {
  const activePanel = document.querySelector(".panel.active");
  const activeFrame = activePanel?.querySelector("iframe");
  if (activeFrame) resizeFrame(activeFrame);
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== "dashboard:resize") return;
  const activePanel = document.querySelector(".panel.active");
  const activeFrame = activePanel?.querySelector("iframe");
  if (activeFrame) resizeFrame(activeFrame);
});

activate(document.querySelector(".tab.active")?.dataset.target || tabs[0]?.dataset.target);
window.setInterval(refreshIntradayFrame, AUTO_REFRESH_INTERVAL_MS);
