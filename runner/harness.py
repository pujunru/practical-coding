"""Test harness shared by the browser runner and the problem bank's CI.

Plain CPython, no dependencies. `run(solution_src, tests_src)` executes the
user's code as module `solution`, then every `test_*` function in `tests_src`
in definition order, and returns a JSON-serialisable report. `tests_src` may
define `LEVELS = {1: "Single client", ...}` to name the levels that
`test_l<N>_...` tests belong to.
"""

import contextlib
import io
import json
import linecache
import re
import sys
import time
import traceback
import types

SOURCES = ("solution.py", "tests.py")
LEVEL_RE = re.compile(r"^test_l(\d+)_")


def _load(name, src):
    linecache.cache[f"{name}.py"] = (len(src), None, src.splitlines(True), f"{name}.py")
    module = types.ModuleType(name)
    module.__file__ = f"{name}.py"
    sys.modules[name] = module
    exec(compile(src, f"{name}.py", "exec"), module.__dict__)
    return module


def _trimmed_traceback(exc):
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename in SOURCES]
    lines = traceback.format_list(frames)
    lines += traceback.format_exception_only(type(exc), exc)
    return "".join(lines).rstrip()


def _failure(exc):
    if isinstance(exc, AssertionError):
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename in SOURCES]
        where = frames[-1] if frames else None
        message = str(exc) or (where.line if where else "assertion failed")
        return {"kind": "assertion", "message": message}
    return {"kind": "error", "message": _trimmed_traceback(exc)}


def run(solution_src, tests_src):
    for name in ("solution", "tests"):
        sys.modules.pop(name, None)

    stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stdout):
            _load("solution", solution_src)
    except BaseException as exc:  # SyntaxError, NameError at import, ...
        if isinstance(exc, SyntaxError):
            message = "".join(traceback.format_exception_only(type(exc), exc)).rstrip()
        else:
            message = _trimmed_traceback(exc)
        return {"ok": False, "stage": "load", "error": message, "stdout": stdout.getvalue(), "tests": []}

    try:
        tests_module = _load("tests", tests_src)
    except BaseException as exc:
        return {"ok": False, "stage": "tests", "error": _trimmed_traceback(exc), "stdout": "", "tests": []}

    results = []
    for name, fn in list(vars(tests_module).items()):
        if not (name.startswith("test_") and callable(fn)):
            continue
        level = LEVEL_RE.match(name)
        doc = (fn.__doc__ or "").strip().splitlines()
        out = io.StringIO()
        started = time.perf_counter()
        failure = None
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                fn()
        except BaseException as exc:  # includes SystemExit from user code
            failure = _failure(exc)
        results.append({
            "name": name,
            "title": doc[0] if doc else name,
            "level": int(level.group(1)) if level else None,
            "passed": failure is None,
            "failure": failure,
            "stdout": out.getvalue(),
            "ms": round((time.perf_counter() - started) * 1000, 2),
        })

    return {
        "ok": bool(results) and all(r["passed"] for r in results),
        "stage": "done",
        "error": None,
        "stdout": stdout.getvalue(),
        "tests": results,
        "levels": {str(k): str(v) for k, v in getattr(tests_module, "LEVELS", {}).items()},
    }


def run_json(solution_src, tests_src):
    return json.dumps(run(solution_src, tests_src))


if __name__ == "__main__":
    # python3 harness.py solution.py tests.py  — used by the problem bank's CI.
    sol_path, tests_path = sys.argv[1], sys.argv[2]
    with open(sol_path) as f:
        sol = f.read()
    with open(tests_path) as f:
        tests = f.read()
    report = run(sol, tests)
    for r in report["tests"]:
        print(("PASS " if r["passed"] else "FAIL ") + r["name"])
        if r["failure"]:
            print("  " + r["failure"]["message"].replace("\n", "\n  "))
    if report["error"]:
        print(report["error"])
    sys.exit(0 if report["ok"] else 1)
