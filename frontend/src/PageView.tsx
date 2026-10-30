import { useMemo, useState } from 'react'
import { Block, Inline } from './Markdown'
import { ProgressBar } from './ProgressBar'
import { CaseRunCell, ModeToggle, RunGroupButton, type Runner } from './Runs'
import { tally } from './tally'
import {
  ancestors,
  groupLabel,
  nodeName,
  pageHash,
  pageSections,
  sectionCases,
  splitTitle,
  suitePath,
  within,
  type Page,
  type Section,
  type TreeNode,
} from './tree'
import type { Catalog, Folder, Result, Results, Scenario, Suite, TestCase } from './types'

type OnResult = (key: string, result: Result | null) => void

const unique = (values: string[]) => [...new Set(values)].sort()

type Props = {
  catalog: Catalog
  page: Page
  bizTree: TreeNode[]
  results: Results
  onResult: OnResult
  runner: Runner
}

export function PageView({ catalog, page, bizTree, results, onResult, runner }: Props) {
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState('')
  const [runAs, setRunAs] = useState('')
  const [result, setResult] = useState('')
  const [showSteps, setShowSteps] = useState(false)

  const sections = useMemo(() => pageSections(catalog, page), [catalog, page])
  const allCases = sectionCases(sections)
  const counts = tally(allCases, results)
  const features = new Map(
    catalog.folders.filter((folder) => folder.kind === 'feature').map((folder) => [folder.path, folder]),
  )
  const pageFeature = page.group === 'features' ? features.get(page.path.split('/')[1]) : undefined

  // The file this page is, or the one file it is an area of: its notes and test data apply here.
  const home = catalog.suites.find((suite) => suitePath(suite) === page.path)
  const container =
    home ?? (sections.length === 1 && within(page.path, suitePath(sections[0].suite)) ? sections[0].suite : undefined)
  const { name, about } = splitTitle(nodeName(catalog, page.path))
  const subtitle = about || (home ? splitTitle(home.title).about : '')

  const q = query.trim().toLowerCase()
  const filtering = Boolean(q || priority || runAs || result)
  const matches = (scenario: Scenario, testCase: TestCase) => {
    if (priority && testCase.priority !== priority) return false
    if (runAs && testCase.runAs !== runAs) return false
    if (result && (results[testCase.key] ?? 'none') !== result) return false
    if (!q) return true
    const text = [scenario.title, testCase.id, testCase.title, testCase.given ?? '', testCase.expected, ...testCase.steps, ...testCase.req]
    return text.some((value) => value.toLowerCase().includes(q))
  }
  const visible: Section[] = sections
    .map((section) => ({
      ...section,
      scenarios: section.scenarios
        .map(({ scenario, cases }) => ({ scenario, cases: cases.filter((testCase) => matches(scenario, testCase)) }))
        .filter(({ cases }) => cases.length),
    }))
    .filter(({ scenarios }) => scenarios.length)
  const shown = sectionCases(visible).length

  return (
    <article className="suite">
      <header className="suite-header">
        <p className="eyebrow">
          {groupLabel(page.group)}
          {ancestors(page).map((above) => (
            <span key={above.path}>
              {' › '}
              <a href={pageHash(above)}>{nodeName(catalog, above.path)}</a>
            </span>
          ))}
          {home && home.status !== 'APPROVED' && <span className="status">{home.status.replace(/_/g, ' ').toLowerCase()}</span>}
          {pageFeature && <span className="status">{pageFeature.status === 'shipped' ? 'shipped' : 'pending'}</span>}
        </p>
        <h2>{name}</h2>
        {subtitle && <p className="about">{subtitle}</p>}

        <div className="summary">
          <ProgressBar tally={counts} />
          <p>
            <span>
              {sections.reduce((n, section) => n + section.scenarios.length, 0)} scenarios · {counts.total} test cases
            </span>
            <span>
              <b className="pass">{counts.pass}</b> passed · <b className="fail">{counts.fail}</b> failed ·{' '}
              {counts.total - counts.pass - counts.fail} not run
            </span>
          </p>
        </div>

        <AlsoUnder page={page} sections={sections} bizTree={bizTree} catalog={catalog} />

        {home?.intro && (
          <details className="note">
            <summary>Read this first</summary>
            <Block text={home.intro.replace(/^\*\*Read this first\.\*\*\s*/, '')} />
          </details>
        )}
        {home?.happyFlow && (
          <details className="note">
            <summary>Happy flow</summary>
            <Block text={home.happyFlow} />
          </details>
        )}
        {container?.setup && (
          <details className="note">
            <summary>Test data</summary>
            <Block text={container.setup} />
          </details>
        )}
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search test cases"
          aria-label="Search test cases"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Filter label="Priority" value={priority} onChange={setPriority} options={unique(allCases.map((c) => c.priority).filter(Boolean))} />
        <Filter label="Run as" value={runAs} onChange={setRunAs} options={unique(allCases.map((c) => c.runAs).filter(Boolean))} />
        <Filter label="Result" value={result} onChange={setResult} options={['pass', 'fail', 'none']} labels={{ none: 'not run' }} />
        <button className="text-button" aria-pressed={showSteps} onClick={() => setShowSteps(!showSteps)}>
          {showSteps ? 'Hide steps' : 'Show steps'}
        </button>
        <ModeToggle runner={runner} />
        <RunGroupButton
          runner={runner}
          label={filtering ? `${name} (filtered)` : name}
          cases={sectionCases(visible)}
          scope={
            filtering
              ? { kind: 'filtered', key: `filtered:${pageHash(page)}`, name: `${name} (filtered)` }
              : { kind: 'page', key: `page:${pageHash(page)}`, name }
          }
        />
      </div>

      {filtering && (
        <p className="shown">
          {shown} of {allCases.length} test cases
        </p>
      )}
      {visible.map((section) => (
        <div key={section.suite.key} className="section">
          {(sections.length > 1 || page.group === 'features') && (
            <h3 className="section-title">
              {sectionLabel(catalog, page, section.suite)}
              {section.suite.status !== 'APPROVED' && (
                <span className="status">{section.suite.status.replace(/_/g, ' ').toLowerCase()}</span>
              )}
            </h3>
          )}
          {section.scenarios.map(({ scenario, cases }) => (
            <ScenarioSection
              key={scenario.id}
              suiteKey={section.suite.key}
              scenario={scenario}
              cases={cases}
              features={features}
              pageFeature={pageFeature?.path}
              results={results}
              onResult={onResult}
              showSteps={showSteps}
              runner={runner}
            />
          ))}
        </div>
      ))}
    </article>
  )
}

