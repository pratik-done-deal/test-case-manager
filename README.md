# Test Manager

A web app that shows every scenario and test case written by the ai-qa pipeline, with a Pass / Fail
result per test case. A case with an automated test gets its result only by running it; only a case
with none (a manual check) has its result set by hand.

- `backend/` — NestJS API with a Postgres database. It reads the test case files from ai-qa's
  `specs/` folder into the database and serves them, with the results, to the frontend.
- `frontend/` — React (Vite) app.

The `test-cases.md` files stay where test cases are written. The database is filled from them, one
direction only: never edit a test case in the database.

## Run it locally

Needs Node 20+ and a running Postgres.

```bash
createdb test_manager                 # once

cd backend
cp .env.example .env                  # once; check SPECS_DIR points at ai-qa/specs
npm install
npm run dev                           # http://localhost:4000/api

cd ../frontend
npm install
npm run dev                           # http://localhost:5173
```

With `SPECS_DIR` set, the backend syncs the folder on start and again whenever a test case file or
folder in it changes (added, edited, deleted, renamed or moved, including by a git checkout or pull),
and open pages update at once. The ai-qa tests are collected again the same way when anything under
`test_cases/` changes. Both are also re-checked every 5 minutes, in case the file watcher missed a
change, and a change made while the backend was off is picked up when it starts.

## What it reads from specs/

- `specs/modules/<role>/<module>/…` and `specs/features/<role>/<feature>/…`. The role folder decides
  where a module appears (Admin, Seller, Buyer). Scenarios whose Role line names biz_user are also
  listed under Biz User.
- Every `test-cases.md`, and any other `.md` with a test case table (`| TC | …`), in any of three
  layouts: the pipeline's numbered sections, split review files, and tab files (ids like `VFY-01`).
- A file whose cases all appear in a file in its folder or above is a review copy. Its cases are
  stored once, under the file that holds them, and the copy only adds an area to the sidebar.
- Names come from `module.yml` / `feature.yml`. A case belongs to a feature through its scenario's
  `**Feature:**` line or a requirement id with the feature's `req_prefix`, and shows as pending
  until `feature.yml` says `shipped`.

## How the sync treats changes

- A new test case is added; a changed one is updated in place.
- Each test case has a permanent id. A case that is renumbered (S1-03 becomes S1-02) or reworded
  keeps its id, and so its result.
- A test case, scenario or whole file that disappears is archived, not deleted. If it comes back,
  its result comes back with it.

## Running tests from the app

When the backend can see the ai-qa checkout (`AI_QA_DIR`, by default the folder above `SPECS_DIR`)
and its `.venv`, each test case, scenario and page gets a Run button. A run calls ai-qa's own pytest
(with its `pytest.ini`, so the HTML and Allure reports under `ai-qa/reports/` are rewritten as with any
run), and sets each case's Pass / Fail as its last test finishes.

- **Which tests cover a case** is worked out from ai-qa's conventions, since nothing declares it: the
  case id in the test's name (`test_stb_01_…`) or in brackets in its docstring, narrowed, when the id
  repeats across modules (`S1-01`), by the spec the test file names, the requirement ids in its
  docstring, and its folder. A test is only matched to a case when exactly one is left. Cases with no
  matched test have no Run button. The match is redone when a test file or a test case changes.
- **A whole role:** "Run all" beside Admin, Seller, Buyer or Biz User in the sidebar runs every test
  case under that heading. A run of more than 100 tests is confirmed first.
- **Tests that change data** (`destructive`, `live_login`) are left out unless you agree when asked.
- **Results:** a case fails if any of its tests fails or errors and passes if any passed and none
  failed. A case whose tests were all skipped or are expected failures (`pending_feature`) keeps its
  result.
- **Headless or Headed:** the toggle beside Run picks how the next run opens its browser (pytest's
  `--headed`). Headed windows open on the machine the backend runs on. The choice is remembered in
  each tester's browser; it starts as Headless.
- **One run at a time**, since the tests share logins and QA data. Stop ends pytest and its browsers.
- `runner/test_manager_plugin.py` is the pytest plugin the backend loads into ai-qa's pytest to list
  the tests and report outcomes. Nothing is added to ai-qa.

