// System design: design-question list and workspace.
import {
  ID_RE, app, toolbar, fetchText, store, h, fill, renderMarkdown, difficulty,
  pane, layout, makeDivider, errorBox, showNotFound, currentRoute,
} from "./lib.js";

const Q_ROOT = "system-design/questions/";

const loadJson = async (path) => JSON.parse(await fetchText(path));
const loadQuestions = () => loadJson(`${Q_ROOT}index.json`);

// ---------------------------------------------------------------- progress

// Per question: {answers: {step: text}, ticks: [bool], revealed, best, elapsed}.
const questionState = (id) => { try { return JSON.parse(store.get(`sdq:${id}`)) || {}; } catch { return {}; } };
const saveQuestion = (id, patch) => store.set(`sdq:${id}`, JSON.stringify({ ...questionState(id), ...patch }));

const md = (text, cls = "markdown") => {
  const el = h("div", { class: cls });
  el.innerHTML = renderMarkdown(text || "");
  return el;
};

// ---------------------------------------------------------------- questions list

export async function showQuestions() {
  document.title = "Design Questions · Practical Coding";
  toolbar.replaceChildren();
  app.className = "list-view";
  fill(app, h("p", { class: "muted" }, "Loading questions…"));
  let index;
  try {
    index = await loadQuestions();
  } catch (err) {
    fill(app, errorBox(err));
    return;
  }
  const all = index.categories.flatMap((c) => c.questions);
  const done = all.filter((q) => questionState(q.id).revealed).length;
  const search = h("input", { type: "search", placeholder: "Search questions or companies", "aria-label": "Search questions" });
  const body = h("div");
  const render = () => {
    const s = search.value.trim().toLowerCase();
    const match = (q) => !s || q.title.toLowerCase().includes(s) || (q.companies || []).some((c) => c.toLowerCase().includes(s));
    fill(body, index.categories.map((cat) => {
      const rows = cat.questions.filter(match);
      if (!rows.length) return null;
      return h("section", { class: "question-section" },
        h("h2", {}, cat.title),
        h("table", { class: "problems" }, h("tbody", {}, rows.map((q) => {
          const st = questionState(q.id);
          return h("tr", { onclick: (e) => { if (e.target.tagName !== "A") location.hash = `#/sd/q/${q.id}`; } },
            h("td", { class: "status" }, st.revealed ? h("span", { class: "check", title: `Best ${st.best ?? 0}%` }, "✓") : ""),
            h("td", {}, h("a", { href: `#/sd/q/${q.id}` }, q.title)),
            h("td", { class: "score" }, st.best != null ? h("span", { class: "muted small" }, `${st.best}%`) : ""),
            h("td", { class: "diff" }, difficulty(q.difficulty)),
            h("td", { class: "tags" }, (q.companies || []).map((c) => h("span", { class: "tag" }, c))));
        }))));
    }));
    if (!body.children.length) fill(body, h("p", { class: "muted" }, "No questions match."));
  };
  search.addEventListener("input", render);
  render();
  fill(app,
    h("div", { class: "list-head" }, h("h1", {}, "Design Questions"), h("span", { class: "muted" }, `${done} / ${all.length} attempted`)),
    h("p", { class: "muted lede" }, "Work through a question in the usual interview steps against a timer, then reveal a reference outline and score yourself on its checklist."),
    search, body);
}

// ---------------------------------------------------------------- question workspace

const STEPS = [
  ["requirements", "Requirements", "Functional and non-functional requirements. What is in and out of scope?"],
  ["estimation", "Estimation", "Users, QPS (read/write), storage, bandwidth. Which number drives the design?"],
  ["api", "API", "The main endpoints or RPCs: inputs, outputs, idempotency, pagination."],
  ["data", "Data model", "Entities, keys, indexes, and which store each lives in. Access patterns first."],
  ["design", "High-level design", "Components and the request flow for the main use cases."],
  ["deepdives", "Deep dives", "The two or three hardest parts: scaling, consistency, hot spots, failure."],
  ["wrapup", "Wrap-up", "Bottlenecks, trade-offs you made, what you would do next."],
];

