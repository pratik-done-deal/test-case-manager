import { RunGroupButton, type Runner } from './Runs'
import { GROUPS, pageHash, within, type GroupKey, type Page, type TreeNode } from './tree'
import type { Results, TestCase } from './types'

type Props = {
  trees: Record<GroupKey, TreeNode[]>
  page: Page | undefined
  results: Results
  runner: Runner
  groupCases: Record<GroupKey, TestCase[]> // every test case under each heading
  reportsOpen: boolean
}

// Features hold cases that are in the role groups already, so only a role has "Run all".
const RUNNABLE: GroupKey[] = ['admin', 'seller', 'buyer', 'biz_user']

export function Sidebar({ trees, page, results, runner, groupCases, reportsOpen }: Props) {
  return (
    <nav className="sidebar" aria-label="Roles, modules and features">
      <h1>Test Manager</h1>
      <a className="sidebar-reports" href="#/reports" aria-current={reportsOpen ? 'page' : undefined}>
        Reports
      </a>
      {GROUPS.map(({ key, label }) => (
        <section key={key}>
          <h2>
            {label}
            {RUNNABLE.includes(key) && groupCases[key].length > 0 && (
              <RunGroupButton
                runner={runner}
                label={`All ${label} test cases`}
                cases={groupCases[key]}
                scope={{ kind: 'role', key: `role:${key}`, name: `All ${label} test cases` }}
                text="Run all"
              />
            )}
          </h2>
          {trees[key].length === 0 && <p className="sidebar-empty">No test cases yet</p>}
          <NodeList group={key} nodes={trees[key]} page={page} results={results} />
        </section>
      ))}
    </nav>
  )
}

type ListProps = { group: GroupKey; nodes: TreeNode[]; page: Page | undefined; results: Results }

// A node's areas are listed while the page on screen is that node or inside it.
function NodeList({ group, nodes, page, results }: ListProps) {
  return (
    <ul>
      {nodes.map((node) => {
        const target = { group, path: node.path }
        const current = page?.group === group && page.path === node.path
        const open = page?.group === group && within(page.path, node.path)
        const done = node.keys.filter((key) => results[key]).length
        return (
          <li key={node.path}>
            <a href={pageHash(target)} aria-current={current ? 'page' : undefined} className={open ? 'open' : undefined}>
              <span>
                {node.name}
                {node.pending && <span className="sidebar-tag">pending</span>}
              </span>
              <span className="sidebar-count">{done ? `${done}/${node.keys.length}` : node.keys.length}</span>
            </a>
            {open && node.children.length > 0 && (
              <NodeList group={group} nodes={node.children} page={page} results={results} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