// A section's heading: where its file sits below this page, or, on a feature page, which module it is.
function sectionLabel(catalog: Catalog, page: Page, suite: Suite) {
  const path = suitePath(suite)
  if (path === page.path) return splitTitle(suite.title).name
  const parts = path.split('/')
  const from = within(path, page.path) ? page.path.split('/').length + 1 : 2
  const names = []
  for (let depth = from; depth <= parts.length; depth++) names.push(nodeName(catalog, parts.slice(0, depth).join('/')))
  return names.join(' › ') || nodeName(catalog, path)
}

function AlsoUnder({ page, sections, bizTree, catalog }: { page: Page; sections: Section[]; bizTree: TreeNode[]; catalog: Catalog }) {
  let other: Page | null = null
  if (page.group === 'biz_user') {
    const [root, slug] = page.path.split('/')
    other = root === 'features' ? { group: 'features', path: `features/${slug}` } : { group: root as Page['group'], path: page.path }
  } else if (page.group !== 'features' && sections.some(({ scenarios }) => scenarios.some(({ scenario }) => scenario.bizUser))) {
    const inBiz = (nodes: TreeNode[]): boolean => nodes.some((node) => node.path === page.path || inBiz(node.children))
    if (inBiz(bizTree)) other = { group: 'biz_user', path: page.path }
  }
  if (!other) return null
  return (
    <p className="also">
      Also under <a href={pageHash(other)}>{groupLabel(other.group)}</a>
      {other.group === 'features' && ` · ${nodeName(catalog, other.path)}`}
    </p>
  )
}

type FilterProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  labels?: Record<string, string>
}

function Filter({ label, value, onChange, options, labels = {} }: FilterProps) {
  return (
    <select
      className={value ? 'pill pill-on' : 'pill'}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option] ?? option}
        </option>
      ))}
    </select>
  )
}

function FeatureTag({ slug, features }: { slug: string; features: Map<string, Folder> }) {
  const feature = features.get(slug)
  const pending = feature?.status !== 'shipped'
  return (
    <span className={pending ? 'feature-tag pending' : 'feature-tag'} title={pending ? 'Not shipped yet' : undefined}>
      {feature?.name ?? slug}
      {pending && ' · pending'}
    </span>
  )
}

type ScenarioProps = {
  suiteKey: string
  scenario: Scenario
  cases: TestCase[]
  features: Map<string, Folder>
  pageFeature: string | undefined
  results: Results
  onResult: OnResult
  showSteps: boolean
  runner: Runner
}

