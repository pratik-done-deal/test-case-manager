// Works out which pytest tests in ai-qa cover which test case. Nothing in ai-qa declares it, so it is
// read from the suite's conventions:
// - the case id is in the test's name (test_stb_01_…, test_s6_01_…) or in brackets in its docstring
//   ("ADM-BYR-20 (STB-01): …");
// - the docstring also names the case's requirement ids (ADM-BYR-20);
// - a test file may name its spec ("Spec: specs/modules/buyer/buyer-cue-card/test-cases.md");
// - the tests of specs/modules/<role>/<a-b>/<c> are under test_cases/<role>_test_cases/<a_b>/<c>.
// Case ids like S1-01 repeat across modules, so the candidates with the test's case id are narrowed by
// those signals, strongest first, and a test is only matched when exactly one case is left.

// One test as the plugin collected it.
export type CollectedTest = {
  nodeid: string;
  file: string;
  name: string;
  doc: string;
  moduleDoc: string;
  markers: string[];
};

export type CaseRef = {
  key: string; // the test case's database id
  code: string; // "S1-01"
  req: string[];
  kind: 'module' | 'feature';
  role: string;
  node: string; // its suite's node
  areas: string[]; // the review files that also show it
};

// Tests that change QA data or send real logins only run when the person running them agrees.
export const RISKY_MARKERS = ['destructive', 'live_login'];

const NAME = /^test_([a-z]+\d*)_(\d+[a-z]?)(?=_|$)/;
const ID = /(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+[a-z]?(?![\w-])/g;
const SPEC = /specs\/(modules|features)\/([^/\s]+)\/([\w./-]+?)\.md/g;

const KIND = { modules: 'module', features: 'feature' } as const;

const snake = (value: string) => value.replace(/-/g, '_');

const levelKey = (kind: string, role: string, node: string) => `${kind}\u0000${role}\u0000${node}`;

// The case ids a test names, and the other ids (requirements) in its docstring's first line.
function idsOf(test: CollectedTest, knownCodes: Set<string>) {
  const first = test.doc.split('\n')[0] ?? '';
  const named = NAME.exec(test.name);
  const codes = named
    ? [`${named[1].toUpperCase()}-${named[2]}`]
    : [...first.matchAll(/\(([^)]*)\)/g)].flatMap(([, inside]) => inside.match(ID) ?? []).filter((id) => knownCodes.has(id));
  const req = (first.match(ID) ?? []).filter((id) => !codes.includes(id));
  return { codes, req: new Set(req) };
}

// The specs a test file names: "…/<node>/test-cases.md" is the node, any other "…/<node>/<area>.md" the area.
function specsOf(test: CollectedTest) {
  const levels = new Set<string>();
  for (const [, kind, role, rest] of test.moduleDoc.matchAll(SPEC)) {
    const node = rest.endsWith('/test-cases') ? rest.slice(0, -'/test-cases'.length) : rest;
    levels.add(levelKey(KIND[kind as keyof typeof KIND], role, node));
  }
  return levels;
}

// The test's folder and each folder above it, nearest first, down to test_cases/<role>_test_cases/<x>.
function foldersOf(test: CollectedTest) {
  const parts = test.file.split('/').slice(0, -1);
  const folders: string[] = [];
  for (let depth = parts.length; depth >= 3; depth--) folders.push(parts.slice(0, depth).join('/'));
  return folders;
}

// { <test case id>: node ids of its tests }
export function matchTests(tests: CollectedTest[], cases: CaseRef[]): Map<string, string[]> {
  const byCode = new Map<string, CaseRef[]>();
  for (const testCase of cases) byCode.set(testCase.code, [...(byCode.get(testCase.code) ?? []), testCase]);
  const knownCodes = new Set(byCode.keys());
  const nodesOf = (testCase: CaseRef) => [testCase.node, ...testCase.areas];

  const matched = new Map<string, string[]>();
  for (const test of tests) {
    const { codes, req } = idsOf(test, knownCodes);
    const specs = specsOf(test);
    const folders = foldersOf(test);
    const narrowings: ((candidates: CaseRef[]) => CaseRef[])[] = [
      (candidates) => candidates.filter((c) => nodesOf(c).some((node) => specs.has(levelKey(c.kind, c.role, node)))),
      (candidates) => candidates.filter((c) => c.req.some((id) => req.has(id))),
      (candidates) => {
        for (const folder of folders) {
          const near = candidates.filter((c) =>
            nodesOf(c).some((node) => folder === `test_cases/${c.role}_test_cases/${snake(node)}`),
          );
          if (near.length) return near;
        }
        return [];
      },
    ];
    for (const code of codes) {
      let candidates = byCode.get(code) ?? [];
      for (const narrow of narrowings) {
        if (candidates.length <= 1) break;
        const narrowed = narrow(candidates);
        if (narrowed.length) candidates = narrowed;
      }
      if (candidates.length !== 1) continue;
      const [only] = candidates;
      matched.set(only.key, [...(matched.get(only.key) ?? []), test.nodeid]);
    }
  }
  return matched;
}
