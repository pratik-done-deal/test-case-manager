import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCatalogText, fetchResults, putResult, subscribe } from './api'
import { Sidebar } from './Sidebar'
import { PageView } from './PageView'
import { HistoryView, parseReportsHash, ReportView } from './Reports'
import { RunBar, useRunner } from './Runs'
import { Sessions, useLogins } from './Sessions'
import { buildTree, GROUPS, pageHash, parseHash, type GroupKey, type Page, type TreeNode } from './tree'
import type { Catalog, Result, Results, TestCase } from './types'

const POLL_MS = 30_000

type Extra = { automation: () => void; runs: () => void; logins: () => void }

// Loads the test cases and results, then keeps them current: the backend announces every change,
// with a timer and a reload on returning to the tab as the fallback. `extra` is refreshed the same way.
function useData(extra: Extra) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [results, setResults] = useState<Results>({})
  const [error, setError] = useState<string | null>(null)
  const lastText = useRef('')

  useEffect(() => {
    let cancelled = false
    const attempt = async (load: () => Promise<void>) => {
      try {
        await load()
        if (!cancelled) setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    const refreshCatalog = () =>
      attempt(async () => {
        const text = await fetchCatalogText()
        if (cancelled || text === lastText.current) return
        lastText.current = text
        setCatalog(JSON.parse(text))
      })
    const refreshResults = () =>
      attempt(async () => {
        const latest = await fetchResults()
        if (!cancelled) setResults(latest)
      })
    const refresh = () => {
      refreshCatalog()
      refreshResults()
      extra.automation()
      extra.runs()
      extra.logins()
    }
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    const unsubscribe = subscribe({ catalog: refreshCatalog, results: refreshResults, ...extra })
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    }
  }, [])

  // Shown at once, then saved; if the save fails the server's results are put back.
  const setResult = async (key: string, result: Result | null) => {
    setResults((previous) => {
      const next = { ...previous }
      if (result) next[key] = result
      else delete next[key]
      return next
    })
    try {
      await putResult(key, result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      fetchResults().then(setResults, () => undefined)
    }
  }

  return { catalog, results, error, setResult }
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const [runError, setRunError] = useState<string | null>(null)
  const { runner, dialog, refreshAutomation, refreshRun } = useRunner(setRunError)
  const { logins, setLogins, refresh: refreshLogins } = useLogins()
  const { catalog, results, error, setResult } = useData({
    automation: refreshAutomation,
    runs: refreshRun,
    logins: refreshLogins,
  })
  const hash = useHash()

  const trees = useMemo(() => {
    const built = {} as Record<GroupKey, TreeNode[]>
    for (const { key } of GROUPS) built[key] = catalog ? buildTree(catalog, key) : []
    return built
  }, [catalog])

  // Every test case under each sidebar heading, for its "Run all".
  const groupCases = useMemo(() => {
    const byKey = new Map<string, TestCase>()
    for (const suite of catalog?.suites ?? [])
      for (const scenario of suite.scenarios) for (const testCase of scenario.cases) byKey.set(testCase.key, testCase)
    const cases = {} as Record<GroupKey, TestCase[]>
    for (const { key } of GROUPS) {
      const keys = new Set(trees[key].flatMap((node) => node.keys))
      cases[key] = [...keys].map((k) => byKey.get(k)).filter((c): c is TestCase => Boolean(c))
    }
    return cases
  }, [catalog, trees])

  // The page in the address if it still exists, else the first one in the sidebar.
  const exists = (page: Page) => {
    const find = (nodes: TreeNode[]): boolean => nodes.some((node) => node.path === page.path || find(node.children))
    return find(trees[page.group])
  }
  // #/reports…: a report or the list of them, not a page of test cases.
  const reports = parseReportsHash(hash)
  const asked = parseHash(hash)
  const firstGroup = GROUPS.find(({ key }) => trees[key].length)?.key
  const page: Page | undefined =
    asked && exists(asked) ? asked : firstGroup ? { group: firstGroup, path: trees[firstGroup][0].path } : undefined
  const pageKey = page ? pageHash(page) : ''

  // Pin the address to the page on screen, so the list changing under it doesn't switch pages.
  useEffect(() => {
    if (catalog && !reports && pageKey && pageKey !== hash) window.location.replace(pageKey)
  }, [catalog, reports, pageKey, hash])

  if (!catalog) {
    return <div className="center">{error ?? 'Loading test cases…'}</div>
  }

  return (
    <div className="app">
      <Sidebar
        trees={trees}
        page={reports ? undefined : page}
        results={results}
        runner={runner}
        groupCases={groupCases}
        reportsOpen={Boolean(reports)}
      />
      <main>
        <Sessions logins={logins} onChange={setLogins} onError={setRunError} />
        {error && <p className="notice">Could not reach the server: {error}. What you see may be out of date.</p>}
        {runError && (
          <p className="notice">
            {runError}{' '}
            <button className="text-button" onClick={() => setRunError(null)}>
              Dismiss
            </button>
          </p>
        )}
        {reports ? (
          'id' in reports ? (
            <ReportView id={reports.id} live={runner.run} />
          ) : (
            <HistoryView scope={reports.scope} live={runner.run} />
          )
        ) : page ? (
          <PageView
            key={pageKey}
            catalog={catalog}
            page={page}
            bizTree={trees.biz_user}
            results={results}
            onResult={setResult}
            runner={runner}
          />
        ) : (
          <div className="center">No test cases yet.</div>
        )}
        <RunBar runner={runner} />
        {dialog}
      </main>
    </div>
  )
}
