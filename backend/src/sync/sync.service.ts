import { Injectable } from '@nestjs/common';
import { posix } from 'node:path';
import { DataSource, EntityManager, In } from 'typeorm';
import { Folder, Scenario, Suite, TestCase } from '../catalog/entities';
import { EventsService } from '../events/events.service';
import { parseDoc, parseYamlFields, type ParsedCase, type ParsedDoc, type ParsedScenario } from './parse-doc';

export type SpecFile = { path: string; content: string };

export type SyncReport = {
  suites: number;
  copies: number;
  scenarios: number;
  cases: number;
  added: number;
  renumbered: number;
  restored: number;
  archived: number;
  warnings: string[];
};

type Kind = 'module' | 'feature';

type Doc = {
  kind: Kind;
  role: string;
  node: string;
  dir: string; // the folder the file is in, under the role folder
  source: string;
  isTestCases: boolean;
  parsed: ParsedDoc;
  keys: Set<string>;
};

// What the sync adds to a parsed case before storing it.
type CaseExtras = { areas: string[]; feature: string | null };

const PATH = /(?:^|\/)specs\/(modules|features)\/([^/]+)\/(.+)$/;

const caseKey = (testCase: ParsedCase) => `${testCase.code}\u0000${testCase.title}`;

const docCases = (doc: ParsedDoc) => doc.scenarios.flatMap((scenario) => scenario.cases);

const within = (dir: string, ancestor: string) => dir === ancestor || dir.startsWith(`${ancestor}/`);

const liveFirst = <T extends { archivedAt: Date | null }>(rows: T[]) =>
  [...rows].sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)));

// How an incoming test case is recognised as one already stored, strictest first. Matching on the
// title before the code is what keeps a case's id, and so its result, when the file is renumbered.
const SAME_CASE: ((row: TestCase, incoming: ParsedCase) => boolean)[] = [
  (row, incoming) => row.code === incoming.code && row.title === incoming.title,
  (row, incoming) => row.title === incoming.title,
  (row, incoming) => row.code === incoming.code,
];

