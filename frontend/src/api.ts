// The only place the app talks to the backend.
import type { Automation, Environment, LoginRole, Logins, Report, Result, Results, Run, RunListItem, RunnerInfo, RunScope } from './types'

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init })
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status})`)
  return response
}

// Returned as text so the caller can tell cheaply whether anything changed since the last load.
export async function fetchCatalogText(): Promise<string> {
  return (await request('/catalog')).text()
}

const query = (params: Record<string, string | null | undefined>) => {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))
  return entries.length ? `?${new URLSearchParams(entries)}` : ''
}

// The results on one environment (the app the tests point at, e.g. "qa.done.deals").
export async function fetchResults(environment: string | null): Promise<Results> {
  if (!environment) return {}
  return (await request(`/results${query({ environment })}`)).json()
}

// Every environment that has results or a runner pointed at it.
export async function fetchEnvironments(): Promise<Environment[]> {
  return (await request('/results/environments')).json()
}

// null clears the result, back to "not run".
export async function putResult(key: string, environment: string, result: Result | null): Promise<void> {
  await request(`/results/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result, environment }),
  })
}

// The runner agents on testers' laptops, online ones first.
export async function fetchRunners(): Promise<RunnerInfo[]> {
  return (await request('/runners')).json()
}

// Which test cases the runner has tests for.
export async function fetchAutomation(runner: string | null): Promise<Automation> {
  return (await request(`/runs/automation${query({ runner })}`)).json()
}

// The run going now on the runner, else its last one; null before the first. withLog adds pytest's output.
export async function fetchCurrentRun(runner: string | null, withLog = false): Promise<Run | null> {
  if (!runner) return null
  const text = await (await request(`/runs/current${query({ runner, log: withLog ? '1' : null })}`)).text()
  return text ? JSON.parse(text) : null
}

// Queues the tests of these test cases for the runner. Tests that change QA data only run with
// includeDestructive; headed shows the browser on the runner's laptop.
export async function startRun(body: {
  label: string
  testCaseKeys: string[]
  runnerId: string
  includeDestructive: boolean
  headed: boolean
  scope: RunScope
}): Promise<Run> {
  const response = await fetch(`${API_URL}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const { message } = await response.json().catch(() => ({ message: null }))
    throw new Error(message ?? `Could not start the run (${response.status})`)
  }
  return response.json()
}

export async function fetchReport(id: string): Promise<Report> {
  return (await request(`/runs/${id}/report`)).json()
}

export async function fetchRunLog(id: string): Promise<string> {
  return (await request(`/runs/${id}/log`)).text()
}

// Past runs, newest first; only those of one scope when given.
export async function fetchRunHistory(scope?: string): Promise<RunListItem[]> {
  return (await request(`/runs${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`)).json()
}

// A file the backend serves (a kept screenshot), from the path a report gives.
export const apiUrl = (path: string) => `${API_URL}${path}`

export async function stopRun(id: string): Promise<void> {
  await request(`/runs/${id}/stop`, { method: 'POST' })
}

export async function fetchLogins(runner: string | null): Promise<Logins> {
  return (await request(`/logins${query({ runner })}`)).json()
}

// Opens the role's login browser on the runner's laptop (no action), saves what was logged in there, or closes it.
export async function loginAction(runner: string, role: LoginRole, action?: 'save' | 'cancel'): Promise<Logins> {
  const response = await fetch(`${API_URL}/logins/${role}${action ? `/${action}` : ''}${query({ runner })}`, { method: 'POST' })
  if (!response.ok) {
    const { message } = await response.json().catch(() => ({ message: null }))
    throw new Error(message ?? `Could not ${action ?? 'open the login window'} (${response.status})`)
  }
  return response.json()
}

type Handlers = {
  catalog: () => void
  results: () => void
  automation: () => void
  runs: () => void
  logins: () => void
  runners: () => void
}

// Calls back when the backend says something changed, and once for everything whenever the
// connection (re)opens, since changes made while it was down were missed.
export function subscribe(handlers: Handlers) {
  const source = new EventSource(`${API_URL}/events`)
  for (const event of Object.keys(handlers) as (keyof Handlers)[]) source.addEventListener(event, handlers[event])
  source.addEventListener('open', () => Object.values(handlers).forEach((handler) => handler()))
  return () => source.close()
}
