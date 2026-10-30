// The only place the app talks to the backend.
import type { Automation, LoginRole, Logins, Report, Result, Results, Run, RunListItem, RunScope } from './types'

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

export async function fetchResults(): Promise<Results> {
  return (await request('/results')).json()
}

// null clears the result, back to "not run".
export async function putResult(key: string, result: Result | null): Promise<void> {
  await request(`/results/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  })
}

export async function fetchAutomation(): Promise<Automation> {
  return (await request('/runs/automation')).json()
}

// The run going now, else the last one; null before the first. withLog adds pytest's output.
export async function fetchCurrentRun(withLog = false): Promise<Run | null> {
  const text = await (await request(`/runs/current${withLog ? '?log=1' : ''}`)).text()
  return text ? JSON.parse(text) : null
}

// Runs the tests of these test cases. Tests that change QA data only run with includeDestructive;
// headed shows the browser on the machine the backend runs on.
export async function startRun(body: {
  label: string
  testCaseKeys: string[]
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

export async function fetchLogins(): Promise<Logins> {
  return (await request('/logins')).json()
}

// Opens the role's login browser (no action), saves what was logged in there, or closes it.
export async function loginAction(role: LoginRole, action?: 'save' | 'cancel'): Promise<Logins> {
  const response = await fetch(`${API_URL}/logins/${role}${action ? `/${action}` : ''}`, { method: 'POST' })
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
}

// Calls back when the backend says something changed, and once for everything whenever the
// connection (re)opens, since changes made while it was down were missed.
export function subscribe(handlers: Handlers) {
  const source = new EventSource(`${API_URL}/events`)
  for (const event of Object.keys(handlers) as (keyof Handlers)[]) source.addEventListener(event, handlers[event])
  source.addEventListener('open', () => Object.values(handlers).forEach((handler) => handler()))
  return () => source.close()
}
