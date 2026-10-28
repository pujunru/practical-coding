// System design: fundamentals drills and design-question workspaces.
import {
  ID_RE, app, toolbar, fetchText, store, h, fill, renderMarkdown, difficulty,
  pane, layout, makeDivider, errorBox, showNotFound, currentRoute,
} from "./lib.js";

const F_ROOT = "system-design/fundamentals/";
const Q_ROOT = "system-design/questions/";

const loadJson = async (path) => JSON.parse(await fetchText(path));
const loadFundamentals = () => loadJson(`${F_ROOT}index.json`);
const loadQuestions = () => loadJson(`${Q_ROOT}index.json`);

// ---------------------------------------------------------------- progress

// Per concept: {"<drill index>": "ok" | "bad"}.
const drillState = (id) => { try { return JSON.parse(store.get(`sdf:${id}`)) || {}; } catch { return {}; } };
const saveDrill = (id, i, result) => store.set(`sdf:${id}`, JSON.stringify({ ...drillState(id), [i]: result }));
const conceptScore = (id) => Object.values(drillState(id)).filter((v) => v === "ok").length;
const conceptMistakes = (id) => Object.values(drillState(id)).filter((v) => v === "bad").length;

// Per question: {answers: {step: text}, ticks: [bool], revealed, best, elapsed}.
const questionState = (id) => { try { return JSON.parse(store.get(`sdq:${id}`)) || {}; } catch { return {}; } };
const saveQuestion = (id, patch) => store.set(`sdq:${id}`, JSON.stringify({ ...questionState(id), ...patch }));

