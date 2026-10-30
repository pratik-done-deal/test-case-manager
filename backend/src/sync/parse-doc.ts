// Reads one markdown file of test cases. Three layouts are in use in ai-qa's specs and all come out
// the same shape:
//   - the pipeline's test-cases.md: "## 3." holds "### S1 — …" scenario blocks, each with a TC table;
//   - a split review file: the same "### S1 — …" blocks copied out of a bigger file, no numbered sections;
//   - a tab file: a "## Scenario" table (ids like VFY-S1) and a "## Test cases" table (ids like VFY-01).
// The markdown stays where test cases are written; this only reads it.

export type ParsedCase = {
  code: string; // "S1-01", "VFY-01"
  title: string;
  given: string | null;
  steps: string[];
  expected: string;
  priority: string;
  type: string;
  req: string[];
  runAs: string;
  detail: string | null;
};

export type ParsedScenario = {
  code: string; // "S1", "VFY-S1"
  title: string;
  role: string;
  precondition: string;
  path: string;
  feature: string | null; // from a "**Feature:** <slug> (pending)" line
  cases: ParsedCase[];
};

export type ParsedDoc = {
  title: string;
  status: string;
  coverage: string;
  intro: string;
  happyFlow: string;
  setup: string; // what section 3 says before its first scenario (the test data key)
  scenarios: ParsedScenario[];
};

const CASE_CODE = /^[A-Z][A-Z0-9]*-\d+$/;
const SCENARIO_CODE = /^(?:[A-Z][A-Z0-9]*-)?S\d+$/;
const SCENARIO_HEADING = /^### ((?:[A-Z][A-Z0-9]*-)?S\d+)\s+[—–-]\s+(.+)$/;
const CASE_HEADING = /^### ([A-Z][A-Z0-9]*-\d+)\b/;
const HEADER_LINES = /^(# |Status:|Slug:|Requirements covered:|Requirements:)/;

type Table = { header: string[]; rows: string[][] };

export function parseDoc(text: string, warnings: string[] = []): ParsedDoc {
  const lines = text.split(/\r?\n/);

  const title = (lines.find((line) => line.startsWith('# ')) ?? '# Test cases')
    .slice(2)
    .replace(/\s+[—–-]\s+test cases\s*$/i, '')
    .trim();
  const status = (text.match(/^Status:\s*([A-Z_]+)/m)?.[1] ?? 'UNKNOWN').trim();
  const coverage = (text.match(/^Requirements covered:\s*(.+)$/m)?.[1] ?? '').trim();

  const intro: string[] = [];
  const happyFlow: string[] = [];
  const setup: string[] = [];
  const details: Record<string, string[]> = {};
  const headed: (ParsedScenario & { cells: null })[] = [];
  const listed: (ParsedScenario & { cells: string })[] = [];
  const loose: ParsedCase[] = [];

  let section: string | null = null; // the current "## " heading
  let scenario: ParsedScenario | null = null; // the "### S…" block we are in
  let detail: string[] | null = null; // the "### S5-06" detail block we are in
  let table: Table | null = null;

  const closeTable = () => {
    if (!table) return;
    const { header, rows } = table;
    table = null;
    if (header[0] === 'TC') {
      for (const row of rows) {
        const parsed = toCase(header, row, warnings);
        if (!parsed) continue;
        if (scenario) scenario.cases.push(parsed);
        else loose.push(parsed);
      }
    } else if (header[0] === 'ID' && header.includes('scenario')) {
      for (const row of rows) {
        if (!SCENARIO_CODE.test(row[0])) continue;
        const cell = (name: string) => row[header.indexOf(name)] ?? '';
        listed.push({
          code: row[0],
          title: cell('scenario'),
          role: cell('role'),
          precondition: cell('preconditions') || cell('precondition'),
          path: cell('path'),
          feature: null,
          cases: [],
          cells: cell('test cases'),
        });
      }
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('|')) {
      if (!scenario && !detail && section && /^3\.\s/.test(section)) setup.push(line);
      const cells = splitRow(line);
      if (!table) table = { header: cells.map((cell, i) => (i === 0 ? cell : cell.toLowerCase())), rows: [] };
      else if (!/^:?-+:?$/.test(cells[0])) table.rows.push(cells);
      continue;
    }
    closeTable();

    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      scenario = null;
      detail = null;
      continue;
    }
    const scenarioHeading = line.match(SCENARIO_HEADING);
    if (scenarioHeading) {
      scenario = {
        code: scenarioHeading[1],
        title: scenarioHeading[2].trim(),
        role: '',
        precondition: '',
        path: '',
        feature: null,
        cases: [],
      };
      headed.push({ ...scenario, cells: null });
      scenario = headed[headed.length - 1];
      detail = null;
      continue;
    }
    const caseHeading = line.match(CASE_HEADING);
    if (caseHeading) {
      scenario = null;
      detail = details[caseHeading[1]] = [];
      continue;
    }
    if (line.startsWith('### ')) {
      scenario = null;
      detail = null;
      continue;
    }

    if (detail) {
      detail.push(line);
    } else if (scenario) {
      const role = line.match(/\*\*Role:\*\*\s*(.+?)(?=\s+·\s+\*\*|$)/);
      if (role) scenario.role = role[1].trim();
      const precondition = line.match(/\*\*Precondition:\*\*\s*(.+?)(?=\s+·\s+\*\*|$)/);
      if (precondition) scenario.precondition = precondition[1].trim();
      const path = line.match(/\*\*Path:\*\*\s*(.+?)(?=\s+·\s+\*\*|$)/);
      if (path) scenario.path = path[1].trim();
      const feature = line.match(/\*\*Feature:\*\*\s*([a-z0-9][a-z0-9-]*)/);
      if (feature) scenario.feature = feature[1];
    } else if (section === null) {
      if (!HEADER_LINES.test(line)) intro.push(line);
    } else if (/^(2\.\s*)?the happy flow/i.test(section)) {
      happyFlow.push(line);
    } else if (/^3\.\s/.test(section)) {
      setup.push(line);
    }
  }
  closeTable();

  // Tab files list their scenarios in a table, so their cases have to be shared out.
  if (loose.length) {
    if (listed.length) assignListed(listed, loose);
    else {
      const prefix = loose[0].code.replace(/-\d+$/, '');
      headed.push({
        code: prefix,
        title: title.replace(/^.*?\s+[—–-]\s+/, ''),
        role: '',
        precondition: '',
        path: '',
        feature: null,
        cases: loose,
        cells: null,
      });
    }
  }

  const seen = new Set<string>();
  const scenarios: ParsedScenario[] = [...listed, ...headed]
    .map(({ cells: _cells, ...rest }) => ({
      ...rest,
      cases: rest.cases.filter((testCase) => {
        if (seen.has(testCase.code)) {
          warnings.push(`${testCase.code} appears more than once; only the first is kept`);
          return false;
        }
        seen.add(testCase.code);
        const body = details[testCase.code];
        if (body) testCase.detail = body.join('\n').trim() || null;
        return true;
      }),
    }))
    .filter((scenario) => scenario.cases.length);

  return {
    title,
    status,
    coverage,
    intro: intro.join('\n').trim(),
    happyFlow: happyFlow.join('\n').trim(),
    setup: setup.join('\n').trim(),
    scenarios,
  };
}

