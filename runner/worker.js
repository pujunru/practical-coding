// Runs Python in a Web Worker so user code never blocks or touches the page.
// Protocol: page → {id, solution, tests}; worker → {type: "ready"} once, then
// {type: "result", id, report} or {type: "result", id, error} per run.

// A module worker: Pyodide 314 no longer supports classic workers.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

const ready = (async () => {
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  const harness = await (await fetch(new URL("harness.py", self.location))).text();
  pyodide.FS.writeFile("/home/pyodide/harness.py", harness);
  const runJson = pyodide.runPython("import harness\nharness.run_json");
  self.postMessage({ type: "ready" });
  return runJson;
})();

ready.catch((err) => self.postMessage({ type: "fatal", error: String(err) }));

self.onmessage = async ({ data }) => {
  try {
    const runJson = await ready;
    const report = JSON.parse(runJson(data.solution, data.tests));
    self.postMessage({ type: "result", id: data.id, report });
  } catch (err) {
    self.postMessage({ type: "result", id: data.id, error: String(err) });
  }
};
