import { useEffect, useMemo, useState } from 'react'
import { apiUrl, fetchReport, fetchRunHistory, fetchRunLog } from './api'
import type { CaseStatus, Report, Run, RunListItem, RunScope } from './types'

// The pages under #/reports: one run's report, and the list of past runs.
export type ReportsRoute = { id: string } | { scope: string | null }

export function parseReportsHash(hash: string): ReportsRoute | null {
  const match = hash.match(/^#\/reports(?:\/([0-9a-f-]{36}))?(?:\?scope=(.*))?$/)
  if (!match) return null
  if (match[1]) return { id: match[1] }
  return { scope: match[2] ? decodeURIComponent(match[2]) : null }
}

const historyHash = (scope?: string | null) => `#/reports${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`

const LABELS: Record<CaseStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Error',
  skipped: 'Skipped',
  pending: 'Pending feature',
  'not run': 'Not run',
}

const MEANING: Record<CaseStatus, string> = {
  passed: 'All its tests passed',
  failed: 'A check in the test failed',
  error: 'The test broke in setup or teardown, before or after checking anything',
  skipped: 'The test skipped itself',
  pending: 'Failed as expected: the feature has not shipped',
  'not run': 'The run ended before it was reached',
}

// Legend order: what needs attention first.
const LEGEND: CaseStatus[] = ['passed', 'failed', 'error', 'pending', 'skipped', 'not run']
// Slice order: Passed never touches Failed, which red-green colour blindness would merge.
const SLICES: CaseStatus[] = ['passed', 'skipped', 'failed', 'error', 'pending', 'not run']

const slug = (status: CaseStatus) => status.replace(' ', '-')

const KIND: Record<RunScope['kind'], string> = {
  case: 'Test case',
  scenario: 'Scenario',
  page: 'Module',
  filtered: 'Filtered module',
  role: 'Role',
}