function ScenarioSection({ suiteKey, scenario, cases, features, pageFeature, results, onResult, showSteps, runner }: ScenarioProps) {
  const [collapsed, setCollapsed] = useState(false)
  const counts = tally(cases, results)
  const tagged = scenario.feature && scenario.feature !== pageFeature ? scenario.feature : null

  return (
    <section className="scenario">
      <div className="scenario-top">
        <button className="scenario-head" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <span className="scenario-id">{scenario.id}</span>
          <span className="scenario-title">{scenario.title}</span>
          <span className="scenario-count">
            {counts.fail > 0 && <span className="fail">{counts.fail} failed</span>}
            {counts.pass + counts.fail}/{counts.total}
          </span>
        </button>
        <RunGroupButton
          runner={runner}
          label={`${scenario.id} ${scenario.title}`}
          cases={cases}
          scope={{ kind: 'scenario', key: `scenario:${suiteKey}/${scenario.id}`, name: `${scenario.id} ${scenario.title}` }}
        />
      </div>
      {!collapsed && (
        <>
          <dl className="scenario-meta">
            {tagged && (
              <div>
                <dt>Feature</dt>
                <dd>
                  <FeatureTag slug={tagged} features={features} />
                </dd>
              </div>
            )}
            {scenario.role && (
              <div>
                <dt>Role</dt>
                <dd>
                  <Inline text={scenario.role} />
                </dd>
              </div>
            )}
            {scenario.precondition && (
              <div>
                <dt>Needs</dt>
                <dd>
                  <Inline text={scenario.precondition} />
                </dd>
              </div>
            )}
            {scenario.path && (
              <div>
                <dt>Path</dt>
                <dd>
                  <Inline text={scenario.path} />
                </dd>
              </div>
            )}
          </dl>
          <ul className="cases">
            {cases.map((testCase) => (
              <CaseItem
                key={testCase.key}
                testCase={testCase}
                feature={testCase.feature && testCase.feature !== pageFeature && testCase.feature !== scenario.feature ? testCase.feature : null}
                features={features}
                result={results[testCase.key]}
                onResult={onResult}
                showSteps={showSteps}
                runner={runner}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

type CaseProps = {
  testCase: TestCase
  feature: string | null
  features: Map<string, Folder>
  result: Result | undefined
  onResult: OnResult
  showSteps: boolean
  runner: Runner
}

function CaseItem({ testCase, feature, features, result, onResult, showSteps, runner }: CaseProps) {
  const [opened, setOpened] = useState(false)
  const open = opened || showSteps
  const runState = runner.going ? runner.run?.cases[testCase.key] : undefined
  const inRun = runState === 'queued' || runState === 'running'
  // A case with an automated test gets its result from runs only. Only a case with none (a manual
  // check) is set by hand; until the app knows which is which, nothing can be changed.
  const byHand = runner.automation !== null && !runner.automation.cases[testCase.key]

  return (
    <li className="case">
      <div className="case-row">
        <span className="case-id">{testCase.id}</span>
        <button className="case-title" aria-expanded={open} onClick={() => setOpened(!opened)}>
          <Inline text={testCase.title} />
          {feature && <FeatureTag slug={feature} features={features} />}
        </button>
        <span className="case-tags">
          {testCase.runAs === 'manual' && <span>manual</span>}
          <span className={testCase.priority === 'P0' ? 'p0' : undefined}>{testCase.priority}</span>
        </span>
        <CaseRunCell runner={runner} testCase={testCase} />
        {byHand ? (
          <select
            className={`pill result result-${result ?? 'none'}`}
            aria-label={`Result for ${testCase.id}`}
            title="No automated test: set the result of the manual check"
            value={result ?? ''}
            onChange={(event) => onResult(testCase.key, (event.target.value || null) as Result | null)}
          >
            <option value="">Not run</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
        ) : (
          <span
            className={`result result-badge result-${result ?? 'none'}`}
            title={inRun ? 'Being run now' : 'Set by the last test run; run the test to change it'}
          >
            {result === 'pass' ? 'Pass' : result === 'fail' ? 'Fail' : 'Not run'}
          </span>
        )}
      </div>
      {open && (
        <div className="case-detail">
          <div>
            <h4>Steps</h4>
            {testCase.given && (
              <p className="given">
                Given <Inline text={testCase.given} />
              </p>
            )}
            <ol>
              {testCase.steps.map((step, i) => (
                <li key={i}>
                  <Inline text={step} />
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h4>Expected</h4>
            <p>
              <Inline text={testCase.expected} />
            </p>
          </div>
          {testCase.detail && (
            <div className="case-wide">
              <h4>Detail</h4>
              <Block text={testCase.detail} />
            </div>
          )}
          <p className="case-foot case-wide">
            {[testCase.type, testCase.runAs, testCase.req.join(', ')].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}
    </li>
  )
}