@Injectable()
export class SyncService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventsService,
  ) {}

  // Makes the database match the given files, which must be the complete set: a suite whose file is
  // not among them is archived. One direction only, files → database. Nothing is deleted: what
  // disappears is archived, and comes back with its results if it returns.
  sync(files: SpecFile[]): Promise<SyncReport> {
    const run = this.queue.then(() => this.run(files));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(files: SpecFile[]): Promise<SyncReport> {
    const report: SyncReport = {
      suites: 0,
      copies: 0,
      scenarios: 0,
      cases: 0,
      added: 0,
      renumbered: 0,
      restored: 0,
      archived: 0,
      warnings: [],
    };

    const docs: Doc[] = [];
    const folders = new Map<string, Folder>();
    for (const file of files) {
      const match = file.path.replace(/\\/g, '/').match(PATH);
      if (!match) {
        report.warnings.push(`${file.path}: not under specs/<modules|features>/<role>/, skipped`);
        continue;
      }
      const kind: Kind = match[1] === 'features' ? 'feature' : 'module';
      const [, , role, rest] = match;
      const name = posix.basename(rest);
      if (name === 'module.yml' || name === 'feature.yml') {
        const fields = parseYamlFields(file.content);
        const path = posix.dirname(rest);
        folders.set(`${kind}/${role}/${path}`, {
          kind,
          role,
          path,
          name: fields.name ?? humanize(posix.basename(path)),
          status: fields.status,
          reqPrefix: fields.reqPrefix,
        });
      } else if (name.endsWith('.md')) {
        const warnings: string[] = [];
        const source = `specs/${match[1]}/${role}/${rest}`;
        const parsed = parseDoc(file.content, warnings);
        report.warnings.push(...warnings.map((warning) => `${source}: ${warning}`));
        const isTestCases = name === 'test-cases.md';
        const node = isTestCases ? posix.dirname(rest) : rest.slice(0, -3);
        const keys = new Set(docCases(parsed).map(caseKey));
        if (keys.size) docs.push({ kind, role, node, dir: posix.dirname(rest), source, isTestCases, parsed, keys });
      }
    }

    const owners = this.resolveOwners(docs, report);
    const extras = this.caseExtras(docs, owners, [...folders.values()]);

    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const stored = await manager.find(Suite);
      const uploaded = new Set(docs.map((doc) => doc.source));
      const kept = new Set<Suite>();
      for (const doc of docs.filter((doc) => owners.get(doc) === doc)) {
        const slug = posix.basename(doc.node);
        const moved = stored.filter(
          (row) => !kept.has(row) && !uploaded.has(row.source) && row.kind === doc.kind && row.slug === slug,
        );
        const suite =
          stored.find((row) => row.source === doc.source) ??
          (moved.length === 1 ? moved[0] : undefined) ??
          manager.create(Suite);
        Object.assign(suite, {
          kind: doc.kind,
          role: doc.role,
          node: doc.node,
          slug,
          source: doc.source,
          title: doc.parsed.title,
          status: doc.parsed.status,
          coverage: doc.parsed.coverage,
          intro: doc.parsed.intro,
          happyFlow: doc.parsed.happyFlow,
          setup: doc.parsed.setup,
          archivedAt: null,
        });
        await manager.save(suite);
        kept.add(suite);
        await this.syncSuite(manager, suite, doc.parsed.scenarios, extras, now, report);
      }
      const gone = stored.filter((row) => !kept.has(row) && !row.archivedAt);
      for (const suite of gone) suite.archivedAt = now;
      await manager.save(gone);

      await manager.clear(Folder);
      await manager.save(Folder, [...folders.values()]);
      report.suites = kept.size;
    });

    this.events.emit('catalog');
    return report;
  }

  // A file whose every case (same id, same title) is in a file in its own folder or one above is a
  // review copy of it. Copies are not stored; they only say which area their cases belong to.
  // Each file's owner is the file that really holds its cases (itself, for a file that is not a copy).
  private resolveOwners(docs: Doc[], report: SyncReport) {
    // Copies only point to a file that ranks higher, so a chain of copies always ends.
    const rank = (doc: Doc) => [-doc.keys.size, doc.dir.split('/').length, doc.isTestCases ? 0 : 1];
    const outranks = (a: Doc, b: Doc) => {
      const [x, y] = [rank(a), rank(b)];
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
      return a.source < b.source;
    };
    const copyOf = new Map<Doc, Doc>();
    for (const doc of docs) {
      const holders = docs.filter(
        (other) =>
          other !== doc &&
          other.kind === doc.kind &&
          other.role === doc.role &&
          within(doc.dir, other.dir) &&
          outranks(other, doc) &&
          [...doc.keys].every((key) => other.keys.has(key)),
      );
      // The nearest holder: the deepest folder.
      holders.sort((a, b) => b.dir.length - a.dir.length);
      if (holders.length) copyOf.set(doc, holders[0]);
    }
    const owners = new Map<Doc, Doc>();
    for (const doc of docs) {
      let owner = doc;
      while (copyOf.has(owner)) owner = copyOf.get(owner)!;
      owners.set(doc, owner);
    }
    report.copies = copyOf.size;
    return owners;
  }

  private caseExtras(docs: Doc[], owners: Map<Doc, Doc>, folders: Folder[]) {
    const extras = new Map<ParsedCase, CaseExtras>();
    const byKey = new Map<Doc, Map<string, ParsedCase>>();
    for (const doc of docs) {
      if (owners.get(doc) !== doc) continue;
      byKey.set(doc, new Map(docCases(doc.parsed).map((testCase) => [caseKey(testCase), testCase])));
      for (const scenario of doc.parsed.scenarios) {
        for (const testCase of scenario.cases) {
          extras.set(testCase, { areas: [], feature: this.featureOf(doc, scenario, testCase, folders) });
        }
      }
    }
    for (const doc of docs) {
      const owner = owners.get(doc)!;
      if (owner === doc) continue;
      for (const key of doc.keys) {
        const testCase = byKey.get(owner)!.get(key);
        if (testCase) extras.get(testCase)!.areas.push(doc.node);
      }
    }
    return extras;
  }

  private featureOf(doc: Doc, scenario: ParsedScenario, testCase: ParsedCase, folders: Folder[]) {
    if (doc.kind === 'feature') return doc.node.split('/')[0];
    if (scenario.feature) return scenario.feature;
    const feature = folders.find(
      (folder) =>
        folder.kind === 'feature' &&
        folder.reqPrefix &&
        testCase.req.some((req) => req.startsWith(`${folder.reqPrefix}-`)),
    );
    return feature?.path ?? null;
  }

  private async syncSuite(
    manager: EntityManager,
    suite: Suite,
    incoming: ParsedScenario[],
    extras: Map<ParsedCase, CaseExtras>,
    now: Date,
    report: SyncReport,
  ) {
    const storedScenarios = await manager.find(Scenario, { where: { suiteId: suite.id } });
    const storedCases = storedScenarios.length
      ? await manager.find(TestCase, { where: { scenarioId: In(storedScenarios.map((row) => row.id)) } })
      : [];

    // Scenarios are matched by their code alone: nothing else refers to a scenario's id.
    const byCode = new Map<string, Scenario>();
    for (const row of liveFirst(storedScenarios)) if (!byCode.has(row.code)) byCode.set(row.code, row);
    const scenarios = incoming.map((scenario, position) => {
      const row = byCode.get(scenario.code) ?? manager.create(Scenario, { suiteId: suite.id, code: scenario.code });
      Object.assign(row, {
        title: scenario.title,
        role: scenario.role,
        roleKey: suite.role,
        bizUser: /\bbiz[ _]?users?\b/i.test(scenario.role),
        feature: scenario.feature,
        precondition: scenario.precondition,
        path: scenario.path,
        position,
        archivedAt: null,
      });
      return row;
    });
    for (const row of storedScenarios) {
      if (!scenarios.includes(row) && !row.archivedAt) row.archivedAt = now;
    }
    await manager.save([...new Set([...scenarios, ...storedScenarios])]);

    const items = incoming.flatMap((scenario, index) =>
      scenario.cases.map((testCase, position) => ({ testCase, position, scenarioId: scenarios[index].id })),
    );
    const pool = liveFirst(storedCases);
    const matched = new Map<ParsedCase, TestCase>();
    for (const same of SAME_CASE) {
      for (const { testCase } of items) {
        if (matched.has(testCase)) continue;
        const at = pool.findIndex((row) => same(row, testCase));
        if (at >= 0) matched.set(testCase, pool.splice(at, 1)[0]);
      }
    }

    const cases = items.map(({ testCase, position, scenarioId }) => {
      const row = matched.get(testCase) ?? manager.create(TestCase);
      if (!row.id) report.added++;
      else if (row.archivedAt) report.restored++;
      else if (row.code !== testCase.code) report.renumbered++;
      Object.assign(row, { ...testCase, ...extras.get(testCase), scenarioId, position, archivedAt: null });
      return row;
    });
    const dropped = pool.filter((row) => !row.archivedAt);
    for (const row of dropped) row.archivedAt = now;
    await manager.save([...cases, ...dropped]);

    report.scenarios += scenarios.length;
    report.cases += cases.length;
    report.archived += dropped.length;
  }
}

function humanize(name: string) {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
