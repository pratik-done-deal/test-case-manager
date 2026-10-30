import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAutomation, fetchCurrentRun, startRun, stopRun } from './api'
import type { Automation, CaseRunState, Run, RunScope, TestCase } from './types'

// What the pages need to offer runs: which cases can run, the run going now, and how to start one.
export type Runner = {
  automation: Automation | null
  run: Run | null
  going: boolean
  start: (label: string, cases: TestCase[], scope: RunScope) => void
  headed: boolean // runs show the browser
  setHeaded: (headed: boolean) => void
}

type Asking = { label: string; keys: string[]; tests: number; risky: number; scope: RunScope }

// A run with more tests than this (a whole role, a large module) is confirmed before it starts.
const BIG_RUN = 100

// Keeps the automation map and the current run up to date, and asks before a run that would change
// QA data. Returns the runner for the pages, plus the bar and dialog to render once.
export function useRunner(onError: (message: string) => void) {
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [headed, setHeadedState] = useState(readHeaded)
  // Runs started from this tab: when one that covers more than a case ends, its report opens here.
  const startedHere = useRef(new Set<string>())
  useEffect(() => {
    if (run && run.status !== 'running' && run.reported && startedHere.current.delete(run.id)) {
      window.location.hash = `#/reports/${run.id}`
    }
  }, [run])
  const setHeaded = (value: boolean) => {
    setHeadedState(value)
    saveHeaded(value)
  }

  const refreshAutomation = useCallback(() => {
    fetchAutomation().then(setAutomation, () => undefined)
  }, [])
  const refreshRun = useCallback(() => {
    fetchCurrentRun().then(setRun, () => undefined)
  }, [])

  const launch = async (asked: Asking, includeDestructive: boolean) => {
    setAsking(null)
    try {
      const started = await startRun({ label: asked.label, testCaseKeys: asked.keys, includeDestructive, headed, scope: asked.scope })
      startedHere.current.add(started.id)
      setRun(started)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const start = (label: string, cases: TestCase[], scope: RunScope) => {
    const keys = cases.map((c) => c.key).filter((key) => automation?.cases[key])
    if (!keys.length) return
    const tests = keys.reduce((n, key) => n + automation!.cases[key].tests, 0)
    const risky = keys.reduce((n, key) => n + automation!.cases[key].risky, 0)
    const asked = { label, keys, tests, risky, scope }
    if (risky || tests > BIG_RUN) setAsking(asked)
    else void launch(asked, false)
  }

  const runner: Runner = { automation, run, going: run?.status === 'running', start, headed, setHeaded }
  const dialog = asking && (
    <ConfirmRun
      asking={asking}
      onCancel={() => setAsking(null)}
      onSafe={() => void launch(asking, false)}
      onAll={() => void launch(asking, true)}
    />
  )
  return { runner, dialog, refreshAutomation, refreshRun }
}

// Headless or headed, remembered in this browser; headless until changed.
const HEADED = 'test-manager:headed'

function readHeaded() {
  try {
    return localStorage.getItem(HEADED) === '1'
  } catch {
    return false
  }
}

function saveHeaded(headed: boolean) {
  try {
    localStorage.setItem(HEADED, headed ? '1' : '0')
  } catch {
    // Not kept; it is headless again after a reload.
  }
}

// Headless | Headed: how the next run opens its browser.
export function ModeToggle({ runner }: { runner: Runner }) {
  if (runner.automation && !runner.automation.available) return null
  return (
    <span className="mode-toggle" role="group" aria-label="Browser mode for runs">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          aria-pressed={runner.headed === value}
          title={
            value
              ? 'Runs open a visible browser window (on the machine the backend runs on)'
              : 'Runs use a hidden browser (faster)'
          }
          onClick={() => runner.setHeaded(value)}
        >
          {value ? 'Headed' : 'Headless'}
        </button>
      ))}
    </span>
  )
}