// A scenario row names its cases as "MNL-01 to MNL-08", "VFY-01, VFY-02" or just a count. Named ones
// go where they are named; the rest are dealt out in order by count, and any left over join the last.
function assignListed(listed: (ParsedScenario & { cells: string })[], loose: ParsedCase[]) {
  const byCode = new Map(loose.map((testCase) => [testCase.code, testCase]));
  const placed = new Set<ParsedCase>();
  for (const scenario of listed) {
    for (const code of namedCodes(scenario.cells)) {
      const testCase = byCode.get(code);
      if (testCase && !placed.has(testCase)) {
        scenario.cases.push(testCase);
        placed.add(testCase);
      }
    }
  }
  const rest = loose.filter((testCase) => !placed.has(testCase));
  for (const scenario of listed) {
    if (scenario.cases.length) continue;
    const count = Number(scenario.cells.match(/^\s*(\d+)\s*$/)?.[1] ?? 0);
    scenario.cases.push(...rest.splice(0, count));
  }
  listed[listed.length - 1].cases.push(...rest);
  for (const scenario of listed) {
    scenario.cases.sort((a, b) => loose.indexOf(a) - loose.indexOf(b));
  }
}

function namedCodes(cell: string): string[] {
  const codes: string[] = [];
  for (const range of cell.matchAll(/([A-Z][A-Z0-9]*)-(\d+)\s*(?:to|–|-)\s*(?:\1-)?(\d+)/g)) {
    const width = range[2].length;
    for (let n = Number(range[2]); n <= Number(range[3]); n++) codes.push(`${range[1]}-${String(n).padStart(width, '0')}`);
  }
  for (const single of cell.matchAll(/\b([A-Z][A-Z0-9]*-\d+)\b/g)) codes.push(single[1]);
  return codes;
}

function toCase(header: string[], row: string[], warnings: string[]): ParsedCase | null {
  const cell = (name: string) => row[header.indexOf(name)] ?? '';
  const code = row[0];
  if (!CASE_CODE.test(code)) return null;
  if (row.length !== header.length) warnings.push(`${code}: ${row.length} cells, the header has ${header.length}`);
  return {
    code,
    title: cell('title'),
    ...parseSteps(cell('steps')),
    expected: cell('expected result') || cell('expected'),
    priority: cell('pri') || cell('priority'),
    type: cell('type'),
    req: cell('req').split(/,\s*/).filter(Boolean),
    runAs: cell('run as'),
    detail: null,
  };
}

// A cell may hold an escaped pipe (\|); only an unescaped one ends the cell.
function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

// "Given <extra precondition>: 1. Do this → 2. Do that" → { given, steps }
function parseSteps(cell: string) {
  let rest = cell;
  let given: string | null = null;
  const lead = cell.match(/^Given\s+(.+?):\s*(?=1\.\s)/);
  if (lead) {
    given = lead[1].trim();
    rest = cell.slice(lead[0].length);
  }
  const steps = rest
    .split(/\s*(?:→|->)\s*(?=\d+\.\s)/)
    .map((step) => step.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  return { given, steps };
}

// The few fields the app needs from module.yml / feature.yml, without a YAML library.
export function parseYamlFields(text: string) {
  const field = (name: string) => {
    const value = text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1] ?? '';
    return value.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim() || null;
  };
  return { name: field('name'), status: field('status'), reqPrefix: field('req_prefix') };
}
