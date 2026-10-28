import { BANK_URL } from "./config.js";
import { marked } from "./vendor/marked/marked.esm.js";
import DOMPurify from "./vendor/dompurify/purify.es.mjs";

const ID_RE = /^[a-z0-9-]+$/;
const app = document.getElementById("app");
const toolbar = document.getElementById("toolbar");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

// ---------------------------------------------------------------- bank

const BANK = (() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const override = new URLSearchParams(location.search).get("bank");
  const base = local && override ? new URL(override, location.href).href : BANK_URL;
  return base.endsWith("/") ? base : `${base}/`;
})();

const cache = new Map();
function fetchText(path) {
  if (!cache.has(path)) {
    const promise = fetch(BANK + path, { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
      return res.text();
    });
    promise.catch(() => cache.delete(path));
    cache.set(path, promise);
  }
  return cache.get(path);
}

const loadIndex = () =>
  fetchText("index.json").then((text) => JSON.parse(text).problems.filter((p) => ID_RE.test(p.id)));

// ---------------------------------------------------------------- storage

const store = {
  get(key) { try { return localStorage.getItem(`pc:${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`pc:${key}`, value); } catch {} },
  remove(key) { try { localStorage.removeItem(`pc:${key}`); } catch {} },
};
const isSolved = (id) => store.get(`solved:${id}`) === "1";
const isLevelPassed = (id, n) => store.get(`passed:${id}:${n}`) === "1";

// ---------------------------------------------------------------- dom

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  fill(el, ...children);
  return el;
}

function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const ICONS = {
  maximize: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  restore: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  collapseLeft: "M15 6l-6 6 6 6",
  collapseDown: "M6 9l6 6 6-6",
  expandUp: "M6 15l6-6 6 6",
  expandRight: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}
const iconButton = (name, label, onclick) =>
  h("button", { class: "icon-button", type: "button", title: label, "aria-label": label, onclick }, icon(name));

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // External links open in a new tab; in-app #/ links stay in place.
  if (node.tagName === "A" && /^https?:/i.test(node.getAttribute("href") || "")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
const renderMarkdown = (md) => DOMPurify.sanitize(marked.parse(md));

const difficulty = (d) => h("span", { class: `difficulty ${String(d).toLowerCase()}` }, d);

// LeetCode-style value formatting: [null, true, 5] with spaces after commas.
function format(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "raises" in value) return `raise ${value.raises}`;
  if (Array.isArray(value)) return `[${value.map(format).join(", ")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${format(v)}`).join(", ")}}`;
  return JSON.stringify(value);
}

// An array rendered element by element so mismatches can be highlighted.
function formatList(values, highlight = []) {
  if (!Array.isArray(values)) return format(values);
  const parts = ["["];
  values.forEach((v, i) => {
    if (i) parts.push(", ");
    parts.push(highlight.includes(i) ? h("mark", {}, format(v)) : format(v));
  });
  parts.push("]");
  return parts;
}

// ---------------------------------------------------------------- layout

// A pane has a header (title or tabs, then actions) and a body. Panes can be
// collapsed to their header and maximized to fill the workspace.
function pane(key, { label, head, actions = [], body, collapseIcon, expandIcon }) {
  const el = h("section", { class: `pane pane-${key}`, "data-pane": key });
  const collapse = iconButton(collapseIcon, "Collapse", () => layout.toggleCollapse(key));
  const maximize = iconButton("maximize", "Maximize", () => layout.toggleMax(key));
  const strip = h("button", { class: "pane-strip", type: "button", "aria-label": "Expand", onclick: () => layout.toggleCollapse(key) },
    icon(expandIcon), h("span", {}, label));
  const header = h("div", { class: "pane-head", ondblclick: (e) => { if (!e.target.closest("button, input, textarea")) layout.toggleMax(key); } },
    head, h("span", { class: "spacer" }), actions, collapse, maximize);
  fill(el, strip, header, body);
  el.maximizeButton = maximize;
  return el;
}

const layout = {
  workspace: null,
  onChange: () => {},
  toggleMax(key) {
    const ws = this.workspace;
    const next = ws.dataset.max === key ? "" : key;
    if (next) ws.dataset.max = next;
    else delete ws.dataset.max;
    for (const p of ws.querySelectorAll(".pane")) {
      const max = p.dataset.pane === next;
      fill(p.maximizeButton, icon(max ? "restore" : "maximize"));
      p.maximizeButton.title = max ? "Restore" : "Maximize";
      p.maximizeButton.setAttribute("aria-label", p.maximizeButton.title);
    }
    if (next) ws.querySelector(`[data-pane="${next}"]`).classList.remove("collapsed");
    this.onChange();
  },
  toggleCollapse(key) {
    const ws = this.workspace;
    if (ws.dataset.max) this.toggleMax(ws.dataset.max);
    ws.querySelector(`[data-pane="${key}"]`).classList.toggle("collapsed");
    ws.classList.toggle(`${key}-collapsed`);
    this.onChange();
  },
};

function makeDivider(container, axis, variable, storeKey, min = 20, max = 80) {
  const divider = h("div", { class: `divider divider-${axis}`, role: "separator", tabindex: "0",
    "aria-orientation": axis === "x" ? "vertical" : "horizontal", "aria-label": "Resize" });
  const set = (pct) => {
    const value = `${Math.min(max, Math.max(min, pct)).toFixed(1)}%`;
    container.style.setProperty(variable, value);
    store.set(storeKey, value);
    layout.onChange();
  };
  const saved = store.get(storeKey);
  if (saved) container.style.setProperty(variable, saved);
  divider.addEventListener("pointerdown", (e) => {
    try { divider.setPointerCapture(e.pointerId); } catch {} // keeps the drag when the pointer leaves the bar
    divider.classList.add("dragging");
    const rect = container.getBoundingClientRect();
    const move = (ev) => set(axis === "x"
      ? ((ev.clientX - rect.left) / rect.width) * 100
      : ((ev.clientY - rect.top) / rect.height) * 100);
    const up = () => {
      divider.classList.remove("dragging");
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -2, ArrowUp: -2, ArrowRight: 2, ArrowDown: 2 }[e.key];
    if (!step) return;
    set((parseFloat(getComputedStyle(container).getPropertyValue(variable)) || 50) + step);
    e.preventDefault();
  });
  return divider;
}

function errorBox(err) {
  return h("div", { class: "error-box" }, h("strong", {}, "Something went wrong. "), String(err.message || err));
}

function showNotFound() {
  toolbar.replaceChildren();
  app.className = "list-view";
  fill(app, h("h1", {}, "Not found"), h("p", {}, h("a", { href: "#/" }, "Back to the start")));
}

const currentRoute = () => location.hash.replace(/^#\/?/, "");

export {
  ID_RE, app, toolbar, MOD, BANK, fetchText, loadIndex, store, isSolved, isLevelPassed,
  h, fill, icon, iconButton, renderMarkdown, difficulty, format, formatList,
  pane, layout, makeDivider, errorBox, showNotFound, currentRoute,
};