const shortName = (nodeid: string) => nodeid.split('::').pop() ?? nodeid

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The cases among these that have tests, and what a run of them would cover.
export function runnable(runner: Runner, cases: TestCase[]) {
  const ready = cases.filter((c) => runner.automation?.cases[c.key])
  const tests = ready.reduce((n, c) => n + runner.automation!.cases[c.key].tests, 0)
  return { ready, tests }
}

function whyNot(runner: Runner, ready: number) {
  if (!runner.automation) return 'Checking which test cases have tests…'
  if (!runner.automation.available) return runner.automation.reason ?? 'Tests cannot be run from here'
  if (runner.going) return 'A run is going; wait for it or stop it'
  if (!ready) return 'No automated test'
  return null
}

function PlayIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d="M1 1.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L1.9.7a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  )
}

// "Run 13" for a page's or a scenario's cases.
export function RunGroupButton({
  runner,
  label,
  cases,
  scope,
  text = 'Run',
}: {
  runner: Runner
  label: string
  cases: TestCase[]
  scope: RunScope
  text?: string // "Run all" beside a role heading
}) {
  const { ready, tests } = runnable(runner, cases)
  const blocked = whyNot(runner, ready.length)
  if (runner.automation && !ready.length) return null
  const missing = cases.length - ready.length
  const title =
    blocked ??
    `Run ${plural(tests, 'test')} for ${plural(ready.length, 'test case')}` +
      (missing ? `; ${missing} without an automated test are left out` : '')
  return (
    <button className="run-button" disabled={Boolean(blocked)} title={title} onClick={() => runner.start(label, ready, scope)}>
      <PlayIcon />
      {text} {ready.length.toLocaleString()}
    </button>
  )
}

// A case's run control: a play button, or where it is in the run going now.
export function CaseRunCell({ runner, testCase }: { runner: Runner; testCase: TestCase }) {
  const state: CaseRunState | undefined = runner.going ? runner.run?.cases[testCase.key] : undefined
  if (state === 'queued' || state === 'running') {
    return (
      <span className={`case-run case-run-${state}`} title={state === 'running' ? 'Running now' : 'Waiting to run'}>
        {state === 'running' ? <span className="spinner" /> : <span className="queued-dot" />}
      </span>
    )
  }
  const info = runner.automation?.cases[testCase.key]
  const blocked = whyNot(runner, info ? 1 : 0)
  if (runner.automation && !info) return <span className="case-run" />
  return (
    <button
      className="case-run case-run-button"
      disabled={Boolean(blocked)}
      title={blocked ?? `Run ${testCase.id}${info && info.tests > 1 ? ` (${info.tests} tests)` : ''}`}
      aria-label={`Run ${testCase.id}`}
      onClick={() => runner.start(testCase.id, [testCase], { kind: 'case', key: `case:${testCase.key}`, name: testCase.id })}
    >
      <PlayIcon />
    </button>
  )
}

function ConfirmRun({
  asking,
  onCancel,
  onSafe,
  onAll,
}: {
  asking: Asking
  onCancel: () => void
  onSafe: () => void
  onAll: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const safe = asking.tests - asking.risky
  const total = asking.tests.toLocaleString()
  return (
    <dialog ref={ref} className="confirm" onClose={onCancel}>
      <h3>{asking.risky ? 'Run tests that change QA data?' : `Run ${total} tests?`}</h3>
      {asking.tests > BIG_RUN && (
        <p>
          <b>{asking.label}</b> covers {plural(asking.keys.length, 'test case')} with {total} tests. A run this size can take
          a long time, and no other run can start until it ends; you can stop it from the bar at the bottom.
        </p>
      )}
      {asking.risky > 0 && (
        <p>
          {asking.risky === asking.tests
            ? asking.risky === 1
              ? 'This test'
              : `All ${total} tests`
            : `${asking.risky.toLocaleString()} of the ${total} tests`}{' '}
          {asking.tests <= BIG_RUN && (
            <>
              in <b>{asking.label}</b>{' '}
            </>
          )}
          {asking.risky === 1 ? 'is' : 'are'} marked <code>destructive</code> or <code>live_login</code>: they create or change
          records on QA, or send a real login code.
        </p>
      )}
      <div className="confirm-actions">
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
        {asking.risky > 0 && safe > 0 && (
          <button className="secondary-button" onClick={onSafe}>
            Run the other {plural(safe, 'test')}
          </button>
        )}
        <button className={asking.risky ? 'primary-button' : 'save-button'} onClick={asking.risky ? onAll : onSafe}>
          Run {asking.risky ? 'all ' : ''}
          {total}
        </button>
      </div>
    </dialog>
  )
}

// The last run dismissed in this browser, so it stays dismissed after a reload.
const DISMISSED = 'test-manager:dismissed-run'

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED)
  } catch {
    return null
  }
}

