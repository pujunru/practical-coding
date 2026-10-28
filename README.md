# Practical Coding

Practise "implement this component" interview problems — a rate limiter, an
LRU cache, a key-value store — in Python, right in the browser.

**Live:** https://pujunru.github.io/practical-coding/

- A problem list and a LeetCode-style problem page: description on the left,
  editor and Testcase / Test Result on the right. Every pane resizes, collapses
  and maximizes.
- Problems come in levels, each with its own statement and examples. **Run**
  (⌘/Ctrl + ') tries your editable testcases; **Submit** (⌘/Ctrl + Enter) judges
  the current level and every level before it, showing input, output and
  expected output.
- System design questions: a timed, step-by-step answer workspace with a
  reference outline and a self-check rubric.
- Python runs locally in your browser through [Pyodide](https://pyodide.org)
  (WebAssembly). Your code never leaves your machine.
- No server, no account, no build step. Drafts and solved status are kept in
  your browser's `localStorage`.

Problems live in a separate repository:
[practical-coding-problems](https://github.com/pujunru/practical-coding-problems).

## Run locally

Serve the app and a checkout of the problem bank from one parent folder:

```sh
git clone https://github.com/pujunru/practical-coding.git
git clone https://github.com/pujunru/practical-coding-problems.git
python3 -m http.server 8000
```

Open http://localhost:8000/practical-coding/?bank=/practical-coding-problems/ .
The `?bank=` override only works on `localhost`; the deployed site always reads
the bank configured in [`config.js`](config.js).

## Layout

| Path | What |
| --- | --- |
| `index.html`, `app.js` | page shell and hash router |
| `lib.js` | shared helpers: bank fetching, storage, DOM, Markdown, panes |
| `coding.js` | coding problem list and problem page |
| `sd.js` | system design question list and workspace |
| `styles.css` | all styles |
| `config.js` | problem bank URL and run timeout |
| `runner/worker.js` | Web Worker that loads Pyodide and runs code |
| `runner/harness.py` | test harness, plain CPython; the bank's CI uses it too |
| `vendor/` | pinned copies of CodeMirror 5, marked and DOMPurify |

See [DESIGN.md](DESIGN.md) for the design and the security model.

## Deploy

GitHub Pages, "Deploy from a branch", `main`, `/ (root)`. Nothing to build.

## License

MIT. Vendored libraries keep their own licenses in `vendor/*/LICENSE*`.
