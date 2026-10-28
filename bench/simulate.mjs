// Stress test 2: session cost model with prompt caching, across workload scenarios.
// Fixed overhead comes from results/static.json (run static.mjs first). Behavior multipliers are
// ponytail's measured agentic benchmark (Opus 5.5, 39 tasks x 5 runs) plus labelled assumptions.
// node bench/simulate.mjs [--model claude-opus-5-5|claude-sonnet-5-5]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { table } from './lib.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PRICES = { // $/MTok: input, output, cache read. Cache write (5 min) = 1.25 x input.
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01 },
};
const mi = process.argv.indexOf('--model');
const MODEL = mi > 0 ? process.argv[mi + 1] : 'claude-opus-5-5';
const P = PRICES[MODEL];
if (!P) throw new Error(`unknown model ${MODEL}`);

const stat = JSON.parse(fs.readFileSync(path.join(DIR, 'results', 'static.json'), 'utf8'));
const S = Object.fromEntries(stat.arms.map(a => [a.name, a]));
const SYSTEM = 20000; // host system prompt + tool schemas, same for every arm

// turns = model requests; input = new tool/user tokens per request; out = output tokens per request;
// loads = skill bodies loaded; explore = share of input that is broad code search (scout-able).
const SCENARIOS = [
  { name: 'quick Q&A', turns: 3, input: 800, out: 400, loads: 0, explore: 0 },
  { name: 'bug fix', turns: 25, input: 2500, out: 350, loads: 1, explore: 0.3 },
  { name: 'feature', turns: 60, input: 3000, out: 500, loads: 2, explore: 0.3 },
  { name: 'exploration-heavy', turns: 40, input: 5000, out: 300, loads: 1, explore: 0.6 },
  { name: 'long session (stress)', turns: 200, input: 3000, out: 450, loads: 5, explore: 0.3 },
];

// Multipliers vs no skill. turns/out: measured on ponytail 5 (-22% turns, -45% output tokens).
// tool: input per turn (wesh quiet-command + ranged-read rules: NOT measured, assumption).
// scout: share of scout-able exploration moved to a Haiku subagent (assumption).
const BEHAVIOR = {
  baseline: { turns: 1, out: 1, tool: 1, scout: 0 },
  all3: { turns: 0.78, out: 0.53, tool: 1, scout: 0.2 },
  wesh_low: { turns: 0.9, out: 0.8, tool: 1, scout: 0 },
  wesh_central: { turns: 0.78, out: 0.55, tool: 0.9, scout: 0.3 },
  wesh_high: { turns: 0.7, out: 0.5, tool: 0.75, scout: 0.5 },
};
// Squeeze: assume 25% of new input is long build/test/install output, cut 65%
// (real npm install -80%, real vitest -53%; synthetic fixtures -93%; type errors and listings untouched).
BEHAVIOR.wesh_squeeze = { ...BEHAVIOR.wesh_central, tool: BEHAVIOR.wesh_central.tool * (1 - 0.25 * 0.65) };

function session(sc, fixed, load, b) {
  const turns = Math.max(1, Math.round(sc.turns * b.turns));
  const scouted = sc.input * sc.explore * b.scout;
  const input = (sc.input - scouted) * b.tool + (scouted ? 120 : 0); // scout returns ~120 tokens of path:line
  const out = sc.out * b.out;
  let prefix = 0, cost = 0, billedIn = 0;
  for (let t = 0; t < turns; t++) {
    const fresh = (t === 0 ? SYSTEM + fixed : 0) + input + (t > 0 ? out : 0) + (t < sc.loads ? load : 0);
    cost += prefix * P.read + fresh * P.in * 1.25 + out * P.out;
    billedIn += prefix + fresh;
    prefix += fresh;
  }
  // Scout subagent runs on Haiku: it reads the moved exploration tokens itself (~3 requests each).
  const scoutTokens = scouted * turns;
  cost += scoutTokens * PRICES['claude-haiku-5-5'].in * 1.25 + scoutTokens * 0.2 * PRICES['claude-haiku-5-5'].read * 3;
  return { cost: cost / 1e6, billedIn, out: out * turns, turns };
}

const arms = [
  ['no skill', 0, 0, BEHAVIOR.baseline],
  ['all 3 installed', S['all 3 installed'].perTurn, S['all 3 installed'].avgLoad, BEHAVIOR.all3],
  ['wesh, overhead only', S.wesh.perTurn, S.wesh.avgLoad, BEHAVIOR.baseline],
  ['wesh low', S.wesh.perTurn, S.wesh.avgLoad, BEHAVIOR.wesh_low],
  ['wesh central', S.wesh.perTurn, S.wesh.avgLoad, BEHAVIOR.wesh_central],
  ['wesh high', S.wesh.perTurn, S.wesh.avgLoad, BEHAVIOR.wesh_high],
  ['wesh central + squeeze', S.wesh.perTurn, S.wesh.avgLoad, BEHAVIOR.wesh_squeeze],
];

let md = `# Session cost model (${MODEL}, $${P.in}/$${P.out} in/out, cache read $${P.read})\n\n`;
const summary = [];
for (const sc of SCENARIOS) {
  const base = session(sc, 0, 0, BEHAVIOR.baseline);
  const rows = [['arm', 'requests', 'input tok (billed)', 'output tok', 'cost $', 'vs no skill']];
  for (const [name, fixed, load, b] of arms) {
    const r = session(sc, fixed, load, b);
    const d = Math.round((r.cost / base.cost - 1) * 1000) / 10;
    rows.push([name, r.turns, Math.round(r.billedIn).toLocaleString('en'), Math.round(r.out).toLocaleString('en'), r.cost.toFixed(3), `${d > 0 ? '+' : ''}${d}%`]);
    summary.push({ scenario: sc.name, arm: name, cost: r.cost, delta: d });
  }
  md += `## ${sc.name} (${sc.turns} requests, ${sc.input} new input + ${sc.out} output tok/request)\n\n${table(rows)}\n\n`;
}
// Calibration: ponytail measured -26% cost on its benchmark; the model should land near it for bug-fix-sized tasks.
md += `Calibration: ponytail's published agentic run measured -26% cost (95% CI -36..-16) with these turn/output multipliers. ` +
  `The "all 3 installed" bug-fix row should land in that band if the model is sane.\n`;
console.log(md);
fs.writeFileSync(path.join(DIR, 'results', `simulate-${MODEL}.md`), md);
fs.writeFileSync(path.join(DIR, 'results', `simulate-${MODEL}.json`), JSON.stringify(summary, null, 2));
