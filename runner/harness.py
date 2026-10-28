"""Test harness shared by the browser runner and the problem bank's CI.

Plain CPython, no dependencies. A case is LeetCode's design-problem format:

    {"ops":  ["RateLimiter", "allow", "allow"],
     "args": [[2, 10],       ["a", 0], ["a", 5]],
     "expected": [null, true, true]}

The first op constructs the class; every later op calls a method on that
instance. An expected value of {"raises": "ValueError"} means the call must
raise that exception.

`run(solution_src, cases, reference_src=None)` replays every case against the
user's code and returns a JSON-serialisable report. A case without `expected`
gets it from `reference_src`, which is how custom test cases are judged.
"""

import contextlib
import io
import json
import linecache
import math
import sys
import time
import traceback

FLOAT_TOLERANCE = 1e-6


def _load(name, src):
    filename = f"{name}.py"
    linecache.cache[filename] = (len(src), None, src.splitlines(True), filename)
    namespace = {"__name__": name, "__file__": filename}
    exec(compile(src, filename, "exec"), namespace)
    return namespace


def _trace(exc, filename="solution.py"):
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == filename]
    lines = traceback.format_list(frames) + traceback.format_exception_only(type(exc), exc)
    return "".join(lines).rstrip()


def _jsonable(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else repr(value)
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (set, frozenset)):
        return sorted((_jsonable(v) for v in value), key=repr)
    return repr(value)


def equal(got, want):
    if isinstance(want, dict) and "raises" in want:
        return isinstance(got, dict) and got.get("raises") == want["raises"]
    if isinstance(want, bool) or isinstance(got, bool):
        return type(got) is type(want) and got == want
    if isinstance(want, (int, float)) and isinstance(got, (int, float)):
        return abs(got - want) <= FLOAT_TOLERANCE
    if isinstance(want, list) and isinstance(got, list):
        return len(got) == len(want) and all(equal(g, w) for g, w in zip(got, want))
    if isinstance(want, dict) and isinstance(got, dict):
        return got.keys() == want.keys() and all(equal(got[k], want[k]) for k in want)
    return got == want


def _play(namespace, case, filename):
    """Replay one case. Returns (outputs, trace of the first exception)."""
    ops, args = case["ops"], case["args"]
    cls = namespace.get(ops[0])
    if not isinstance(cls, type):
        message = f"class {ops[0]} is not defined"
        return [{"raises": "NameError", "message": message}], f"NameError: {message}"
    try:
        instance = cls(*args[0])
    except Exception as exc:
        return [{"raises": type(exc).__name__, "message": str(exc)}], _trace(exc, filename)
    outputs, trace = [None], None
    for op, op_args in zip(ops[1:], args[1:]):
        try:
            outputs.append(_jsonable(getattr(instance, op)(*op_args)))
        except Exception as exc:
            outputs.append({"raises": type(exc).__name__, "message": str(exc)})
            trace = trace or _trace(exc, filename)
    return outputs, trace


def _diff(outputs, expected):
    if expected is None:
        return []
    return [i for i in range(max(len(outputs), len(expected)))
            if i >= len(outputs) or i >= len(expected) or not equal(outputs[i], expected[i])]


def run(solution_src, cases, reference_src=None):
    stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stdout):
            solution = _load("solution", solution_src)
    except BaseException as exc:  # SyntaxError, NameError at import, SystemExit, ...
        if isinstance(exc, SyntaxError):
            message = "".join(traceback.format_exception_only(type(exc), exc)).rstrip()
        else:
            message = _trace(exc)
        return {"ok": False, "stage": "load", "error": message, "stdout": stdout.getvalue(), "cases": []}

    reference = None
    if reference_src is not None:
        with contextlib.redirect_stdout(io.StringIO()):
            reference = _load("reference", reference_src)

    results = []
    for case in cases:
        if len(case["ops"]) != len(case["args"]) or not case["ops"]:
            return {"ok": False, "stage": "case", "error": "Each test case needs one arguments list per operation.",
                    "stdout": "", "cases": results}
        expected = case.get("expected")
        if expected is None and reference is not None:
            with contextlib.redirect_stdout(io.StringIO()):
                expected, _ = _play(reference, case, "reference.py")
        out = io.StringIO()
        started = time.perf_counter()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                outputs, trace = _play(solution, case, "solution.py")
        except BaseException as exc:  # SystemExit from user code
            outputs, trace = [{"raises": type(exc).__name__, "message": str(exc)}], _trace(exc)
        diff = _diff(outputs, expected)
        results.append({
            "output": outputs,
            "expected": expected,
            "passed": expected is not None and not diff,
            "diff": diff,
            "trace": trace,
            "stdout": out.getvalue(),
            "ms": round((time.perf_counter() - started) * 1000, 2),
        })

    return {
        "ok": bool(results) and all(r["passed"] for r in results),
        "stage": "done",
        "error": None,
        "stdout": stdout.getvalue(),
        "cases": results,
    }


def run_json(solution_src, cases_json, reference_src=None):
    return json.dumps(run(solution_src, json.loads(cases_json), reference_src))


if __name__ == "__main__":
    # python3 harness.py solution.py problem.json
    with open(sys.argv[1]) as f:
        src = f.read()
    with open(sys.argv[2]) as f:
        problem = json.load(f)
    ok = True
    for number, level in enumerate(problem["levels"], 1):
        report = run(src, level["cases"])
        if report["error"]:
            print(report["error"])
            sys.exit(1)
        passed = sum(c["passed"] for c in report["cases"])
        print(f"Level {number} · {level['title']}: {passed}/{len(report['cases'])}")
        for i, c in enumerate(report["cases"], 1):
            if not c["passed"]:
                print(f"  case {i}: output   {json.dumps(c['output'])}\n          expected {json.dumps(c['expected'])}")
        ok = ok and report["ok"]
    sys.exit(0 if ok else 1)
