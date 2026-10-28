// Stress test 9: what codegraph adds on top of wesh, for short, long and very long projects.
// node bench/codegraph-impact.mjs [--model claude-opus-5-5|claude-sonnet-5-5]
// Request-by-request session model with prompt caching. Exploration questions are where codegraph acts:
// - medium repo (~1.2k files): measured here, 8 real agent runs on 4 cross-file questions (bench/results/codegraph-ab.md)
// - small / large repos: scaled from codegraph's published benchmark (Gin, OkHttp ~110-650 files: about even;
//   VS Code, Excalidraw ~640-11k files: 28-43 tool calls without vs 2 with). Labelled estimates, not measurements.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { table } from './lib.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PRICES = { 'claude-opus-5-5': { in: 4, out: 20, read: 0.2 }, 'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2 } };
const mi = process.argv.indexOf('--model');
const MODEL = mi > 0 ? process.argv[mi + 1] : 'claude-opus-5-5';
const P = PRICES[MODEL];

const BASE = 5600 + 980;   // OpenCode 2.2 base prompt + wesh rules/skills (measured, stress test 8)
const CG_OVERHEAD = 570;   // codegraph tool definition 370 + wesh codegraph rule 198 (measured)
// Per exploration question: tool calls and context added, without (grep/read) and with codegraph.
const REPO = {
  small: { files: '~100-300', grep: { calls: 5, added: 8000 }, cg: { calls: 2, added: 8000 }, source: 'scaled from codegraph benchmark' },
  medium: { files: '~1-3k', grep: { calls: 8.75, added: 16300 }, cg: { calls: 3.5, added: 15400 }, source: 'measured (8 agent runs)' },
  large: { files: '~10k+', grep: { calls: 20, added: 35000 }, cg: { calls: 3, added: 15000 }, source: 'scaled from codegraph benchmark' },
};
// Projects: sessions x work requests, exploration questions per session (each new session re-orients from scratch).
const PROJECTS = [
  { name: 'short project', repo: 'small', sessions: 1, requests: 30, questions: 2, index: 'seconds' },
  { name: 'long project', repo: 'medium', sessions: 5, requests: 60, questions: 4, index: '~1 min' },
  { name: 'very long project', repo: 'large', sessions: 20, requests: 80, questions: 6, index: '~5-15 min, once' },
  { name: 'very long, half the exploration', repo: 'large', sessions: 20, requests: 80, questions: 3, index: '~5-15 min, once' },
];
const WORK = { input: 2000, out: 300 }; // per non-exploration request (after wesh squeeze)

function session(pr, withCg) {
  const r = REPO[pr.repo][withCg ? 'cg' : 'grep'];
  const reqs = [];
  const every = Math.floor(pr.requests / (pr.questions + 1));
  for (let i = 0; i < pr.requests; i++) {
    if (i && i % every === 0 && reqs.filter(x => x.q).length < Math.round(r.calls) * pr.questions) {
      const n = Math.round(r.calls);
      for (let k = 0; k < n; k++) reqs.push({ input: r.added / n, out: 150, q: true });
    }
    reqs.push({ input: WORK.input, out: WORK.out });
  }
  let prefix = BASE + (withCg ? CG_OVERHEAD : 0), cost = prefix * P.in * 1.25, calls = 0;
  for (const q of reqs) {
    cost += prefix * P.read + q.input * P.in * 1.25 + q.out * P.out;
    prefix += q.input + q.out;
    if (q.q) calls++;
  }
  return { cost: cost / 1e6, calls, requests: reqs.length, peak: prefix };
}

const rows = [['project', 'repo', 'sessions x requests', 'exploration calls: grep / codegraph', 'cost wesh', 'cost wesh + codegraph', 'codegraph adds', 'source']];
const out = [];
for (const pr of PROJECTS) {
  const a = session(pr, false), b = session(pr, true);
  const ca = a.cost * pr.sessions, cb = b.cost * pr.sessions, d = (cb / ca - 1) * 100;
  rows.push([pr.name, `${pr.repo} (${REPO[pr.repo].files} files)`, `${pr.sessions} x ${a.requests}`, `${a.calls * pr.sessions} / ${b.calls * pr.sessions}`,
    `$${ca.toFixed(2)}`, `$${cb.toFixed(2)}`, `${d > 0 ? '+' : ''}${d.toFixed(1)}%`, REPO[pr.repo].source]);
  out.push({ project: pr.name, wesh: ca, weshCodegraph: cb, delta: d });
}
const md = `# codegraph on top of wesh (${MODEL}, OpenCode 2.2 prompt sizes)\n\n${table(rows)}\n`;
console.log(md);
fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'results', `codegraph-impact-${MODEL}.md`), md);
fs.writeFileSync(path.join(DIR, 'results', `codegraph-impact-${MODEL}.json`), JSON.stringify(out, null, 2));
