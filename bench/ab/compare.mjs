// One table across wesh versions: node bench/ab/compare.mjs [--out file.md]
// Each benchmark lists its result files per version; the no-wesh rows of every file are pooled as the baseline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results');
const BENCH = [
  { name: 'Small repo (60 files), single tasks', kind: 'single', files: { v1: 'ab-runs-claude-claude-sonnet-5-5.jsonl', v2: 'ab-runs-claude-sonnet-v2.jsonl', caveman: 'ab-runs-claude-sonnet-caveman-final.jsonl' } },
  { name: 'Small repo (60 files), long session (8 tasks)', kind: 'chain', files: { v1: 'ab-chain-claude-claude-sonnet-5-5.jsonl', v2: 'ab-chain-claude-sonnet-v2.jsonl', v3: 'ab-chain-claude-sonnet-v3.jsonl', caveman: 'ab-chain-claude-sonnet-caveman-final.jsonl' } },
];
const load = f => (fs.existsSync(path.join(R, f)) ? fs.readFileSync(path.join(R, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const full = h => h && h.total > 0 && h.pass === h.total;
const solvedRun = (r, kind) => (kind === 'chain' ? Object.values(r.final).filter(full).length : (full(r.hidden) && r.visible.ok ? 1 : 0));
const tasksOf = (r, kind) => (kind === 'chain' ? Object.keys(r.final).length : 1);
const pct = (a, b) => (Number.isFinite(a) && b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '');

let md = '# wesh versions compared (Claude Code, Sonnet 5.5, real runs)\n\nCost and time are means per run (single tasks) or per session (long sessions); % is against the pooled no-wesh baseline of the same benchmark. Solved = tasks with every hidden check and the full suite passing. n = runs or sessions behind each cell.\n';
for (const b of BENCH) {
  const rows = Object.entries(b.files).flatMap(([v, f]) => load(f).map(r => ({ ...r, v })));
  const base = rows.filter(r => r.arm === 'none');
  const cells = [['no wesh', base]];
  for (const v of Object.keys(b.files)) for (const [arm, label] of [['wesh', ''], ['wesh-cg', ' + codegraph']]) {
    const l = rows.filter(r => r.v === v && r.arm === arm);
    if (l.length) cells.push([`${v}${label}`, l]);
  }
  const bc = mean(base.map(r => r.costUsd)), bt = mean(base.map(r => r.wallMs));
  md += `\n## ${b.name}\n\n| version | n | cost | vs no wesh | time | vs no wesh | steps | solved | code lines | test lines |\n|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|\n`;
  for (const [label, l] of cells) {
    const c = mean(l.map(r => r.costUsd)), t = mean(l.map(r => r.wallMs));
    const solved = l.reduce((a, r) => a + solvedRun(r, b.kind), 0), total = l.reduce((a, r) => a + tasksOf(r, b.kind), 0);
    md += `| ${label} | ${l.length} | $${c.toFixed(3)} | ${label === 'no wesh' ? '' : pct(c, bc)} | ${(t / 1000).toFixed(0)} s | ${label === 'no wesh' ? '' : pct(t, bt)} | ${mean(l.map(r => r.steps ?? r.turns)).toFixed(1)} | ${solved}/${total} | ${mean(l.map(r => r.diff.codeAdded + r.diff.codeRemoved)).toFixed(1)} | ${mean(l.map(r => r.diff.testAdded)).toFixed(1)} |\n`;
  }
}
const out = process.argv.indexOf('--out') > 0 ? process.argv[process.argv.indexOf('--out') + 1] : path.join(R, 'ab-versions.md');
fs.writeFileSync(out, md);
console.log(md);
