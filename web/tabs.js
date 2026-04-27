const tabs = [...document.querySelectorAll(".tab")];
const panels = Object.fromEntries(
  [...document.querySelectorAll(".panel")].map((panel) => [panel.id.replace("panel-", ""), panel]),
);
const frameSrc = {
  kpl: "./kpl.html",
  custom: "./custom.html?v=20260427-swing-pointer-v1",
};

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
      if (frame && expected && frame.getAttribute("src") !== expected) {
        frame.setAttribute("src", expected);
      }
      resizeFrame(frame);
    }
  });
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