function saveDismissed(id: string) {
  try {
    localStorage.setItem(DISMISSED, id)
  } catch {
    // Not kept; it shows again after a reload.
  }
}

const STATUS: Record<Run['status'], string> = {
  running: 'Running',
  finished: 'Finished',
  stopped: 'Stopped',
  error: 'pytest could not run the tests',
  interrupted: 'Interrupted: the backend restarted during the run',
}

// The run going now, or the last one until it is dismissed: progress, failures, pytest's output, Stop.
export function RunBar({ runner }: { runner: Runner }) {
  const { run } = runner
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState('')
  const [stopping, setStopping] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  // The output is only fetched while it is open, and again as the run moves on.
  useEffect(() => {
    if (!open || !run) return
    fetchCurrentRun(true).then((latest) => setLog(latest?.log ?? ''), () => undefined)
  }, [open, run])
  useEffect(() => {
    const pre = logRef.current
    if (pre) pre.scrollTop = pre.scrollHeight
  }, [log])
  useEffect(() => setStopping(false), [run?.id])

  if (!run || (dismissed === run.id && run.status !== 'running')) return null

  const going = run.status === 'running'
  const c = run.counts
  const failed = (c.failed ?? 0) + (c.error ?? 0)
  const passed = (c.passed ?? 0) + (c.xpassed ?? 0)
  const skipped = (c.skipped ?? 0) + (c.xfailed ?? 0)
  const percent = run.total ? (run.done / run.total) * 100 : 0
  const dot = failed || run.status === 'error' ? 'fail-dot' : run.status === 'finished' && passed ? 'pass-dot' : 'idle-dot'

  return (
    <div className={`run-bar run-${run.status}`} role="status">
      {open && (
        <div className="run-output">
          {run.problems.length > 0 && (
            <ul className="run-problems">
              {run.problems.map((problem) => (
                <li key={problem.nodeid}>
                  <b className="fail">{problem.outcome}</b> <code>{shortName(problem.nodeid)}</code>
                  {problem.message && <span>{problem.message}</span>}
                </li>
              ))}
            </ul>
          )}
          <pre ref={logRef}>{log || 'No output yet.'}</pre>
        </div>
      )}
      <div className="run-progress" style={{ width: `${percent}%` }} />
      <div className="run-line">
        {going ? <span className="spinner" /> : <span className={`run-dot ${dot}`} />}
        <span className="run-label">
          {STATUS[run.status]} <b>{run.label}</b>
          {run.options?.headed && <span className="run-mode"> · headed</span>}
        </span>
        <span className="run-counts">
          {run.done}/{plural(run.total, 'test')}
          {passed > 0 && <span className="pass"> · {passed} passed</span>}
          {failed > 0 && <span className="fail"> · {failed} failed</span>}
          {skipped > 0 && <span> · {skipped} skipped</span>}
        </span>
        {going && run.current && <span className="run-current">{shortName(run.current)}</span>}
        <span className="run-actions">
          <button className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide output' : 'Output'}
          </button>
          <a className="text-button" href={`#/reports/${run.id}`}>
            Report
          </a>
          {going ? (
            <button
              className="secondary-button"
              disabled={stopping}
              onClick={() => {
                setStopping(true)
                stopRun(run.id).catch(() => setStopping(false))
              }}
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button
              className="text-button"
              aria-label="Dismiss"
              onClick={() => {
                setDismissed(run.id)
                saveDismissed(run.id)
                setOpen(false)
              }}
            >
              ✕
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