## Run reports

Every run has a report at `#/reports/<run id>`; **Reports** in the sidebar lists them all, newest
first. When a run of a module, scenario or role (anything more than one case) ends, its report opens
in the tab that started it. A report shows:

- what ran, when, how long, on which app (QA or local), headless or headed, with or without the
  destructive tests, and the ai-qa branch and commit (and whether it had uncommitted changes);
- a ring of the test case results: Passed, Failed (a check failed), Error (the test broke in setup or
  teardown), Skipped, Pending feature (an expected `pending_feature` failure) and Not run, with the
  pass rate, passed ÷ (passed + failed + error), in the middle;
- the comparison with the previous run of the same thing (new failures, fixed, still failing) and
  the pass rate of its last 10 runs;
- a bar per scenario, every failure with its message and the screenshots ai-qa took, the skipped and
  pending cases with their reasons, the 5 slowest tests, and pytest's output.

Runs are "the same thing" when they were started from the same button: a module page, a scenario,
a role's Run all, or one case. A report shows the cases as they read when the run started.
Screenshots are copied into `backend/storage/reports/<run id>/` (or `REPORTS_DIR`), since ai-qa
overwrites its own on every run, and kept for 30 days and at least for the last 20 runs of the same
thing.

## Saving the test logins from the app

The **Login as Buyer / Seller / Admin / Biz user** buttons at the top do what
`python scripts/save_auth_state.py <role>` does in ai-qa, by running that script: a browser opens at
the role's login page (on the machine the backend runs on), you log in there, and **Save session** in
the app presses the Enter the script waits for. The script writes the session the tests use
(`ai-qa/auth/<role>.json`, or `auth/local/` for a local app). Its checks still apply: a Biz user login
that isn't a business user is refused, and the window stays open to try again. **Cancel** closes the
browser without changing the saved session. Each button shows when its session was last saved; the
app can't tell whether QA has since expired it, so log in again when tests fail on "session expired".

## API

| | |
|---|---|
| `GET /api/catalog` | Folders, and suites → scenarios → test cases |
| `GET /api/results` | `{ <test case id>: "pass" \| "fail" }` |
| `PUT /api/results/:testCaseId` | Body `{ "result": "pass" \| "fail" \| null }`; 409 for a case with an automated test |
| `GET /api/events` | Server-sent events: `catalog`, `results`, `automation`, `runs` or `logins` when one changes |
| `POST /api/sync` | Upload the test case and yml files; needs the `x-sync-token` header |
| `GET /api/runs/automation` | `{ available, reason, tests, cases: { <test case id>: { tests, risky } } }` |
| `GET /api/runs/current` | The run going now, else the last one; `?log=1` adds pytest's output |
| `POST /api/runs` | Body `{ label, testCaseKeys, includeDestructive?, headed?, scope? }`; 409 while a run is going |
| `POST /api/runs/:id/stop` | Stops that run |
| `GET /api/runs` | Past runs with their summary, newest first; `?scope=<key>` for one module, scenario or role |
| `GET /api/runs/:id/report` | Everything the report page shows |
| `GET /api/runs/:id/log` | pytest's output, as text |
| `GET /api/runs/:id/screenshots/:file` | A kept failure screenshot |
| `GET /api/logins` | Each role's saved session (`savedAt`) and open login window |
| `POST /api/logins/:role` | Opens the login browser for `buyer`, `seller`, `admin` or `biz_user` |
| `POST /api/logins/:role/save` | Saves the session logged in there |
| `POST /api/logins/:role/cancel` | Closes that login browser |

## A backend that cannot see the specs folder (deployed)

Set `SYNC_TOKEN` on the backend and leave `SPECS_DIR` empty there. From a machine that has the specs:

```bash
cd backend
API_URL=https://<backend>/api SYNC_TOKEN=<token> npm run push-specs -- /path/to/ai-qa/specs
```

Build the frontend with `VITE_API_URL=https://<backend>/api`, and set the backend's `CORS_ORIGIN` to
the frontend's address.

There is no login yet: anyone who can reach the API can change results, start test runs and open login windows. A
deployed backend without the ai-qa checkout has running turned off.