export async function showQuestion(id) {
  if (!ID_RE.test(id)) return showNotFound();
  app.className = "problem-view";
  fill(app, h("p", { class: "muted pad" }, "Loading question…"));
  toolbar.replaceChildren();
  let meta, q;
  try {
    const index = await loadQuestions();
    meta = index.categories.flatMap((c) => c.questions).find((x) => x.id === id);
    if (!meta) return showNotFound();
    q = await loadJson(`${Q_ROOT}${id}.json`);
  } catch (err) {
    fill(app, errorBox(err));
    return;
  }
  if (currentRoute() !== `sd/q/${id}`) return;
  document.title = `${meta.title} · Design Questions`;
  let state = questionState(id);
  const answers = { ...(state.answers || {}) };

  // ---- left: prompt / reference
  const tabPrompt = h("button", { class: "tab active", type: "button", role: "tab", onclick: () => showLeft("prompt") }, "Prompt");
  const tabRef = h("button", { class: "tab", type: "button", role: "tab", onclick: () => showLeft("reference") }, "Reference");
  const promptBody = h("div", { class: "tab-panel description" },
    h("div", { class: "problem-title" }, h("h1", {}, meta.title), difficulty(meta.difficulty)),
    (meta.companies || []).length ? h("p", { class: "tags" }, (meta.companies || []).map((c) => h("span", { class: "tag" }, c))) : null,
    md(q.prompt),
    q.clarify?.length ? h("details", { class: "notes" }, h("summary", {}, "Questions worth asking the interviewer"),
      h("ul", {}, q.clarify.map((c) => h("li", {}, c)))) : null,
  );
  const refBody = h("div", { class: "tab-panel description", hidden: true });
  const descPane = pane("desc", {
    label: "Prompt",
    head: h("div", { class: "tabs", role: "tablist" }, tabPrompt, tabRef),
    body: h("div", { class: "pane-body" }, promptBody, refBody),
    collapseIcon: "collapseLeft", expandIcon: "expandRight",
  });
  function showLeft(name) {
    tabPrompt.classList.toggle("active", name === "prompt");
    tabRef.classList.toggle("active", name === "reference");
    promptBody.hidden = name !== "prompt";
    refBody.hidden = name !== "reference";
  }

  // ---- right top: answer by step
  let step = store.get(`sdq:step:${id}`) || "requirements";
  const stepTabs = h("div", { class: "step-tabs", role: "tablist" });
  const hint = h("p", { class: "muted small step-hint" });
  const editor = h("textarea", { class: "answer", spellcheck: "true", "aria-label": "Your answer for this step" });
  let saveTimer;
  editor.addEventListener("input", () => {
    answers[step] = editor.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveQuestion(id, { answers }), 300);
    drawStepTabs();
    if (state.revealed) drawChecklist();
  });
  function selectStep(key) {
    step = key;
    store.set(`sdq:step:${id}`, key);
    const s = STEPS.find((x) => x[0] === key);
    hint.textContent = s[2];
    editor.value = answers[key] || "";
    editor.placeholder = `${s[1]} — write as you would talk it through.`;
    drawStepTabs();
    if (state.revealed) drawReference();
  }
  function drawStepTabs() {
    fill(stepTabs, STEPS.map(([key, title], i) => h("button", {
      type: "button", role: "tab", class: `step-tab${key === step ? " active" : ""}${(answers[key] || "").trim() ? " filled" : ""}`,
      "aria-selected": String(key === step), onclick: () => selectStep(key),
    }, h("span", { class: "step-n" }, String(i + 1)), h("span", { class: "step-name" }, title))));
  }
  const codePane = pane("code", {
    label: "Answer",
    head: h("span", { class: "pane-title" }, "Your answer"),
    body: h("div", { class: "pane-body answer-body" }, stepTabs, hint, editor),
    collapseIcon: "collapseDown", expandIcon: "expandUp",
  });

  // ---- right bottom: checklist
  const checklist = h("div", { class: "tab-panel" });
  const bottomPane = pane("bottom", {
    label: "Checklist",
    head: h("span", { class: "pane-title" }, "Self-check"),
    body: h("div", { class: "pane-body" }, checklist),
    collapseIcon: "collapseDown", expandIcon: "expandUp",
  });

  const right = h("div", { class: "right" }, codePane, null, bottomPane);
  right.insertBefore(makeDivider(right, "y", "--vsplit", "sd-vsplit", 15, 85), bottomPane);
  const workspace = h("div", { class: "workspace" }, descPane, null, right);
  workspace.insertBefore(makeDivider(workspace, "x", "--split", "sd-split", 20, 80), right);
  layout.workspace = workspace;
  layout.onChange = () => {};

  // ---- timer
  const minutes = q.minutes || 45;
  let elapsed = state.elapsed || 0;
  let ticking = null;
  const clock = h("span", { class: "clock", "aria-live": "off" });
  const startButton = h("button", { class: "run", type: "button", onclick: () => (ticking ? pause() : start()) });
  const drawClock = () => {
    const left = minutes * 60 - elapsed;
    const abs = Math.abs(left);
    clock.textContent = `${left < 0 ? "+" : ""}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
    clock.classList.toggle("over", left < 0);
    startButton.textContent = ticking ? "Pause" : elapsed ? "Resume" : "Start";
  };
  const start = () => { ticking = setInterval(() => { elapsed++; if (elapsed % 5 === 0) saveQuestion(id, { elapsed }); drawClock(); }, 1000); drawClock(); };
  const pause = () => { clearInterval(ticking); ticking = null; saveQuestion(id, { elapsed }); drawClock(); };
  drawClock();
  const revealButton = h("button", { class: "submit", type: "button", onclick: () => reveal() }, "Reveal", h("span", { class: "wide-only" }, " reference"));

  fill(toolbar,
    h("a", { class: "back", href: "#/sd/questions" }, "← Questions"),
    h("span", { class: "spacer" }),
    h("div", { class: "actions" }, clock, startButton, revealButton),
    h("span", { class: "spacer" }),
  );
  fill(app, workspace);
  window.addEventListener("hashchange", () => { clearInterval(ticking); if (elapsed) saveQuestion(id, { elapsed }); }, { once: true });

  // ---- reveal and score
  const mentioned = (item) => {
    const text = Object.values(answers).join("\n").toLowerCase();
    return (item.keywords || []).some((k) => text.includes(k.toLowerCase()));
  };
  function reveal() {
    if (!state.revealed) {
      if (ticking) pause();
      saveQuestion(id, { revealed: true, ticks: [] });
      state = questionState(id);
    }
    fill(revealButton, "Revealed");
    revealButton.disabled = true;
    drawReference();
    drawChecklist();
    showLeft("reference");
  }
  function drawReference() {
    const s = STEPS.find((x) => x[0] === step);
    fill(refBody,
      h("div", { class: "problem-title" }, h("h1", {}, "Reference outline")),
      h("p", { class: "muted small" }, "One good answer, not the only one. The section for the step you are on is open."),
      STEPS.filter(([key]) => q.reference?.[key]).map(([key, title]) => h("details", { class: "ref-step", open: key === s[0] },
        h("summary", {}, title), md(q.reference[key]))),
    );
  }
  function drawChecklist() {
    const rubric = q.rubric || [];
    if (!state.revealed) {
      fill(checklist,
        h("p", { class: "muted hint" }, "Answer first, then reveal the reference to score yourself against its checklist."),
        h("p", { class: "muted small" }, `${rubric.length} checklist items · ${minutes} minutes suggested`));
      return;
    }
    const ticks = state.ticks || [];
    const total = rubric.reduce((n, r) => n + (r.points || 1), 0);
    const got = rubric.reduce((n, r, i) => n + (ticks[i] ? r.points || 1 : 0), 0);
    const pct = total ? Math.round((100 * got) / total) : 0;
    if (pct > (state.best ?? -1)) saveQuestion(id, { best: pct });
    fill(checklist,
      h("div", { class: "verdict-line" }, h("span", { class: `verdict ${pct >= 70 ? "good" : "bad"}` }, `${pct}%`),
        h("span", { class: "muted" }, `${got} / ${total} points · tick what your answer really covered`)),
      h("ul", { class: "rubric" }, rubric.map((r, i) => h("li", {},
        h("label", {},
          h("input", { type: "checkbox", checked: !!ticks[i], onchange: (e) => {
            const next = [...(questionState(id).ticks || [])];
            next[i] = e.target.checked;
            saveQuestion(id, { ticks: next });
            state = questionState(id);
            drawChecklist();
          } }),
          h("span", {}, r.text),
          mentioned(r) ? h("span", { class: "mentioned", title: "A keyword for this item appears in your answer — check that you really covered it" }, "mentioned") : null,
          (r.points || 1) > 1 ? h("span", { class: "muted small" }, `${r.points} pts`) : null)))),
      h("button", { class: "link", type: "button", onclick: () => {
        if (!confirm("Clear your answer, checklist and timer for this question?")) return;
        store.remove(`sdq:${id}`);
        showQuestion(id);
      } }, "Start over"),
    );
  }

  selectStep(STEPS.some((s) => s[0] === step) ? step : "requirements");
  drawChecklist();
  if (state.revealed) reveal();
  window.onkeydown = (e) => {
    if (e.key === "Escape" && workspace.dataset.max) layout.toggleMax(workspace.dataset.max);
  };
}
