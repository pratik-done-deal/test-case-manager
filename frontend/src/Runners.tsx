import { useCallback, useEffect, useState } from 'react'
import { fetchEnvironments, fetchRunners } from './api'
import type { Environment, RunnerInfo } from './types'

// A runner that went offline only shows as offline when the list is fetched again.
const RUNNERS_MS = 15_000

const RUNNER = 'test-manager:runner'
const ENVIRONMENT = 'test-manager:environment'
// What an environment looks like: the host of the app, e.g. "qa.done.deals", "localhost:3000".
const HOST = /^[\w.-]+(:\d+)?$/

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function save(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Not kept; picked again after a reload.
  }
}

// The runner agents, and the one this browser runs its tests on: remembered here, picked by itself when
// only one is online.
export function useRunners() {
  const [runners, setRunners] = useState<RunnerInfo[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(() => read(RUNNER))

  const refresh = useCallback(() => {
    fetchRunners().then(setRunners, () => undefined)
  }, [])
  useEffect(() => {
    const timer = setInterval(refresh, RUNNERS_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const known = runners?.some((runner) => runner.id === chosen)
  const online = runners?.filter((runner) => runner.online) ?? []
  const runnerId = known ? chosen : online.length === 1 ? online[0].id : null
  const runner = runners?.find((r) => r.id === runnerId) ?? null

  const choose = (id: string | null) => {
    setChosen(id)
    save(RUNNER, id)
  }
  return { runners, runner, runnerId, choose, refresh }
}

// The environment whose results the pages show and where results set by hand go: the one picked in this
// browser, else the runner's, else the one with the most results.
export function useEnvironment(runner: RunnerInfo | null) {
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [chosen, setChosen] = useState<string | null>(() => read(ENVIRONMENT))
  const refresh = useCallback(() => {
    fetchEnvironments().then(setEnvironments, () => undefined)
  }, [])
  const environment = chosen ?? runner?.environmentKey ?? environments[0]?.key ?? null
  const choose = (key: string | null) => {
    setChosen(key)
    save(ENVIRONMENT, key)
  }
  return { environments, environment, choose, refresh }
}

// Above the pages: which laptop runs the tests, and which environment's results are shown.
export function Workspace({
  runners,
  runnerId,
  onRunner,
  environments,
  environment,
  onEnvironment,
}: {
  runners: RunnerInfo[] | null
  runnerId: string | null
  onRunner: (id: string | null) => void
  environments: Environment[]
  environment: string | null
  onEnvironment: (key: string | null) => void
}) {
  const runner = runners?.find((r) => r.id === runnerId) ?? null
  const [typed, setTyped] = useState(environment ?? '')
  useEffect(() => setTyped(environment ?? ''), [environment])

  const commit = () => {
    const value = typed.trim()
    if (!value) onEnvironment(null)
    else if (HOST.test(value)) onEnvironment(value)
    else setTyped(environment ?? '')
  }

  return (
    <div className="workspace">
      <label className="workspace-field">
        <span>Runs on</span>
        <select
          id="runner-picker"
          value={runnerId ?? ''}
          onChange={(event) => onRunner(event.target.value || null)}
          disabled={!runners?.length}
        >
          {!runners?.length && <option value="">No runner yet</option>}
          {runners?.length && !runnerId ? <option value="">Pick a laptop…</option> : null}
          {runners?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.online ? '' : ' (offline)'}
            </option>
          ))}
        </select>
        {runner && <span className={`runner-dot ${runner.online ? 'runner-online' : 'runner-offline'}`} aria-hidden="true" />}
      </label>
      {(!runners?.length || (runner && !runner.online)) && (
        <span className="workspace-hint">
          {runner ? `${runner.name} is offline.` : 'No laptop is connected.'} Start the runner agent on your laptop to run tests
          (see <code>agent/README.md</code>).
        </span>
      )}
      {runner?.online && runner.environment?.branch && (
        <span className="workspace-hint" title="The ai-qa checkout on that laptop">
          ai-qa <code>{runner.environment.branch}</code> @ <code>{runner.environment.commit}</code>
        </span>
      )}
      <label className="workspace-field workspace-environment">
        <span>Results for</span>
        <input
          id="environment-picker"
          list="environments"
          value={typed}
          placeholder="qa.done.deals"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
          title="The app the tests ran against. Results from each are kept apart."
        />
        <datalist id="environments">
          {environments.map((e) => (
            <option key={e.key} value={e.key}>
              {e.results} results
            </option>
          ))}
        </datalist>
      </label>
    </div>
  )
}
