"""Loaded into ai-qa's pytest by the Test Manager runner agent (`-p test_manager_plugin`). Each part is off
unless its variable is set.

TM_COLLECT_OUT=<file>: after collection, writes every test as JSON (its node id, file, function name,
docstrings and markers), from which the backend works out which test case each test covers (sent by the agent).

TM_SELECT=<file>: runs only the node ids listed in the file, one per line.

TM_EVENTS_OUT=<file>: while tests run, appends one JSON line when a test starts and one when it is done,
with its outcome, how long it took and the screenshots ai-qa's conftest took when it failed.
"""
import json
import os

import pytest


def _doc(obj):
    return (getattr(obj, "__doc__", None) or "").strip()


def pytest_collection_modifyitems(config, items):
    select = os.environ.get("TM_SELECT")
    if not select:
        return
    with open(select, encoding="utf-8") as handle:
        wanted = {line.strip() for line in handle if line.strip()}
    dropped = [item for item in items if item.nodeid not in wanted]
    if dropped:
        config.hook.pytest_deselected(items=dropped)
    items[:] = [item for item in items if item.nodeid in wanted]


def pytest_collection_finish(session):
    out = os.environ.get("TM_COLLECT_OUT")
    if not out:
        return
    root = str(session.config.rootpath)
    tests = []
    for item in session.items:
        tests.append({
            "nodeid": item.nodeid,
            "file": os.path.relpath(str(item.path), root).replace(os.sep, "/"),
            "name": getattr(item, "originalname", item.name),
            "doc": _doc(getattr(item, "function", None)),
            "moduleDoc": _doc(getattr(item, "module", None)),
            "markers": sorted({marker.name for marker in item.iter_markers()}),
        })
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(tests, handle)


def _event(line):
    with open(os.environ["TM_EVENTS_OUT"], "a", encoding="utf-8") as handle:
        handle.write(json.dumps(line) + "\n")


# Outcome, first failure or skip message, seconds taken and screenshot paths per node id, built up over
# setup / call / teardown.
_outcomes = {}
_messages = {}
_durations = {}
_screenshots = {}

_BAD = ("failed", "error")


def _message(report):
    if hasattr(report, "wasxfail"):
        return report.wasxfail or None
    crash = getattr(report.longrepr, "reprcrash", None)
    if crash is not None:
        return crash.message.strip().splitlines()[0][:500]
    if isinstance(report.longrepr, tuple):  # a skip: (file, line, reason)
        return str(report.longrepr[2])[:500]
    lines = report.longreprtext.strip().splitlines()
    return lines[-1][:500] if lines else None


def pytest_runtest_logstart(nodeid):
    if os.environ.get("TM_EVENTS_OUT"):
        _event({"nodeid": nodeid, "event": "start"})


@pytest.hookimpl(trylast=True)
def pytest_runtest_logreport(report):
    if not os.environ.get("TM_EVENTS_OUT"):
        return
    if hasattr(report, "wasxfail"):
        outcome = "xfailed" if report.skipped else "xpassed"
    elif report.failed:
        outcome = "failed" if report.when == "call" else "error"
    elif report.skipped:
        outcome = "skipped"
    else:
        outcome = "passed"
    # A failure in any phase sticks: a teardown error after a passing call still fails the test.
    if _outcomes.get(report.nodeid) not in _BAD and (outcome in _BAD or report.when != "teardown"):
        _outcomes[report.nodeid] = outcome
    if (report.failed or report.skipped) and report.nodeid not in _messages:
        _messages[report.nodeid] = _message(report)
    _durations[report.nodeid] = _durations.get(report.nodeid, 0) + (report.duration or 0)
    # ai-qa's conftest adds a ("screenshot", "<url> -> <path>") section for every tab it saved.
    for name, content in report.sections:
        if name == "screenshot" and " -> " in content:
            url, path = content.rsplit(" -> ", 1)
            shots = _screenshots.setdefault(report.nodeid, [])
            if all(shot["path"] != path.strip() for shot in shots):
                shots.append({"url": url.strip(), "path": path.strip()})


def pytest_runtest_logfinish(nodeid):
    if os.environ.get("TM_EVENTS_OUT"):
        _event({
            "nodeid": nodeid,
            "event": "done",
            "outcome": _outcomes.get(nodeid, "passed"),
            "message": _messages.get(nodeid),
            "duration": round(_durations.get(nodeid, 0), 2),
            "screenshots": _screenshots.get(nodeid, []),
        })
