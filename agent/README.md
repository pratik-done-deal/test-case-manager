# Test Manager runner agent

The deployed Test Manager can't run ai-qa's tests itself: they need your ai-qa checkout, its Python and
a browser. This agent runs on your laptop next to the checkout and does that work for the app:

- it lists the tests in your checkout, so the app knows which test cases have a Run button;
- it picks up the runs you start in the app for this laptop, runs them with ai-qa's own pytest, and
  reports each test's outcome, its screenshots and pytest's output as they happen;
- it opens the **Login as …** windows, the same as `python scripts/save_auth_state.py <role>`.

Headed runs and login windows open on your screen, because they run here.

## Set up (once)

Needs Node 20.12+ and an ai-qa checkout whose `.venv` has pytest and Playwright installed.

```bash
cd agent
cp .env.example .env
```

Fill in `.env`:

| | |
|---|---|
| `API_URL` | The app's API, e.g. `https://test-manager.example.com/api` |
| `RUNNER_TOKEN` | Ask whoever deployed the app; it's the backend's `RUNNER_TOKEN` |
| `RUNNER_NAME` | How this laptop shows in the app, e.g. `pratik-mac`. Defaults to the computer's name |
| `AI_QA_DIR` | Your ai-qa checkout |
| `AI_QA_PYTHON` | Only if the Python isn't `<AI_QA_DIR>/.venv/bin/python` |

## Run

```bash
npm start
```

Leave it running while you use the app. In the app, pick this laptop in the runner picker beside Run.
It's remembered in your browser.

## What to expect

- **Which branch runs:** whatever is checked out in `AI_QA_DIR`. The app shows the branch and commit
  in each run's report. The agent notices a `git checkout` or pull and tells the app.
- **Which environment results go to:** the app ai-qa's settings point at (`settings.app_url`), e.g.
  `qa.done.deals` or `localhost:3000`. Results from QA and from a local app are kept apart.
- **One run at a time** per laptop. Other testers' laptops run their own.
- **Closing the laptop or stopping the agent** during a run: the app marks the run *interrupted* after
  about a minute. Quitting with Ctrl+C stops pytest first and reports the run as stopped.
- **Connection drops** are retried; outcomes are kept until the app has them.
