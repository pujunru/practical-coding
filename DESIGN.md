# Design

Practical Coding is a static site for practising "implement this component"
interview problems — a rate limiter, an LRU cache, a key-value store with
transactions — in Python, in the browser. It is deliberately small: a problem
list, a problem page with an editor, and a test runner. There is no server, no
account, no build step and no AI.

## Goals

- **LeetCode-simple.** Two screens: the list, and the problem. Write code, press
  Run, see which tests pass.
- **Static hosting only.** The whole app is plain HTML, CSS and ES modules served
  by GitHub Pages. `python3 -m http.server` is the entire dev setup.
- **Code runs in the browser.** Python runs through [Pyodide](https://pyodide.org)
  (CPython compiled to WebAssembly) inside a Web Worker. Nothing a user types
  leaves their machine.
- **Problems live elsewhere.** The app repository contains no problems. It reads
  a problem bank — a separate public repository — over HTTPS.

## Non-goals

Accounts, sync, leaderboards, AI hints, multiple languages, a backend. Progress
is kept in the browser's `localStorage`; losing it costs nothing important.

## Architecture

```
GitHub Pages (this repo)                   raw.githubusercontent.com
┌──────────────────────────────┐           (practical-coding-problems)
│ index.html  app.js  styles   │  fetch    ┌──────────────────────────┐
│  ├─ #/          list view    │ ────────▶ │ index.json               │
│  └─ #/p/<id>    problem view │           │ problems/<id>/README.md  │
│        │ postMessage         │           │ problems/<id>/starter.py │
│        ▼                     │           │ problems/<id>/tests.py   │
│ runner/worker.js (Web Worker)│           └──────────────────────────┘
│  └─ Pyodide (cdn.jsdelivr)   │
│  └─ runner/harness.py        │
└──────────────────────────────┘
```

- **`app.js`** is a hash router with two views. The list view renders
  `index.json`. The problem view renders `README.md` (Markdown → HTML, sanitized
  with DOMPurify), opens `starter.py` in CodeMirror, and keeps the draft in
  `localStorage` under `pc:code:<id>`.
- **`runner/worker.js`** loads Pyodide once and keeps it warm. A run sends
  `{solution, tests}`; the worker calls `harness.run()` and posts back JSON.
- **`runner/harness.py`** is plain CPython with no dependencies, so the problem
  bank's CI runs the exact same harness against its reference solutions.

## Problem format

A problem is a directory in the bank plus an entry in `index.json`:

```
index.json                       {"problems": [{"id", "title", "difficulty", "tags"}]}
problems/<id>/README.md          statement, shown on the left
problems/<id>/starter.py         initial editor contents (module `solution`)
problems/<id>/tests.py           test functions, run in definition order
problems/<id>/solution.py        reference solution, used only by the bank's CI
```

`tests.py` does `from solution import ...` and defines `test_*` functions that
use plain `assert`. A name of the form `test_l<N>_...` puts the test in level N,
so a problem can grow in stages (single client → many clients → retry-after →
tiers) the way practical interview rounds do. A test's docstring, if present,
is its display name.

Problems are designed to be deterministic: anything time-based takes the
current time as an argument instead of reading a clock.

## Running code

1. The page starts the worker as soon as a problem opens, so Pyodide (≈ 10 MB,
   cached by the browser after the first visit) loads while the user reads.
2. Run (or ⌘/Ctrl + Enter) sends the editor contents and `tests.py`.
3. The harness `exec`s the solution as module `solution`, then each test in
   turn, capturing stdout per test. Assertion failures report the failing line;
   other exceptions report a traceback trimmed to `solution.py` and `tests.py`.
4. A run that exceeds 10 s is treated as an infinite loop: the page terminates
   the worker and starts a fresh one. (Pyodide's cooperative interrupt needs
   `SharedArrayBuffer`, which needs COOP/COEP headers GitHub Pages cannot set.)
5. When every test passes, the problem is marked solved in `localStorage`.

## Security

- **No secrets, no backend.** There is nothing to steal server-side; the only
  stored data is the user's own drafts in their own browser.
- **Fixed problem source.** The bank URL is set in `config.js`. A `?bank=`
  override is honoured only on `localhost`, so a crafted link cannot make the
  public site load and execute someone else's `tests.py`.
- **Untrusted text is sanitized.** Problem Markdown is rendered with `marked`
  and then sanitized with DOMPurify; titles and tags are inserted as text, never
  as HTML. Problem ids must match `^[a-z0-9-]+$` before they are used in a URL.
- **Code runs off the main thread.** User and test code run inside a Web Worker,
  which has no access to the page's DOM or `localStorage`.
- **Pinned, vendored dependencies.** CodeMirror, marked and DOMPurify are
  vendored under `vendor/` at fixed versions. Pyodide is loaded from
  `cdn.jsdelivr.net` at a pinned version.
- **Content Security Policy.** `index.html` restricts scripts to the site
  itself, connections to the site, the bank and the Pyodide CDN, and forbids
  plugins, `<base>` rewriting and form posts.

## Layout

The problem page follows the familiar shape: a top bar with the title and the
Run button; the statement on the left; the editor on the right with a result
panel under it. The divider between the two halves can be dragged. On narrow
screens the halves stack. Light and dark themes follow the system setting.