// Deterministic shuffle, so a drill looks the same every visit.
function seeded(seed) {
  let a = [...seed].reduce((x, c) => Math.imul(x ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(n, seed) {
  const order = [...Array(n).keys()];
  const rand = seeded(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const md = (text, cls = "markdown") => {
  const el = h("div", { class: cls });
  el.innerHTML = renderMarkdown(text || "");
  return el;
};

const bar = (value, total) => h("span", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(value) },
  h("span", { style: `width:${total ? (100 * value) / total : 0}%` }));

// ---------------------------------------------------------------- fundamentals map

export async function showFundamentals() {
  document.title = "Fundamentals · Practical Coding";
  toolbar.replaceChildren();
  app.className = "list-view wide";
  fill(app, h("p", { class: "muted" }, "Loading fundamentals…"));
  let index;
  try {
    index = await loadFundamentals();
  } catch (err) {
    fill(app, errorBox(err));
    return;
  }

  const concepts = index.categories.flatMap((c) => c.concepts);
  const total = concepts.reduce((n, c) => n + c.drills, 0);
  const correct = concepts.reduce((n, c) => n + Math.min(conceptScore(c.id), c.drills), 0);
  const mistakes = concepts.filter((c) => conceptMistakes(c.id)).length;
  const search = h("input", { type: "search", placeholder: "Search concepts", "aria-label": "Search concepts" });
  const sections = h("div", { class: "concept-sections" });

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shownSections = index.categories.map((cat) => {
      const shown = cat.concepts.filter((c) => !q || c.title.toLowerCase().includes(q) || cat.title.toLowerCase().includes(q));
      if (!shown.length) return null;
      const done = cat.concepts.reduce((n, c) => n + Math.min(conceptScore(c.id), c.drills), 0);
      const all = cat.concepts.reduce((n, c) => n + c.drills, 0);
      return h("section", { class: "concept-section" },
        h("div", { class: "section-head" }, h("h2", {}, cat.title), h("span", { class: "muted small" }, `${done} / ${all}`)),
        h("div", { class: "concept-grid" }, shown.map((c) => {
          const score = Math.min(conceptScore(c.id), c.drills);
          return h("a", { class: `concept-card${score === c.drills ? " done" : ""}`, href: `#/sd/f/${c.id}` },
            h("span", { class: "concept-title" }, c.title),
            h("span", { class: "concept-meta" }, bar(score, c.drills), h("span", { class: "muted small" }, `${score}/${c.drills}`)));
        })),
      );
    }).filter(Boolean);
    fill(sections, shownSections.length ? shownSections : h("p", { class: "muted" }, "No concepts match."));
  };
  search.addEventListener("input", render);
  render();

  fill(app,
    h("div", { class: "list-head" },
      h("h1", {}, "Fundamentals"),
      h("span", { class: "muted" }, `${correct} / ${total} drills correct`),
      h("span", { class: "spacer" }),
      mistakes ? h("a", { class: "pill-link", href: "#/sd/review" }, `Review mistakes (${mistakes})`) : null,
    ),
    h("p", { class: "muted lede" }, "Every concept has a short mental model and drills: multiple choice, ordering, back-of-the-envelope numbers and recall."),
    search,
    sections,
  );
}

export async function showReview() {
  document.title = "Review · Practical Coding";
  toolbar.replaceChildren();
  app.className = "list-view";
  let index;
  try {
    index = await loadFundamentals();
  } catch (err) {
    fill(app, errorBox(err));
    return;
  }
  const missed = index.categories.flatMap((cat) => cat.concepts.map((c) => ({ ...c, cat: cat.title }))).filter((c) => conceptMistakes(c.id));
  fill(app,
    h("p", {}, h("a", { class: "back", href: "#/sd/fundamentals" }, "← Fundamentals")),
    h("h1", {}, "Review mistakes"),
    missed.length
      ? h("div", { class: "concept-grid" }, missed.map((c) => h("a", { class: "concept-card", href: `#/sd/f/${c.id}` },
        h("span", { class: "concept-title" }, c.title),
        h("span", { class: "muted small" }, `${c.cat} · ${conceptMistakes(c.id)} to redo`))))
      : h("p", { class: "muted" }, "Nothing to review — every drill you answered was right."),
  );
}

// ---------------------------------------------------------------- concept page

export async function showConcept(id) {
  if (!ID_RE.test(id)) return showNotFound();
  toolbar.replaceChildren();
  app.className = "list-view";
  fill(app, h("p", { class: "muted" }, "Loading…"));
  let index, concept;
  try {
    index = await loadFundamentals();
    concept = await loadJson(`${F_ROOT}${id}.json`);
  } catch (err) {
    fill(app, errorBox(err));
    return;
  }
  if (currentRoute() !== `sd/f/${id}`) return;
  const order = index.categories.flatMap((cat) => cat.concepts.map((c) => ({ ...c, cat: cat.title })));
  const at = order.findIndex((c) => c.id === id);
  const cat = order[at]?.cat || "";
  const prev = order[at - 1];
  const next = order[at + 1];
  document.title = `${concept.title} · Fundamentals`;

  const notesOpen = store.get("sdf:notes") !== "closed";
  const notes = h("details", { class: "notes", open: notesOpen, ontoggle: (e) => store.set("sdf:notes", e.target.open ? "open" : "closed") },
    h("summary", {}, "Mental model"), md(concept.summary));
  const score = h("span", { class: "muted" });
  const updateScore = () => { score.textContent = `${Math.min(conceptScore(id), concept.drills.length)} / ${concept.drills.length} correct`; };
  updateScore();

  fill(app,
    h("p", { class: "crumbs" }, h("a", { href: "#/sd/fundamentals" }, "Fundamentals"), h("span", { class: "muted" }, ` / ${cat}`)),
    h("div", { class: "list-head" }, h("h1", {}, concept.title), score, h("span", { class: "spacer" }),
      h("button", { class: "link", type: "button", onclick: () => { store.remove(`sdf:${id}`); showConcept(id); } }, "Reset")),
    notes,
    h("div", { class: "drills" }, concept.drills.map((d, i) => drillCard(id, d, i, concept.drills.length, updateScore))),
    h("nav", { class: "pager" },
      prev ? h("a", { href: `#/sd/f/${prev.id}` }, `← ${prev.title}`) : h("span"),
      next ? h("a", { href: `#/sd/f/${next.id}` }, `${next.title} →`) : h("span")),
  );
}

const DRILL_LABEL = { choice: "Multiple choice", order: "Put in order", number: "Estimate", recall: "Recall" };

function drillCard(conceptId, drill, i, total, onResult) {
  const previous = drillState(conceptId)[i];
  const feedback = h("div", { class: "feedback", "aria-live": "polite" });
  const record = (ok, message) => {
    saveDrill(conceptId, i, ok ? "ok" : "bad");
    card.classList.toggle("is-ok", ok);
    card.classList.toggle("is-bad", !ok);
    fill(feedback,
      h("div", { class: `verdict ${ok ? "good" : "bad"}` }, ok ? "Correct" : "Not quite"),
      typeof message === "string" ? h("p", { class: "small" }, message) : message,
      drill.explain ? md(drill.explain, "markdown explain") : null);
    onResult();
  };
  const body = { choice: choiceDrill, order: orderDrill, number: numberDrill, recall: recallDrill }[drill.type]?.(drill, `${conceptId}:${i}`, record, feedback);
  const card = h("article", { class: `drill${previous ? ` is-${previous}` : ""}` },
    h("div", { class: "drill-head" },
      h("span", { class: "drill-n" }, `${i + 1} / ${total}`),
      h("span", { class: "drill-type" }, DRILL_LABEL[drill.type] || drill.type),
      previous ? h("span", { class: `drill-prev ${previous}` }, previous === "ok" ? "✓ answered" : "✗ retry") : null),
    md(drill.q, "markdown drill-q"),
    body || h("p", { class: "muted" }, `Unknown drill type: ${drill.type}`),
    feedback);
  return card;
}

function choiceDrill(drill, seed, record) {
  const multi = drill.answer.length > 1;
  const order = shuffled(drill.options.length, seed);
  const picked = new Set();
  const buttons = order.map((oi) => {
    const b = h("button", { type: "button", class: "option", "aria-pressed": "false", onclick: () => {
      if (!multi) { picked.clear(); buttons.forEach((x) => x.setAttribute("aria-pressed", "false")); }
      picked.has(oi) ? picked.delete(oi) : picked.add(oi);
      b.setAttribute("aria-pressed", String(picked.has(oi)));
    } }, md(drill.options[oi], "markdown inline"));
    b.dataset.index = oi;
    return b;
  });
  const check = h("button", { type: "button", class: "submit small-button", onclick: () => {
    if (!picked.size) return;
    const right = new Set(drill.answer);
    const ok = picked.size === right.size && [...picked].every((x) => right.has(x));
    buttons.forEach((b) => {
      const oi = Number(b.dataset.index);
      b.classList.toggle("right", right.has(oi));
      b.classList.toggle("wrong", picked.has(oi) && !right.has(oi));
    });
    record(ok);
  } }, "Check");
  return h("div", {}, multi ? h("p", { class: "muted small" }, "Select all that apply.") : null, h("div", { class: "options" }, buttons), check);
}

function orderDrill(drill, seed, record) {
  let order = shuffled(drill.items.length, seed);
  if (order.every((x, i) => x === i)) order = order.reverse();
  const list = h("ol", { class: "order-list" });
  const draw = (marks) => fill(list, order.map((item, pos) => h("li", { class: marks ? (marks[pos] ? "right" : "wrong") : "" },
    md(drill.items[item], "markdown inline"),
    h("span", { class: "order-buttons" },
      h("button", { type: "button", class: "icon-button", "aria-label": "Move up", disabled: pos === 0, onclick: () => move(pos, -1) }, "↑"),
      h("button", { type: "button", class: "icon-button", "aria-label": "Move down", disabled: pos === order.length - 1, onclick: () => move(pos, 1) }, "↓")))));
  const move = (pos, d) => { [order[pos], order[pos + d]] = [order[pos + d], order[pos]]; draw(); };
  draw();
  const check = h("button", { type: "button", class: "submit small-button", onclick: () => {
    const marks = order.map((item, pos) => item === pos);
    draw(marks);
    record(marks.every(Boolean), marks.every(Boolean) ? null : h("div", { class: "correct-order" },
      h("div", { class: "label" }, "Correct order"), h("ol", {}, drill.items.map((t) => h("li", {}, md(t, "markdown inline"))))));
  } }, "Check");
  return h("div", {}, list, check);
}

function numberDrill(drill, seed, record) {
  const input = h("input", { type: "text", inputmode: "decimal", class: "number-input", placeholder: "Your estimate", "aria-label": "Your answer" });
  const parse = (text) => {
    const m = text.replace(/[,_\s]/g, "").match(/^(-?\d*\.?\d+)(e-?\d+)?([kmbt])?$/i);
    if (!m) return NaN;
    const scale = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[3] || "").toLowerCase()] || 1;
    return Number(m[1] + (m[2] || "")) * scale;
  };
  const tolerance = drill.tolerance ?? 0;
  const check = () => {
    const value = parse(input.value);
    if (Number.isNaN(value)) { input.focus(); return; }
    const ok = Math.abs(value - drill.answer) <= Math.abs(drill.answer) * tolerance + 1e-9;
    record(ok, `Answer: ${drill.answer.toLocaleString()}${drill.unit ? ` ${drill.unit}` : ""}${tolerance ? ` (within ±${Math.round(tolerance * 100)}% counts)` : ""}.`);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
  return h("div", { class: "number-row" }, input, drill.unit ? h("span", { class: "muted" }, drill.unit) : null,
    h("button", { type: "button", class: "submit small-button", onclick: check }, "Check"),
    h("span", { class: "muted small" }, "1.5k, 2M and 3e9 work too."));
}

function recallDrill(drill, seed, record, feedback) {
  const text = h("textarea", { rows: 3, class: "recall-input", placeholder: "Answer in your own words, then reveal.", "aria-label": "Your answer" });
  const reveal = h("button", { type: "button", class: "run small-button", onclick: () => {
    fill(feedback, h("div", { class: "reference" }, h("div", { class: "label" }, "Reference"), md(drill.answer)),
      h("div", { class: "self-grade" }, h("span", { class: "muted small" }, "Did you get it?"),
        h("button", { type: "button", class: "submit small-button", onclick: () => record(true) }, "Got it"),
        h("button", { type: "button", class: "run small-button", onclick: () => record(false) }, "Missed it")));
  } }, "Reveal answer");
  return h("div", {}, text, reveal);
}

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
  const revealButton = h("button", { class: "submit", type: "button", onclick: () => reveal() }, "Reveal reference");

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
    revealButton.textContent = "Reference shown";
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
      q.concepts?.length ? h("div", { class: "concept-links" }, h("div", { class: "label" }, "Fundamentals this question uses"),
        q.concepts.map((c) => h("a", { class: "tag", href: `#/sd/f/${c}` }, c.replace(/-/g, " ")))) : null,
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
