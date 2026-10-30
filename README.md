# Test Manager

A web app that shows every scenario and test case written by the ai-qa pipeline, with a Pass / Fail
result per test case. A case with an automated test gets its result only by running it; only a case
with none (a manual check) has its result set by hand.

- `backend/`: NestJS API with a Postgres database. It reads the test case files from ai-qa's
  `specs/` folder into the database and serves them, with the results and runs, to the frontend.
  It keeps nothing in memory or on disk, so it can run as several containers.
- `frontend/`: React (Vite) app.
- `agent/`: the runner agent. It runs on a tester's laptop next to their ai-qa checkout, and runs
  the tests and login windows the app asks for there. See [agent/README.md](agent/README.md).

The `test-cases.md` files stay where test cases are written. The database is filled from them, one
direction only: never edit a test case in the database.

```
ai-qa repo ── push-specs (CI on merge, or by hand) ──► POST /api/sync

browser ◄── nginx (frontend container) ──► API containers ◄──► Postgres
                                               ▲
                                               │ HTTPS + RUNNER_TOKEN, polls every 2 s
                     runner agent on each tester's laptop (ai-qa checkout, .venv, browsers)
```

## Run it locally

Needs Node 20.12+ and a running Postgres.

```bash
createdb test_manager                 # once

cd backend
cp .env.example .env                  # once; check SPECS_DIR, and set RUNNER_TOKEN to any value
npm install
npm run dev                           # http://localhost:4000/api

cd ../frontend
npm install
npm run dev                           # http://localhost:5173

cd ../agent
cp .env.example .env                  # once; the same RUNNER_TOKEN, and AI_QA_DIR
npm start
```

With `SPECS_DIR` set, the backend syncs the folder on start and again whenever a test case file or
folder in it changes (added, edited, deleted, renamed or moved, including by a git checkout or pull),
and open pages update at once. It is also re-checked every 5 minutes, in case the file watcher missed a
change, and a change made while the backend was off is picked up when it starts. The agent collects
the ai-qa tests the same way whenever anything under `test_cases/` changes.

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

Tests run on a tester's laptop, not on the server: the **runner agent** (`agent/`) runs there next to
the ai-qa checkout. Start it, then pick the laptop under **Runs on** at the top of the app (remembered
in your browser; picked by itself when only one laptop is connected). Each test case, scenario and page
then gets a Run button. A run calls ai-qa's own pytest on that laptop (with its `pytest.ini`, so the HTML
and Allure reports under `ai-qa/reports/` there are rewritten as with any run), and sets each case's
Pass / Fail as its last test finishes.

- **Which tests cover a case** is worked out from ai-qa's conventions, since nothing declares it: the
  case id in the test's name (`test_stb_01_…`) or in brackets in its docstring, narrowed, when the id
  repeats across modules (`S1-01`), by the spec the test file names, the requirement ids in its
  docstring, and its folder. A test is only matched to a case when exactly one is left. Cases with no
  matched test have no Run button. The match is per laptop, since each may have another ai-qa branch
  checked out, and is redone when its tests or the test cases change.
- **A whole role:** "Run all" beside Admin, Seller, Buyer or Biz User in the sidebar runs every test
  case under that heading. A run of more than 100 tests is confirmed first.
- **Tests that change data** (`destructive`, `live_login`) are left out unless you agree when asked.
- **Results:** a case fails if any of its tests fails or errors and passes if any passed and none
  failed. A case whose tests were all skipped or are expected failures (`pending_feature`) keeps its
  result.
- **Results per environment:** results are kept apart for each app the tests point at (ai-qa's
  `settings.app_url`), e.g. `qa.done.deals` and `localhost:3000`. **Results for** at the top picks which
  one the pages show, and where a result set by hand goes. It follows the chosen laptop until you pick one.
- **Headless or Headed:** the toggle beside Run picks how the next run opens its browser (pytest's
  `--headed`). Headed windows open on the laptop that runs the tests.
- **One run at a time per laptop**, since a laptop's tests share its logins. A run waits as *queued*
  until the laptop picks it up (within a couple of seconds). Stop ends pytest and its browsers there.
- **A laptop that goes quiet** (closed, agent stopped, network lost) during a run: the run is marked
  *interrupted* after a minute. A queued run whose laptop is offline is dropped after 10 minutes.
- `agent/plugin/test_manager_plugin.py` is the pytest plugin the agent loads into ai-qa's pytest to list
  the tests and report outcomes. Nothing is added to ai-qa.

## Run reports

Every run has a report at `#/reports/<run id>`; **Reports** in the sidebar lists them all, newest
first. When a run of a module, scenario or role (anything more than one case) ends, its report opens
in the tab that started it. A report shows:

- what ran, when, how long, on which laptop and app (QA or local), headless or headed, with or without
  the destructive tests, and the ai-qa branch and commit (and whether it had uncommitted changes);
- a ring of the test case results: Passed, Failed (a check failed), Error (the test broke in setup or
  teardown), Skipped, Pending feature (an expected `pending_feature` failure) and Not run, with the
  pass rate, passed ÷ (passed + failed + error), in the middle;
- the comparison with the previous run of the same thing (new failures, fixed, still failing) and
  the pass rate of its last 10 runs;
- a bar per scenario, every failure with its message and the screenshots ai-qa took, the skipped and
  pending cases with their reasons, the 5 slowest tests, and pytest's output.