const RUN_STATUS: Record<Run['status'], string> = {
  running: 'Running',
  finished: 'Finished',
  stopped: 'Stopped',
  error: 'pytest could not run the tests',
  interrupted: 'Interrupted',
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const percent = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 100)}%`)

// One run's report. live: the run going now, so its report follows it while it runs.
export function ReportView({ id, live }: { id: string; live: Run | null }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const following = live?.id === id ? `${live.status}:${live.done}` : null

  useEffect(() => {
    fetchReport(id).then(
      (loaded) => {
        setReport(loaded)
        setError(null)
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [id, following])

  if (error) return <div className="center">Could not load this report: {error}</div>
  if (!report || report.run.id !== id) return <div className="center">Loading report…</div>

  const { run, summary } = report
  const scope = run.scope
  const problems = report.cases.filter((c) => c.status === 'failed' || c.status === 'error')
  const quiet = report.cases.filter((c) => c.status === 'skipped' || c.status === 'pending')

  return (
    <article className="suite report">
      <header className="suite-header">
        <p className="eyebrow">
          <a href={historyHash()}>Reports</a>
          {scope && (
            <span>
              {' › '}
              <a href={historyHash(scope.key)}>{KIND[scope.kind]}</a>
            </span>
          )}
          <span className={`status run-status-${run.status}`}>{RUN_STATUS[run.status]}</span>
        </p>
        <h2>{scope?.name ?? run.label}</h2>
        <p className="about">
          {when(run.startedAt)}
          {run.finishedAt && ` · took ${duration(summary.seconds)}`}
          {run.status === 'running' && ' · still running'}
        </p>
        <ul className="report-meta">
          {run.environment?.appUrl && <li>{new URL(run.environment.appUrl).host}</li>}
          <li>{run.options.headed ? 'Headed' : 'Headless'}</li>
          <li>{run.options.includeDestructive ? 'Destructive tests included' : 'Destructive tests left out'}</li>
          {run.environment?.branch && (
            <li title="The ai-qa checkout the tests came from">
              ai-qa <code>{run.environment.branch}</code> @ <code>{run.environment.commit}</code>
              {run.environment.dirty && ' (with uncommitted changes)'}
            </li>
          )}
        </ul>
      </header>

      <section className="report-overview">
        <Donut summary={summary} />
        <div className="report-tiles">
          <Tile
            value={String(summary.cases.failed + summary.cases.error)}
            label="Failures"
            hint="Failed + error"
            alert={summary.cases.failed + summary.cases.error > 0}
          />
          <Tile value={String(report.cases.length)} label="Test cases" />
          <Tile value={String(summary.tests)} label="Tests" />
          <Tile value={duration(summary.seconds)} label="Duration" />
        </div>
      </section>

      {report.comparison ? (
        <Comparison comparison={report.comparison} />
      ) : (
        scope && <p className="report-note">This is the first run of {scope.name}, so there is nothing to compare it with yet.</p>
      )}
      {report.trend.filter((point) => point.passRate !== null).length > 1 && <Trend trend={report.trend} current={run.id} />}

      <section className="report-section">
        <h3>By scenario</h3>
        <ul className="scenario-bars">
          {report.scenarios.map((scenario) => (
            <ScenarioBar key={`${scenario.suite}/${scenario.id}`} scenario={scenario} />
          ))}
        </ul>
      </section>

      <section className="report-section">
        <h3>
          Failures <span className="report-count">{problems.length}</span>
        </h3>
        {problems.length === 0 ? (
          <p className="report-note">No test case failed.</p>
        ) : (
          <ul className="failures">
            {problems.map((testCase) => (
              <li key={testCase.key} className="failure">
                <p className="failure-head">
                  <span className={`status-tag tag-${slug(testCase.status)}`}>{LABELS[testCase.status]}</span>
                  <b>{testCase.code}</b> {testCase.title}
                  <span className="failure-scenario">
                    {testCase.scenario.id} {testCase.scenario.title}
                  </span>
                </p>
                {testCase.tests
                  .filter((test) => test.outcome === 'failed' || test.outcome === 'error')
                  .map((test) => (
                    <div key={test.nodeid} className="failure-test">
                      <code className="failure-name">{test.name}</code>
                      {test.message && <pre className="failure-message">{test.message}</pre>}
                      {test.screenshots.length > 0 && (
                        <div className="screenshots">
                          {test.screenshots.map((shot, i) =>
                            shot.src ? (
                              <a key={i} href={apiUrl(shot.src)} target="_blank" rel="noreferrer" title={shot.url}>
                                <img src={apiUrl(shot.src)} alt={`Screenshot of ${shot.url} when ${test.name} failed`} loading="lazy" />
                                <span>{shot.url}</span>
                              </a>
                            ) : (
                              <span key={i} className="screenshot-gone">
                                Screenshot of {shot.url} no longer kept
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {quiet.length > 0 && (
        <section className="report-section">
          <h3>
            Skipped and pending <span className="report-count">{quiet.length}</span>
          </h3>
          <ul className="quiet-list">
            {quiet.map((testCase) => (
              <li key={testCase.key}>
                <span className={`status-tag tag-${slug(testCase.status)}`}>{LABELS[testCase.status]}</span>
                <b>{testCase.code}</b> {testCase.title}
                <span className="quiet-reason">
                  {[...new Set(testCase.tests.map((test) => test.message).filter(Boolean))].join(' · ') || 'No reason given'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.slowest.length > 0 && (
        <section className="report-section">
          <h3>Slowest tests</h3>
          <ol className="slowest">
            {report.slowest.map((test) => (
              <li key={test.nodeid}>
                <span>
                  {test.code && <b>{test.code}</b>} <code>{test.name}</code>
                </span>
                <span className="slowest-time">{test.seconds.toFixed(1)} s</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <RunOutput id={run.id} following={following} />
    </article>
  )
}

function Tile({ value, label, hint, alert }: { value: string; label: string; hint?: string; alert?: boolean }) {
  return (
    <div className={alert ? 'tile tile-alert' : 'tile'} title={hint}>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </div>
  )
}

// Test case results as a ring: the pass rate in the middle, or the hovered slice's count.
function Donut({ summary }: { summary: Report['summary'] }) {
  const [hover, setHover] = useState<CaseStatus | null>(null)
  const total = LEGEND.reduce((n, status) => n + summary.cases[status], 0)
  const size = 168
  const stroke = 18
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const shown = SLICES.filter((status) => summary.cases[status] > 0)
  // A 2px gap between slices, so neighbours read apart even where their colours are close.
  const gap = shown.length > 1 ? 2 : 0

  let offset = 0
  const slices = shown.map((status) => {
    const length = (summary.cases[status] / total) * circumference
    const slice = { status, dash: Math.max(length - gap, 0.5), offset }
    offset += length
    return slice
  })

  return (
    <div className="donut-wrap">
      <svg
        className="donut"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={LEGEND.filter((s) => summary.cases[s]).map((s) => `${summary.cases[s]} ${LABELS[s].toLowerCase()}`).join(', ')}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} className="donut-track" strokeWidth={stroke} fill="none" />
        {slices.map(({ status, dash, offset: start }) => (
          <circle
            key={status}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={`slice slice-${slug(status)}${hover && hover !== status ? ' slice-dim' : ''}`}
            strokeWidth={hover === status ? stroke + 4 : stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-start}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            onMouseEnter={() => setHover(status)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${LABELS[status]}: ${summary.cases[status]} of ${total}`}</title>
          </circle>
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="donut-value">
          {hover ? summary.cases[hover] : percent(summary.passRate)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" className="donut-label">
          {hover ? LABELS[hover] : 'pass rate'}
        </text>
      </svg>
      <ul className="legend">
        {LEGEND.map((status) => {
          const count = summary.cases[status]
          return (
            <li
              key={status}
              className={`${count ? '' : 'legend-empty'}${hover === status ? ' legend-on' : ''}`}
              title={MEANING[status]}
              onMouseEnter={() => count && setHover(status)}
              onMouseLeave={() => setHover(null)}
            >
              <span className={`swatch swatch-${slug(status)}`} />
              <span className="legend-name">{LABELS[status]}</span>
              <span className="legend-count">{count}</span>
              <span className="legend-share">{total ? `${Math.round((count / total) * 100)}%` : ''}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Comparison({ comparison }: { comparison: NonNullable<Report['comparison']> }) {
  const groups = [
    { key: 'new', title: 'New failures', hint: 'Passed last time, fail now', cases: comparison.newFailures },
    { key: 'fixed', title: 'Fixed', hint: 'Failed last time, pass now', cases: comparison.fixed },
    { key: 'still', title: 'Still failing', hint: 'Failed both times', cases: comparison.stillFailing },
  ]
  return (
    <section className="report-section">
      <h3>
        Compared with the run of <a href={`#/reports/${comparison.previous.id}`}>{when(comparison.previous.startedAt)}</a>
      </h3>
      <div className="comparison">
        {groups.map((group) => (
          <div key={group.key} className={`compare compare-${group.key}`}>
            <p className="compare-title" title={group.hint}>
              {group.title} <span className="report-count">{group.cases.length}</span>
            </p>
            {group.cases.length === 0 ? (
              <p className="compare-none">None</p>
            ) : (
              <ul>
                {group.cases.map((testCase) => (
                  <li key={testCase.key}>
                    <b>{testCase.code}</b> {testCase.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {comparison.newCases > 0 && (
        <p className="report-note">
          {comparison.newCases} test case{comparison.newCases === 1 ? ' was' : 's were'} not in the previous run.
        </p>
      )}
    </section>
  )
}

// Pass rate of the last runs of the same thing, oldest first; hovering a point shows its run.
function Trend({ trend, current }: { trend: Report['trend']; current: string }) {
  const points = trend.filter((point) => point.passRate !== null)
  const [hover, setHover] = useState<number | null>(null)
  const width = 600
  const height = 140
  const pad = { left: 40, right: 16, top: 14, bottom: 22 }
  const x = (i: number) => pad.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (width - pad.left - pad.right))
  const y = (rate: number) => pad.top + (1 - rate) * (height - pad.top - pad.bottom)
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(i)},${y(point.passRate!)}`).join(' ')
  const shown = hover !== null ? points[hover] : null

  return (
    <section className="report-section">
      <h3>Pass rate over the last {points.length} runs</h3>
      <div className="trend">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Pass rate: ${points.map((p) => percent(p.passRate)).join(', ')}`}>
          {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'axis' : 'grid'} />
              <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="tick">
                {tick * 100}%
              </text>
            </g>
          ))}
          <path d={path} className="trend-line" fill="none" />
          {points.map((point, i) => (
            <g key={point.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <circle cx={x(i)} cy={y(point.passRate!)} r={14} className="hit" />
              <circle
                cx={x(i)}
                cy={y(point.passRate!)}
                r={point.id === current || hover === i ? 5 : 4}
                className={point.id === current ? 'trend-dot trend-current' : 'trend-dot'}
              />
            </g>
          ))}
        </svg>
        {shown && (
          <div
            className="trend-tip"
            style={{ left: `${(x(hover!) / width) * 100}%`, top: `${(y(shown.passRate!) / height) * 100}%` }}
          >
            <b>{percent(shown.passRate)}</b> {when(shown.startedAt)}
            {shown.id === current && ' · this run'}
          </div>
        )}
      </div>
    </section>
  )
}

function ScenarioBar({ scenario }: { scenario: Report['scenarios'][number] }) {
  const total = LEGEND.reduce((n, status) => n + (scenario.counts[status] ?? 0), 0)
  const bad = (scenario.counts.failed ?? 0) + (scenario.counts.error ?? 0)
  return (
    <li className="scenario-bar">
      <span className="scenario-bar-name" title={scenario.suite}>
        <b>{scenario.id}</b> {scenario.title}
      </span>
      <span className="bar" aria-hidden="true">
        {LEGEND.filter((status) => scenario.counts[status]).map((status) => (
          <span
            key={status}
            className={`bar-part swatch-${slug(status)}`}
            style={{ flexGrow: scenario.counts[status] }}
            title={`${LABELS[status]}: ${scenario.counts[status]}`}
          />
        ))}
      </span>
      <span className="scenario-bar-count">
        {scenario.counts.passed ?? 0}/{total} passed
        {bad > 0 && <span className="fail"> · {bad} failed</span>}
      </span>
    </li>
  )
}

function RunOutput({ id, following }: { id: string; following: string | null }) {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<string | null>(null)
  useEffect(() => {
    if (open) fetchRunLog(id).then(setLog, () => setLog('Could not load the output.'))
  }, [open, id, following])
  return (
    <section className="report-section">
      <button className="text-button report-output-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide pytest output' : 'Show pytest output'}
      </button>
      {open && <pre className="report-log">{log ?? 'Loading…'}</pre>}
    </section>
  )
}

// Every past run, newest first, filterable by what it covered.
export function HistoryView({ scope, live }: { scope: string | null; live: Run | null }) {
  const [runs, setRuns] = useState<RunListItem[] | null>(null)
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const following = live ? `${live.id}:${live.status}` : null

  useEffect(() => {
    fetchRunHistory(scope ?? undefined).then(setRuns, () => setRuns([]))
  }, [scope, following])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (runs ?? []).filter(
      (run) =>
        (!kind || run.scope?.kind === kind || (kind === 'none' && !run.scope)) &&
        (!q || `${run.scope?.name ?? ''} ${run.label}`.toLowerCase().includes(q)),
    )
  }, [runs, kind, query])

  const scopeName = scope ? runs?.find((run) => run.scope?.key === scope)?.scope?.name ?? 'this' : null

  return (
    <article className="suite reports">
      <header className="suite-header">
        <p className="eyebrow">
          {scope ? <a href={historyHash()}>Reports</a> : 'Reports'}
        </p>
        <h2>{scope ? `Runs of ${scopeName}` : 'Reports'}</h2>
        <p className="about">Every run started from the Test Manager, newest first. Open one to see its report.</p>
      </header>
      {!scope && (
        <div className="toolbar">
          <input type="search" placeholder="Search runs" aria-label="Search runs" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className={kind ? 'pill pill-on' : 'pill'} aria-label="What was run" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Everything</option>
            <option value="page">Modules</option>
            <option value="role">Roles</option>
            <option value="scenario">Scenarios</option>
            <option value="filtered">Filtered modules</option>
            <option value="case">Single test cases</option>
            <option value="none">Older runs</option>
          </select>
        </div>
      )}
      {!runs ? (
        <p className="report-note">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="report-note">No runs yet.</p>
      ) : (
        <ul className="history">
          {shown.map((run) => (
            <li key={run.id}>
              <a href={`#/reports/${run.id}`} className="history-row">
                <span className="history-what">
                  <b>{run.scope?.name ?? run.label}</b>
                  <span>
                    {run.scope ? KIND[run.scope.kind] : 'Run'} · {when(run.startedAt)}
                    {run.summary && ` · ${duration(run.summary.seconds)}`}
                    {run.status !== 'finished' && ` · ${RUN_STATUS[run.status].toLowerCase()}`}
                  </span>
                </span>
                {run.summary ? (
                  <>
                    <span className="bar history-bar" aria-hidden="true">
                      {LEGEND.filter((status) => run.summary!.cases[status]).map((status) => (
                        <span key={status} className={`bar-part swatch-${slug(status)}`} style={{ flexGrow: run.summary!.cases[status] }} />
                      ))}
                    </span>
                    <span className="history-numbers">
                      <b>{percent(run.summary.passRate)}</b>
                      <span>
                        {run.summary.cases.passed} passed
                        {run.summary.cases.failed + run.summary.cases.error > 0 && (
                          <span className="fail"> · {run.summary.cases.failed + run.summary.cases.error} failed</span>
                        )}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="history-numbers">–</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
