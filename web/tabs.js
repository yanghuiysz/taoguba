const tabs = [...document.querySelectorAll(".tab")];
const panels = {
  taoguba: document.querySelector("#panel-taoguba"),
  kpl: document.querySelector("#panel-kpl"),
};

function activate(target) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.target === target));
  Object.entries(panels).forEach(([name, panel]) => {
    panel.classList.toggle("active", name === target);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activate(tab.dataset.target));
});