Runs are "the same thing" when they were started from the same button: a module page, a scenario,
a role's Run all, or one case. A report shows the cases as they read when the run started.
The agent uploads failure screenshots as each test finishes (ai-qa overwrites its own on every run).
They are stored in the database and kept for 30 days and at least for the last 20 runs of the same thing.

## Saving the test logins from the app

The **Login as Buyer / Seller / Admin / Biz user** buttons at the top do what
`python scripts/save_auth_state.py <role>` does in ai-qa, on the chosen laptop, by running that script
there: a browser opens on that laptop at the role's login page, you log in there, and **Save session**
in the app presses the Enter the script waits for. The script writes the session the tests use
(`ai-qa/auth/<role>.json`, or `auth/local/` for a local app). Its checks still apply: a Biz user login
that isn't a business user is refused, and the window stays open to try again. **Cancel** closes the
browser without changing the saved session. Each button shows when its session was last saved on that
laptop; the app can't tell whether QA has since expired it, so log in again when tests fail on
"session expired".

## Deploying with Docker

`docker-compose.yml` runs Postgres, the API and the web app (nginx, which also passes `/api` on to
the API, so the app and API share one address).

```bash
cp .env.example .env          # POSTGRES_PASSWORD, SYNC_TOKEN, RUNNER_TOKEN: long random values
docker compose up -d --build  # http://<host>:8080
```

Then:

1. **Load the test cases.** From a machine with the ai-qa checkout:
   `cd backend && API_URL=https://<host>/api SYNC_TOKEN=<token> npm run push-specs -- /path/to/ai-qa/specs`.
   To keep them current, add [deploy/push-specs.github-workflow.yml](deploy/push-specs.github-workflow.yml)
   to the ai-qa repo; every merge to main that changes `specs/` then pushes them.
2. **Connect the testers' laptops.** Each tester runs the agent with `API_URL=https://<host>/api` and the
   `RUNNER_TOKEN` (see [agent/README.md](agent/README.md)).
3. **Put HTTPS in front** (your host's load balancer, or a reverse proxy such as Caddy) and keep the
   app reachable only from your network or VPN: there is no sign-in yet.

Notes for running it elsewhere (Render, Railway, Fly, ECS, a VM):

- **Images:** `backend/Dockerfile` and `frontend/Dockerfile`. The frontend container needs
  `BACKEND_URL` (where it reaches the API, e.g. `http://backend:4000`). Both have health checks; the
  API's is `GET /api/health`.
- **Several API containers** work: events between them go through Postgres `LISTEN/NOTIFY`, spec syncs
  take a lock, and runs are claimed with row locks. Run migrations once per deploy
  (`MIGRATIONS_RUN=false` on the containers, and `npm run migrate` as a release step) instead of on
  every container's start.
- **Serving the frontend from another address** than the API: build it with
  `VITE_API_URL=https://<api host>/api` and set the API's `CORS_ORIGIN` to the frontend's address.
- **Moving an existing database:** the migration keeps all runs and results; results recorded before it
  are put under `qa.done.deals`. Screenshots older runs kept on disk are copied in with
  `node backend/scripts/import-screenshots.mjs /path/to/storage/reports` (run once with `DATABASE_URL` set).

Not done yet: sign-in and a record of who set a result or started a run; screenshots move to object
storage (S3) if the database grows too big for them.

## API

| | |
|---|---|
| `GET /api/health` | `{ ok: true }` when the database answers |
| `GET /api/catalog` | Folders, and suites → scenarios → test cases |
| `GET /api/results?environment=<host>` | `{ <test case id>: "pass" \| "fail" }` on that environment |
| `GET /api/results/environments` | `[{ key, results }]`: environments with results or a laptop pointed at them |
| `PUT /api/results/:testCaseId` | Body `{ "result": "pass" \| "fail" \| null, "environment": "<host>" }`; 409 for a case with an automated test |
| `GET /api/events` | Server-sent events: `catalog`, `results`, `automation`, `runs`, `logins` or `runners` when one changes |
| `POST /api/sync` | Upload the test case and yml files; needs the `x-sync-token` header |
| `GET /api/runners` | The laptops' runner agents, online first, with their environment and test count |
| `GET /api/runs/automation?runner=<id>` | `{ available, reason, tests, cases: { <test case id>: { tests, risky } } }` for that laptop |
| `GET /api/runs/current?runner=<id>` | The laptop's run going now, else its last one; `&log=1` adds pytest's output |
| `POST /api/runs` | Body `{ label, testCaseKeys, runnerId, includeDestructive?, headed?, scope? }`; queues the run; 409 while that laptop has one going |
| `POST /api/runs/:id/stop` | Stops that run |
| `GET /api/runs` | Past runs with their summary, newest first; `?scope=<key>` for one module, scenario or role |
| `GET /api/runs/:id/report` | Everything the report page shows |
| `GET /api/runs/:id/log` | pytest's output, as text |
| `GET /api/runs/:id/screenshots/:file` | A kept failure screenshot |
| `GET /api/logins?runner=<id>` | Each role's saved session on that laptop (`savedAt`) and open login window |
| `POST /api/logins/:role?runner=<id>` | Opens the login browser on that laptop for `buyer`, `seller`, `admin` or `biz_user` |
| `POST /api/logins/:role/save?runner=<id>` | Saves the session logged in there |
| `POST /api/logins/:role/cancel?runner=<id>` | Closes that login browser |
| `/api/agent/…` | For runner agents only (`x-runner-token`): hello, tests, poll, progress, finish, logins |
