import { BANK_URL, RUN_TIMEOUT_MS } from "./config.js";
import { marked } from "./vendor/marked/marked.esm.js";
import DOMPurify from "./vendor/dompurify/purify.es.mjs";

const ID_RE = /^[a-z0-9-]+$/;
const app = document.getElementById("app");
const toolbar = document.getElementById("toolbar");

// ---------------------------------------------------------------- bank

const BANK = (() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const override = new URLSearchParams(location.search).get("bank");
  const base = local && override ? new URL(override, location.href).href : BANK_URL;
  return base.endsWith("/") ? base : `${base}/`;
})();

async function fetchText(path) {
  const res = await fetch(BANK + path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.text();
}

let indexPromise;
function loadIndex() {
  indexPromise ??= fetchText("index.json")
    .then((text) => JSON.parse(text).problems.filter((p) => ID_RE.test(p.id)))
    .catch((err) => { indexPromise = undefined; throw err; });
  return indexPromise;
}

// ---------------------------------------------------------------- storage

const store = {
  get(key) { try { return localStorage.getItem(`pc:${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`pc:${key}`, value); } catch {} },
  remove(key) { try { localStorage.removeItem(`pc:${key}`); } catch {} },
};
const isSolved = (id) => store.get(`solved:${id}`) === "1";

// ---------------------------------------------------------------- dom

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});
const renderMarkdown = (md) => DOMPurify.sanitize(marked.parse(md));

const difficulty = (d) => h("span", { class: `difficulty ${String(d).toLowerCase()}` }, d);

// ---------------------------------------------------------------- runner

class Runner {
  constructor(onState) {
    this.onState = onState;
    this.pending = null;
    this.seq = 0;
    this.start();
  }

  start() {
    this.ready = false;
    this.armOnReady = null;
    this.onState("loading");
    this.worker = new Worker("runner/worker.js", { type: "module" });
    this.worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        this.ready = true;
        this.armOnReady?.();
        this.armOnReady = null;
        this.onState("ready");
      } else if (data.type === "fatal") {
        this.fail(data.error);
      } else if (data.type === "result" && this.pending?.id === data.id) {
        const { resolve, timer } = this.pending;
        clearTimeout(timer);
        this.pending = null;
        resolve(data.error ? { crashed: data.error } : data.report);
      }
    };
    this.worker.onerror = (e) => this.fail(e.message || "the worker script could not start");
  }

  fail(error) {
    this.onState("failed", error);
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.resolve({ crashed: `Python failed to load: ${error}` });
    this.pending = null;
  }

  run(solution, tests) {
    if (this.pending) return Promise.resolve({ busy: true });
    const id = ++this.seq;
    return new Promise((resolve) => {
      // The clock starts once Python is ready, so loading time is not counted.
      const arm = () => setTimeout(() => {
        this.pending = null;
        this.worker.terminate();
        this.start();
        resolve({ timeout: true });
      }, RUN_TIMEOUT_MS);
      this.pending = { id, resolve, timer: null };
      if (this.ready) this.pending.timer = arm();
      else this.armOnReady = () => { if (this.pending?.id === id) this.pending.timer = arm(); };
      this.worker.postMessage({ id, solution, tests });
    });
  }
}

let runner;
let runnerListener = () => {};
function getRunner() {
  runner ??= new Runner((state, detail) => runnerListener(state, detail));
  return runner;
}

// ---------------------------------------------------------------- list view

async function showList() {
  document.title = "Practical Coding";
  toolbar.replaceChildren();
  app.className = "list-view";
  app.replaceChildren(h("p", { class: "muted" }, "Loading problems…"));

  let problems;
  try {
    problems = await loadIndex();
  } catch (err) {
    app.replaceChildren(errorBox(err));
    return;
  }

  const solved = problems.filter((p) => isSolved(p.id)).length;
  const search = h("input", { type: "search", placeholder: "Search problems or tags", "aria-label": "Search problems" });
  const tbody = h("tbody");

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const rows = problems
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.tags || []).some((t) => t.toLowerCase().includes(q)))
      .map((p) => h("tr", { onclick: (e) => { if (e.target.tagName !== "A") location.hash = `#/p/${p.id}`; } },
        h("td", { class: "status" }, isSolved(p.id) ? h("span", { class: "check", title: "Solved" }, "✓") : ""),
        h("td", {}, h("a", { href: `#/p/${p.id}` }, p.title)),
        h("td", {}, difficulty(p.difficulty)),
        h("td", { class: "tags" }, (p.tags || []).map((t) => h("span", { class: "tag" }, t))),
      ));
    tbody.replaceChildren(...(rows.length ? rows : [h("tr", {}, h("td", { colspan: 4, class: "muted empty" }, "No problems match."))]));
  };
  search.addEventListener("input", render);
  render();

  app.replaceChildren(
    h("div", { class: "list-head" },
      h("h1", {}, "Problems"),
      h("span", { class: "muted" }, `${solved} / ${problems.length} solved`),
    ),
    search,
    h("table", { class: "problems" },
      h("thead", {}, h("tr", {}, h("th", { class: "status" }, ""), h("th", {}, "Title"), h("th", {}, "Difficulty"), h("th", {}, "Tags"))),
      tbody,
    ),
  );
}

// ---------------------------------------------------------------- problem view

async function showProblem(id) {
  if (!ID_RE.test(id)) return showNotFound();
  app.className = "problem-view";
  app.replaceChildren(h("p", { class: "muted pad" }, "Loading problem…"));
  toolbar.replaceChildren();

  let meta, readme, starter, tests;
  try {
    const problems = await loadIndex();
    meta = problems.find((p) => p.id === id);
    if (!meta) return showNotFound();
    [readme, starter, tests] = await Promise.all(
      ["README.md", "starter.py", "tests.py"].map((f) => fetchText(`problems/${id}/${f}`)),
    );
  } catch (err) {
    app.replaceChildren(errorBox(err));
    return;
  }
  if (currentRoute() !== `p/${id}`) return; // navigated away while loading

  document.title = `${meta.title} · Practical Coding`;
  const run = getRunner();

  // Statement
  const statement = h("article", { class: "markdown" });
  statement.innerHTML = renderMarkdown(readme);
  const statementPane = h("section", { class: "pane statement" },
    h("div", { class: "pane-head" },
      h("h1", {}, meta.title),
      difficulty(meta.difficulty),
      isSolved(id) ? h("span", { class: "solved-badge" }, "✓ Solved") : null,
    ),
    statement,
  );

  // Editor
  const editorHost = h("div", { class: "editor" });
  const results = h("div", { class: "results-body" },
    h("p", { class: "muted" }, "Press Run (⌘/Ctrl + Enter) to run the tests."));
  const resultsHead = h("div", { class: "results-head" }, h("span", {}, "Test results"));
  const runButton = h("button", { class: "run", type: "button", onclick: () => doRun() }, "Run");
  const engine = h("span", { class: "engine muted" });
  const resetButton = h("button", { class: "ghost", type: "button", onclick: () => {
    if (confirm("Reset your code to the starter template?")) { cm.setValue(starter); store.remove(`code:${id}`); }
  } }, "Reset");

  const codePane = h("section", { class: "pane code" },
    h("div", { class: "pane-head" }, h("span", { class: "lang" }, "Python 3"), h("span", { class: "spacer" }), resetButton),
    editorHost,
    h("div", { class: "results" }, resultsHead, results),
  );

  const divider = h("div", { class: "divider", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize panes", tabindex: "0" });
  const workspace = h("div", { class: "workspace" }, statementPane, divider, codePane);
  const savedSplit = store.get("split");
  if (savedSplit) workspace.style.setProperty("--split", savedSplit);
  makeResizable(workspace, divider);

  toolbar.replaceChildren(h("a", { class: "back", href: "#/" }, "← Problems"), h("span", { class: "spacer" }), engine, runButton);
  app.replaceChildren(workspace);

  const cm = window.CodeMirror(editorHost, {
    value: store.get(`code:${id}`) ?? starter,
    mode: "python",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    matchBrackets: true,
    extraKeys: {
      Tab: (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection(" ".repeat(c.getOption("indentUnit")), "end")),
      "Shift-Tab": (c) => c.indentSelection("subtract"),
      "Cmd-Enter": () => doRun(),
      "Ctrl-Enter": () => doRun(),
    },
  });
  let saveTimer;
  cm.on("change", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(`code:${id}`, cm.getValue()), 300); });
  cm.focus();

  const setEngine = (state, detail) => {
    engine.textContent = { loading: "Loading Python…", ready: "Python ready", failed: "Python failed to load" }[state] || "";
    engine.title = detail || "";
  };
  runnerListener = setEngine;
  setEngine(run.ready ? "ready" : "loading");

  async function doRun() {
    if (runButton.disabled) return;
    runButton.disabled = true;
    runButton.textContent = "Running…";
    results.replaceChildren(h("p", { class: "muted" }, run.ready ? "Running tests…" : "Loading Python, then running tests…"));
    store.set(`code:${id}`, cm.getValue());
    const report = await run.run(cm.getValue(), tests);
    runButton.disabled = false;
    runButton.textContent = "Run";
    renderReport(report, resultsHead, results);
    if (report.ok) {
      store.set(`solved:${id}`, "1");
      if (!statementPane.querySelector(".solved-badge")) statementPane.querySelector(".pane-head").append(h("span", { class: "solved-badge" }, "✓ Solved"));
    }
  }
}

function renderReport(report, head, body) {
  const verdict = (cls, label, extra) => fill(head, h("span", { class: `verdict ${cls}` }, label), extra ? h("span", { class: "muted" }, extra) : null);

  if (report.timeout) {
    verdict("bad", "Time Limit Exceeded", `stopped after ${RUN_TIMEOUT_MS / 1000}s`);
    fill(body, h("p", { class: "muted" }, "Your code ran too long — check for an infinite loop. Python was restarted."));
    return;
  }
  if (report.crashed) {
    verdict("bad", "Runner error");
    fill(body, h("pre", { class: "trace" }, report.crashed));
    return;
  }
  if (report.stage !== "done") {
    verdict("bad", report.stage === "load" ? "Compile Error" : "Test file error");
    fill(body, h("pre", { class: "trace" }, report.error), stdoutBlock(report.stdout));
    return;
  }

  const passed = report.tests.filter((t) => t.passed).length;
  verdict(report.ok ? "good" : "bad", report.ok ? "Accepted" : "Wrong Answer", `${passed} / ${report.tests.length} tests passed`);

  const groups = new Map();
  for (const t of report.tests) {
    const key = t.level ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const firstFailure = report.tests.find((t) => !t.passed);
  fill(body, 
    stdoutBlock(report.stdout),
    ...[...groups].map(([level, list]) => {
      const ok = list.every((t) => t.passed);
      const name = level ? `Level ${level}${report.levels?.[level] ? ` · ${report.levels[level]}` : ""}` : "Tests";
      return h("section", { class: "level" },
        h("h3", {}, h("span", { class: ok ? "good" : "bad" }, ok ? "✓" : "✗"), ` ${name}`,
          h("span", { class: "muted" }, ` ${list.filter((t) => t.passed).length}/${list.length}`)),
        list.map((t) => h("details", { class: `test ${t.passed ? "pass" : "fail"}`, open: t === firstFailure },
          h("summary", {}, h("span", { class: "mark" }, t.passed ? "✓" : "✗"), h("span", { class: "title" }, t.title), h("span", { class: "muted ms" }, `${t.ms} ms`)),
          t.failure ? h("pre", { class: "trace" }, t.failure.message) : null,
          stdoutBlock(t.stdout),
          !t.failure && !t.stdout ? h("p", { class: "muted small" }, t.name) : null,
        )),
      );
    }),
  );
}

function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

function stdoutBlock(text) {
  return text ? h("div", { class: "stdout" }, h("div", { class: "label" }, "stdout"), h("pre", {}, text)) : null;
}

function makeResizable(workspace, divider) {
  const set = (pct) => {
    const value = `${Math.min(75, Math.max(25, pct)).toFixed(1)}%`;
    workspace.style.setProperty("--split", value);
    store.set("split", value);
  };
  divider.addEventListener("pointerdown", (e) => {
    divider.setPointerCapture(e.pointerId);
    const rect = workspace.getBoundingClientRect();
    const move = (ev) => set(((ev.clientX - rect.left) / rect.width) * 100);
    const up = () => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const current = parseFloat(getComputedStyle(workspace).getPropertyValue("--split")) || 45;
    set(current + (e.key === "ArrowLeft" ? -2 : 2));
    e.preventDefault();
  });
}

function errorBox(err) {
  return h("div", { class: "error-box" }, h("strong", {}, "Something went wrong. "), String(err.message || err));
}

function showNotFound() {
  toolbar.replaceChildren();
  app.className = "list-view";
  app.replaceChildren(h("h1", {}, "Problem not found"), h("p", {}, h("a", { href: "#/" }, "Back to the problem list")));
}

// ---------------------------------------------------------------- router

const currentRoute = () => location.hash.replace(/^#\/?/, "");

function route() {
  runnerListener = () => {};
  const path = currentRoute();
  const match = path.match(/^p\/(.+)$/);
  if (match) showProblem(decodeURIComponent(match[1]));
  else showList();
}

window.addEventListener("hashchange", route);
// CodeMirror is a deferred classic script; module scripts run after it.
route();
