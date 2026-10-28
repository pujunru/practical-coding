import { RUN_TIMEOUT_MS } from "./config.js";
import {
  ID_RE, app, toolbar, MOD, fetchText, loadIndex, store, isSolved, isLevelPassed,
  h, fill, icon, iconButton, renderMarkdown, difficulty, format, formatList,
  pane, layout, makeDivider, errorBox, showNotFound, currentRoute,
} from "./lib.js";

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
    this.failed = false;
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
    this.failed = true;
    this.onState("failed", error);
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.resolve({ crashed: `Python failed to load: ${error}` });
    this.pending = null;
  }

  run(solution, cases, reference = null) {
    if (this.pending) return Promise.resolve({ crashed: "A run is already in progress." });
    if (this.failed) { this.worker.terminate(); this.start(); } // retry loading Python
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
      this.worker.postMessage({ id, solution, cases: JSON.stringify(cases), reference });
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
  fill(app, h("p", { class: "muted" }, "Loading problems…"));

  let problems;
  try {
    problems = await loadIndex();
  } catch (err) {
    fill(app, errorBox(err));
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
    fill(tbody, rows.length ? rows : h("tr", {}, h("td", { colspan: 4, class: "muted empty" }, "No problems match.")));
  };
  search.addEventListener("input", render);
  render();

  fill(app,
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

async function showProblem(id, requestedLevel) {
  if (!ID_RE.test(id)) return showNotFound();
  app.className = "problem-view";
  fill(app, h("p", { class: "muted pad" }, "Loading problem…"));
  toolbar.replaceChildren();

  let meta, problem, starter;
  try {
    meta = (await loadIndex()).find((p) => p.id === id);
    if (!meta) return showNotFound();
    let problemText;
    [problemText, starter] = await Promise.all([fetchText(`problems/${id}/problem.json`), fetchText(`problems/${id}/starter.py`)]);
    problem = JSON.parse(problemText);
  } catch (err) {
    fill(app, errorBox(err));
    return;
  }
  if (!currentRoute().startsWith(`p/${id}`)) return; // navigated away while loading

  document.title = `${meta.title} · Practical Coding`;
  const levels = problem.levels;
  const run = getRunner();
  let level = Math.min(Math.max(requestedLevel || Number(store.get(`level:${id}`)) || 1, 1), levels.length);

  // ---- description pane
  const levelTabs = h("div", { class: "level-tabs", role: "tablist", "aria-label": "Levels" });
  const levelBody = h("div", { class: "level-body" });
  const solvedBadge = h("span", { class: "solved-badge" });
  const descBody = h("div", { class: "pane-body description" },
    h("div", { class: "problem-title" }, h("h1", {}, meta.title), difficulty(meta.difficulty), solvedBadge),
    levelTabs,
    levelBody,
  );
  const descPane = pane("desc", {
    label: "Description",
    head: h("span", { class: "pane-title" }, "Description"),
    body: descBody, collapseIcon: "collapseLeft", expandIcon: "expandRight",
  });

  // ---- code pane
  const editorHost = h("div", { class: "editor" });
  const codePane = pane("code", {
    label: "Code",
    head: h("span", { class: "pane-title" }, "Code", h("span", { class: "lang" }, "Python 3")),
    actions: [h("button", { class: "ghost", type: "button", onclick: () => {
      if (confirm("Reset your code to the starter template?")) { cm.setValue(starter); store.remove(`code:${id}`); }
    } }, "Reset")],
    body: h("div", { class: "pane-body code-body" }, editorHost),
    collapseIcon: "collapseDown", expandIcon: "expandUp",
  });

  // ---- testcase / result pane
  const tabTestcase = h("button", { class: "tab active", type: "button", role: "tab", onclick: () => showTab("testcase") }, "Testcase");
  const tabResult = h("button", { class: "tab", type: "button", role: "tab", onclick: () => showTab("result") }, "Test Result");
  const testcaseBody = h("div", { class: "tab-panel testcase" });
  const resultBody = h("div", { class: "tab-panel result", hidden: true });
  const bottomPane = pane("bottom", {
    label: "Testcase",
    head: h("div", { class: "tabs", role: "tablist" }, tabTestcase, tabResult),
    body: h("div", { class: "pane-body" }, testcaseBody, resultBody),
    collapseIcon: "collapseDown", expandIcon: "expandUp",
  });
  function showTab(name) {
    tabTestcase.classList.toggle("active", name === "testcase");
    tabResult.classList.toggle("active", name === "result");
    testcaseBody.hidden = name !== "testcase";
    resultBody.hidden = name !== "result";
    if (bottomPane.classList.contains("collapsed")) layout.toggleCollapse("bottom");
  }

  // ---- workspace
  const right = h("div", { class: "right" }, codePane, null, bottomPane);
  right.insertBefore(makeDivider(right, "y", "--vsplit", "vsplit", 15, 85), bottomPane);
  const workspace = h("div", { class: "workspace" }, descPane, null, right);
  workspace.insertBefore(makeDivider(workspace, "x", "--split", "split", 20, 80), right);
  layout.workspace = workspace;

  const runButton = h("button", { class: "run", type: "button", title: `Run the testcases (${MOD} + ')`, onclick: () => doRun() }, "Run");
  const submitButton = h("button", { class: "submit", type: "button", title: `Submit (${MOD} + Enter)`, onclick: () => doSubmit() }, "Submit");
  const engine = h("span", { class: "engine muted" });
  fill(toolbar,
    h("a", { class: "back", href: "#/" }, "← Problems"),
    h("span", { class: "spacer" }),
    h("div", { class: "actions" }, runButton, submitButton),
    h("span", { class: "spacer" }, engine),
  );
  fill(app, workspace);

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
      "Cmd-'": () => doRun(),
      "Ctrl-'": () => doRun(),
      "Cmd-Enter": () => doSubmit(),
      "Ctrl-Enter": () => doSubmit(),
    },
  });
  let saveTimer;
  cm.on("change", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(`code:${id}`, cm.getValue()), 300); });
  layout.onChange = () => cm.refresh();

  const setEngine = (state, detail) => {
    engine.textContent = { loading: "Loading Python…", ready: "Python ready", failed: "Python failed to load" }[state] || "";
    engine.title = detail || "";
  };
  runnerListener = setEngine;
  setEngine(run.ready ? "ready" : "loading");

  // ---- levels
  const updateBadges = () => {
    fill(solvedBadge, isSolved(id) ? "✓ Solved" : null);
    [...levelTabs.children].forEach((tab, i) => tab.classList.toggle("passed", isLevelPassed(id, i + 1)));
  };

  async function selectLevel(n) {
    level = n;
    store.set(`level:${id}`, String(n));
    history.replaceState(null, "", `${location.pathname}${location.search}#/p/${id}/${n}`);
    [...levelTabs.children].forEach((tab, i) => {
      tab.classList.toggle("active", i + 1 === n);
      tab.setAttribute("aria-selected", String(i + 1 === n));
    });
    renderTestcases();
    fill(resultBody, h("p", { class: "muted hint" }, "You must run your code first."));
    showTab("testcase");
    fill(levelBody, h("p", { class: "muted" }, "Loading…"));
    let md;
    try {
      md = await fetchText(`problems/${id}/levels/${n}.md`);
    } catch (err) {
      fill(levelBody, errorBox(err));
      return;
    }
    if (level !== n) return;
    const statement = h("div", { class: "markdown" });
    statement.innerHTML = renderMarkdown(md);
    const examples = levels[n - 1].cases.filter((c) => c.example);
    fill(levelBody,
      h("h2", { class: "level-heading" }, `Level ${n} · ${levels[n - 1].title}`),
      statement,
      examples.map((c, i) => h("div", { class: "example" },
        h("h3", {}, `Example ${i + 1}`),
        h("div", { class: "example-box" },
          h("div", { class: "label" }, "Input"),
          h("pre", {}, `${format(c.ops)}\n${format(c.args)}`),
          h("div", { class: "label" }, "Output"),
          h("pre", {}, format(c.expected)),
          c.explanation ? [h("div", { class: "label" }, "Explanation"), h("p", {}, c.explanation)] : null,
        ),
      )),
    );
    levelBody.parentElement.scrollTop = 0;
  }

  fill(levelTabs, levels.map((l, i) => h("button", {
    class: "level-tab", type: "button", role: "tab", title: `Level ${i + 1} · ${l.title}`, onclick: () => selectLevel(i + 1),
  }, h("span", { class: "level-check", "aria-hidden": "true" }, "✓"), h("span", { class: "level-word" }, "Level "), `${i + 1}`)));

  // ---- testcases: editable text, seeded from the level's examples
  const testcaseKey = () => `tc:${id}:${level}`;
  const defaultTestcases = () => levels[level - 1].cases.filter((c) => c.example)
    .map((c) => ({ ops: format(c.ops), args: format(c.args) }));
  let testcases = [];
  let selectedCase = 0;

  function loadTestcases() {
    try { testcases = JSON.parse(store.get(testcaseKey())) || defaultTestcases(); } catch { testcases = defaultTestcases(); }
    if (!Array.isArray(testcases) || !testcases.length) testcases = defaultTestcases();
    selectedCase = 0;
  }
  const saveTestcases = () => store.set(testcaseKey(), JSON.stringify(testcases));

  function renderTestcases() {
    loadTestcases();
    drawTestcases();
  }

  function drawTestcases() {
    const tc = testcases[selectedCase];
    const field = (label, key) => h("label", { class: "field" },
      h("span", { class: "label" }, `${label} =`),
      h("textarea", { rows: 2, spellcheck: "false", autocapitalize: "off", oninput: (e) => { tc[key] = e.target.value; saveTestcases(); } }, tc[key]),
    );
    fill(testcaseBody,
      h("div", { class: "case-chips" },
        testcases.map((_, i) => h("span", { class: `chip${i === selectedCase ? " active" : ""}` },
          h("button", { type: "button", onclick: () => { selectedCase = i; drawTestcases(); } }, `Case ${i + 1}`),
          testcases.length > 1 ? h("button", { type: "button", class: "chip-remove", "aria-label": `Remove case ${i + 1}`, onclick: () => {
            testcases.splice(i, 1);
            selectedCase = Math.min(selectedCase, testcases.length - 1);
            saveTestcases();
            drawTestcases();
          } }, icon("close")) : null,
        )),
        testcases.length < 8 ? iconButton("plus", "Add a testcase (copies the current one)", () => {
          testcases.push({ ...testcases[selectedCase] });
          selectedCase = testcases.length - 1;
          saveTestcases();
          drawTestcases();
        }) : null,
        h("span", { class: "spacer" }),
        h("button", { class: "link", type: "button", onclick: () => { store.remove(testcaseKey()); renderTestcases(); } }, "Reset testcases"),
      ),
      field("operations", "ops"),
      field("arguments", "args"),
      h("p", { class: "muted small" }, "Expected output comes from the reference solution."),
    );
  }

  function parseTestcases() {
    return testcases.map((tc, i) => {
      let ops, args;
      try { ops = JSON.parse(tc.ops); } catch { throw new Error(`Case ${i + 1}: operations is not valid JSON.`); }
      try { args = JSON.parse(tc.args); } catch { throw new Error(`Case ${i + 1}: arguments is not valid JSON.`); }
      if (!Array.isArray(ops) || !ops.length || !ops.every((o) => typeof o === "string")) throw new Error(`Case ${i + 1}: operations must be a list of names.`);
      if (!Array.isArray(args) || !args.every(Array.isArray)) throw new Error(`Case ${i + 1}: arguments must be a list of lists.`);
      if (ops.length !== args.length) throw new Error(`Case ${i + 1}: ${ops.length} operations but ${args.length} argument lists.`);
      return { ops, args };
    });
  }

  // ---- running
  function busy(on, which) {
    runButton.disabled = submitButton.disabled = on;
    which.textContent = on ? (which === runButton ? "Running…" : "Judging…") : (which === runButton ? "Run" : "Submit");
  }

  async function doRun() {
    if (runButton.disabled) return;
    let cases;
    try {
      cases = parseTestcases();
    } catch (err) {
      showTab("result");
      fill(resultBody, verdictLine("bad", "Invalid testcase"), h("pre", { class: "trace" }, err.message));
      return;
    }
    busy(true, runButton);
    showTab("result");
    fill(resultBody, h("p", { class: "muted hint" }, run.ready ? "Running…" : "Loading Python, then running…"));
    store.set(`code:${id}`, cm.getValue());
    let reference;
    try {
      reference = await fetchText(`problems/${id}/solution.py`);
    } catch (err) {
      busy(false, runButton);
      fill(resultBody, errorBox(err));
      return;
    }
    const report = await run.run(cm.getValue(), cases, reference);
    busy(false, runButton);
    renderRunReport(report, cases);
  }

  async function doSubmit() {
    if (submitButton.disabled) return;
    busy(true, submitButton);
    showTab("result");
    fill(resultBody, h("p", { class: "muted hint" }, run.ready ? "Judging…" : "Loading Python, then judging…"));
    store.set(`code:${id}`, cm.getValue());
    const judged = levels.slice(0, level);
    const cases = judged.flatMap((l) => l.cases);
    const report = await run.run(cm.getValue(), cases);
    busy(false, submitButton);
    renderSubmitReport(report, cases, judged);
  }

  function failureVerdict(report) {
    if (report.timeout) {
      fill(resultBody, verdictLine("bad", "Time Limit Exceeded", `stopped after ${RUN_TIMEOUT_MS / 1000}s`),
        h("p", { class: "muted" }, "Your code ran too long — check for an infinite loop. Python was restarted."));
      return true;
    }
    if (report.crashed) {
      fill(resultBody, verdictLine("bad", "Runner Error"), h("pre", { class: "trace" }, report.crashed));
      return true;
    }
    if (report.stage !== "done") {
      fill(resultBody, verdictLine("bad", report.stage === "load" ? "Compile Error" : "Invalid testcase"),
        h("pre", { class: "trace" }, report.error), outputBlock("Stdout", report.stdout));
      return true;
    }
    return false;
  }

  function renderRunReport(report, cases) {
    if (failureVerdict(report)) return;
    const ms = report.cases.reduce((sum, c) => sum + c.ms, 0);
    let shown = Math.max(0, report.cases.findIndex((c) => !c.passed));
    const detail = h("div");
    const chips = h("div", { class: "case-chips" });
    const draw = () => {
      fill(chips, report.cases.map((c, i) => h("span", { class: `chip ${c.passed ? "pass" : "fail"}${i === shown ? " active" : ""}` },
        h("button", { type: "button", onclick: () => { shown = i; draw(); } }, h("span", { class: "dot" }), `Case ${i + 1}`))));
      fill(detail, caseDetail(cases[shown], report.cases[shown]));
    };
    draw();
    fill(resultBody,
      verdictLine(report.ok ? "good" : "bad", report.ok ? "Accepted" : "Wrong Answer", `Runtime: ${ms.toFixed(1)} ms`),
      outputBlock("Stdout (module level)", report.stdout),
      chips,
      detail,
    );
  }

  function renderSubmitReport(report, cases, judged) {
    if (failureVerdict(report)) return;
    const passed = report.cases.filter((c) => c.passed).length;
    let offset = 0;
    const rows = judged.map((l, i) => {
      const slice = report.cases.slice(offset, offset + l.cases.length);
      offset += l.cases.length;
      const ok = slice.every((c) => c.passed);
      return h("div", { class: `level-row ${ok ? "pass" : "fail"}` },
        h("span", { class: "mark" }, ok ? "✓" : "✗"),
        h("span", {}, `Level ${i + 1} · ${l.title}`),
        h("span", { class: "spacer" }),
        h("span", { class: "muted" }, `${slice.filter((c) => c.passed).length} / ${slice.length}`));
    });

    const firstFail = report.cases.findIndex((c) => !c.passed);
    if (report.ok) {
      // Submit judges this level and every earlier one, so all of them passed.
      for (let n = 1; n <= level; n++) store.set(`passed:${id}:${n}`, "1");
      if (levels.every((_, i) => isLevelPassed(id, i + 1))) store.set(`solved:${id}`, "1");
      updateBadges();
    }
    const next = report.ok && level < levels.length
      ? h("button", { class: "submit next", type: "button", onclick: () => selectLevel(level + 1) }, `Next: Level ${level + 1} →`)
      : null;
    fill(resultBody,
      verdictLine(report.ok ? "good" : "bad", report.ok ? "Accepted" : "Wrong Answer", `${passed} / ${report.cases.length} testcases passed`),
      h("div", { class: "level-rows" }, rows),
      next,
      firstFail >= 0 ? [h("h4", { class: "detail-title" }, "Failing testcase"), caseDetail(cases[firstFail], report.cases[firstFail])] : null,
    );
  }

  window.onkeydown = (e) => {
    if (e.key === "Escape" && workspace.dataset.max) layout.toggleMax(workspace.dataset.max);
  };

  await selectLevel(level);
  updateBadges();
  cm.focus();
}

function verdictLine(cls, label, extra) {
  return h("div", { class: "verdict-line" }, h("span", { class: `verdict ${cls}` }, label), extra ? h("span", { class: "muted" }, extra) : null);
}

function outputBlock(label, text, cls = "") {
  return text ? h("div", { class: `io ${cls}` }, h("div", { class: "label" }, label), h("pre", {}, text)) : null;
}

function caseDetail(input, result) {
  return h("div", { class: "case-detail" },
    h("div", { class: "io" }, h("div", { class: "label" }, "Input"), h("pre", {}, `${format(input.ops)}\n${format(input.args)}`)),
    outputBlock("Stdout", result.stdout),
    result.trace && !result.passed ? outputBlock("Runtime Error", result.trace, "error") : null,
    h("div", { class: `io ${result.passed ? "" : "wrong"}` }, h("div", { class: "label" }, "Output"), h("pre", {}, formatList(result.output, result.diff))),
    h("div", { class: "io" }, h("div", { class: "label" }, "Expected"), h("pre", {}, formatList(result.expected, result.diff))),
  );
}

// Called by the router before every view change.
export function leaveCoding() {
  runnerListener = () => {};
}

export { showList, showProblem };
