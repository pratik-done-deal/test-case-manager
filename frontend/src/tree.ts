// Everything about where a test case shows up. Pages are addressed by a path that starts with its
// root: a role folder ("admin/admin-sellers/seller-workspace/notes") or "features" ("features/seller-qa").
import type { Catalog, Scenario, Suite, TestCase } from './types'

export type GroupKey = 'admin' | 'seller' | 'buyer' | 'biz_user' | 'features'

export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'admin', label: 'Admin' },
  { key: 'seller', label: 'Seller' },
  { key: 'buyer', label: 'Buyer' },
  { key: 'biz_user', label: 'Biz User' },
  { key: 'features', label: 'Features' },
]

const ROLE_GROUPS: GroupKey[] = ['admin', 'seller', 'buyer']

export type Page = { group: GroupKey; path: string }

export type Section = { suite: Suite; scenarios: { scenario: Scenario; cases: TestCase[] }[] }

// keys: the test cases the node's page shows.
export type TreeNode = { path: string; name: string; keys: string[]; pending: boolean; children: TreeNode[] }

export const within = (path: string, ancestor: string) => path === ancestor || path.startsWith(`${ancestor}/`)

const rootOf = (suite: Suite) => (suite.kind === 'feature' ? 'features' : suite.role)

export const suitePath = (suite: Suite) => `${rootOf(suite)}/${suite.node}`

export const groupLabel = (group: GroupKey) => GROUPS.find(({ key }) => key === group)!.label

// "#/admin/admin-deals" · "#/features/seller-qa" · "#/biz_user/admin/admin-leads/lead-profile/tags"
export function pageHash({ group, path }: Page) {
  const shown = ROLE_GROUPS.includes(group) || group === 'features' ? path.slice(path.indexOf('/') + 1) : path
  return `#/${group}/${shown}`
}

export function parseHash(hash: string): Page | null {
  const match = hash.match(/^#\/([a-z_]+)\/(.+)$/)
  if (!match || !GROUPS.some(({ key }) => key === match[1])) return null
  const group = match[1] as GroupKey
  const path = ROLE_GROUPS.includes(group) ? `${group}/${match[2]}` : group === 'features' ? `features/${match[2]}` : match[2]
  return { group, path }
}

// The test cases a page shows, grouped by the file that holds them.
export function pageSections(catalog: Catalog, { group, path }: Page): Section[] {
  const feature = group === 'features' ? path.split('/')[1] : null
  const sections: Section[] = []
  for (const suite of catalog.suites) {
    const whole = within(suitePath(suite), path)
    const partial = !whole && within(path, suitePath(suite))
    if (!feature && !whole && !partial) continue
    const scenarios = suite.scenarios
      .map((scenario) => ({
        scenario,
        cases: scenario.cases.filter((testCase) => {
          if (group === 'biz_user' && !scenario.bizUser) return false
          if (feature) return testCase.feature === feature
          return whole || testCase.areas.some((area) => within(`${rootOf(suite)}/${area}`, path))
        }),
      }))
      .filter(({ cases }) => cases.length)
    if (scenarios.length) sections.push({ suite, scenarios })
  }
  return sections
}

export const sectionCases = (sections: Section[]) =>
  sections.flatMap(({ scenarios }) => scenarios.flatMap(({ cases }) => cases))

// The sidebar's tree for one group. Role groups hold the modules in that role folder; Biz User holds
// every module or feature with a scenario whose Role names biz_user; Features lists every feature.
export function buildTree(catalog: Catalog, group: GroupKey): TreeNode[] {
  const keysAt = (path: string) => sectionCases(pageSections(catalog, { group, path })).map((testCase) => testCase.key)

  if (group === 'features') {
    return catalog.folders
      .filter((folder) => folder.kind === 'feature')
      .map((folder) => {
        const path = `features/${folder.path}`
        return { path, name: folder.name, keys: keysAt(path), pending: folder.status !== 'shipped', children: [] }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  // Every place a test case can be shown: the files that hold them and the review files that show them.
  const paths = new Set<string>()
  for (const suite of catalog.suites) {
    if (group !== 'biz_user' && (suite.kind !== 'module' || suite.role !== group)) continue
    for (const scenario of suite.scenarios) {
      if (group === 'biz_user' && !scenario.bizUser) continue
      paths.add(suitePath(suite))
      for (const testCase of scenario.cases) {
        for (const area of testCase.areas) paths.add(`${rootOf(suite)}/${area}`)
      }
    }
  }
  // Below the role (or "features") folder, every level of every path is a node.
  const all = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let depth = 2; depth <= parts.length; depth++) all.add(parts.slice(0, depth).join('/'))
  }

  const make = (path: string): TreeNode => ({
    path,
    name: nodeName(catalog, path),
    keys: keysAt(path),
    pending: false,
    children: [...all]
      .filter((other) => other.startsWith(`${path}/`) && !other.slice(path.length + 1).includes('/'))
      .map(make)
      .filter((node) => node.keys.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })
  return [...all]
    .filter((path) => path.split('/').length === 2)
    .map(make)
    .filter((node) => node.keys.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// A folder's name from its module.yml / feature.yml, else from the file there, else from the folder.
export function nodeName(catalog: Catalog, path: string) {
  const [root, ...rest] = path.split('/')
  const sub = rest.join('/')
  const folder = catalog.folders.find((candidate) =>
    root === 'features'
      ? candidate.kind === 'feature' && candidate.path === sub
      : candidate.kind === 'module' && candidate.role === root && candidate.path === sub,
  )
  if (folder) return folder.name
  const suite = catalog.suites.find((candidate) => suitePath(candidate) === path)
  if (suite) return capitalize(suite.title.replace(/^.*?\s+[—–-]\s+/, ''))
  return capitalize(rest[rest.length - 1].replace(/[-_]+/g, ' '))
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// The pages above this one, for the breadcrumb.
export function ancestors({ group, path }: Page): Page[] {
  const parts = path.split('/')
  const first = group === 'features' ? parts.length : 2
  const pages: Page[] = []
  for (let depth = first; depth < parts.length; depth++) pages.push({ group, path: parts.slice(0, depth).join('/') })
  return pages
}

// "Buyer Deals (My Deals, deal detail and deal link)" → name "Buyer Deals", about "My Deals, deal detail…"
export function splitTitle(title: string) {
  const match = title.match(/^(.*?)\s*\((.+)\)\s*$/)
  return match ? { name: match[1], about: match[2] } : { name: title, about: '' }
}
