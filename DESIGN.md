# Design

Practical Coding is a static site for practising "implement this component"
interview problems — a rate limiter, an LRU cache, a key-value store with
transactions — in Python, in the browser. It is deliberately small: a problem
list, a problem page with an editor, and a test runner. There is no server, no
account, no build step and no AI.

## Goals

- **LeetCode-simple.** Two screens: the list, and the problem. Write code, press
  Run to try the testcases, press Submit to be judged, and see the input, your
  output and the expected output side by side.
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
│ index.html  app.js  styles   │  fetch    ┌────────────────────────────┐
│  ├─ #/            list view  │ ────────▶ │ index.json                 │
│  └─ #/p/<id>/<n>  problem,   │           │ problems/<id>/problem.json │
│        │          level n    │           │ problems/<id>/levels/n.md  │
│        │ postMessage         │           │ problems/<id>/starter.py   │
│        ▼                     │           │ problems/<id>/solution.py  │
│ runner/worker.js (Web Worker)│           └────────────────────────────┘
│  └─ Pyodide (cdn.jsdelivr)   │
│  └─ runner/harness.py        │
└──────────────────────────────┘
```

- **`app.js`** is a hash router with two views. The list view renders
  `index.json`. The problem view shows one level at a time: its statement
  (Markdown → HTML, sanitized with DOMPurify) and its example cases. It opens
  `starter.py` in CodeMirror and keeps the draft in `localStorage` under
  `pc:code:<id>`.
- **`runner/worker.js`** loads Pyodide once and keeps it warm. A run sends
  `{solution, cases, reference}`; the worker calls `harness.run()` and posts
  back JSON.
- **`runner/harness.py`** is plain CPython with no dependencies, so the problem
  bank's CI runs the exact same harness against its reference solutions.
  Testcases cross into Python as JSON text, never as code.

## Problem format

A problem is a directory in the bank plus an entry in `index.json`:

```
index.json                       {"problems": [{"id", "title", "difficulty", "tags"}]}
problems/<id>/problem.json       {"levels": [{"title", "cases": [...]}, ...]}
problems/<id>/levels/<n>.md      statement of level n
problems/<id>/starter.py         initial editor contents
problems/<id>/solution.py        reference solution
```

Practical interview rounds grow a component in stages, so a problem is a list
of **levels** (single client → many clients → retry-after → tiers). Each level
is its own tab with its own statement, examples, testcases and verdict.

A case uses LeetCode's format for design problems — one list of operations, one
list of argument lists, one list of expected outputs:

```json
{"ops":      ["RateLimiter", "allow",  "allow",  "allow"],
 "args":     [[2, 10],       ["a", 0], ["a", 5], ["a", 9]],
 "expected": [null,          true,     true,     false],
 "example": true,
 "explanation": "optional, shown under the example"}
```

The first operation constructs the class; each later one calls a method on the
instance. `{"raises": "ValueError"}` as an expected value means that call must
raise. Cases marked `example` appear in the statement and seed the Testcase tab.

Problems are designed to be deterministic: anything time-based takes the
current time as an argument instead of reading a clock.

## Running code

1. The page starts the worker as soon as a problem opens, so Pyodide (≈ 10 MB,
   cached by the browser after the first visit) loads while the user reads.
2. **Run** (⌘/Ctrl + ') replays the cases in the Testcase tab. They are free
   text, so the user can edit them or add more; their expected output comes
   from running the bank's `solution.py` on the same input, like LeetCode.
3. **Submit** (⌘/Ctrl + Enter) replays every case of the current level and all
   earlier levels against their stored `expected` values. It reports
   `passed / total` per level and the first failing case.
4. A case's result shows its input, its stdout, a runtime error trace if any,
   and the output next to the expected output with the differing entries
   highlighted.
5. A run that exceeds 10 s is treated as an infinite loop: the page terminates
   the worker and starts a fresh one. (Pyodide's cooperative interrupt needs
   `SharedArrayBuffer`, which needs COOP/COEP headers GitHub Pages cannot set.)
6. An accepted Submit marks the level passed; passing every level marks the
   problem solved. Both live in `localStorage`.

## Security

- **No secrets, no backend.** There is nothing to steal server-side; the only
  stored data is the user's own drafts in their own browser.
- **Fixed problem source.** The bank URL is set in `config.js`. A `?bank=`
  override is honoured only on `localhost`, so a crafted link cannot make the
  public site load and execute someone else's reference solution.
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

The problem page follows LeetCode's shape: a top bar with Run and Submit, the
description on the left, the editor top right, and a Testcase / Test Result
panel bottom right.

- Both dividers can be dragged (or moved with the arrow keys); the split is
  remembered.
- Every pane has a collapse and a maximize button. A collapsed description
  shrinks to a vertical strip; a collapsed editor or result panel shrinks to its
  header. A maximized pane fills the workspace until it is restored or Escape is
  pressed. Double-clicking a pane header also toggles maximize.
- On narrow screens the panes stack and the page scrolls.
- Light and dark themes follow the system setting.
