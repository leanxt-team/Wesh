// Summarises an A/B results file from run.mjs into a markdown report.
//   node bench/ab/report.mjs <results.jsonl> [--out report.md]
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const outArg = process.argv.indexOf('--out');
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
if (rows[0]?.mode === 'chain') { chainReport(rows); process.exit(0); }
const ARMS = ['none', 'wesh', 'wesh-cg', 'wesh-v2', 'wesh-cg-v2'].filter(a => rows.some(r => r.arm === a));
const LABEL = { none: 'no wesh', wesh: 'wesh', 'wesh-cg': 'wesh + codegraph', 'wesh-v2': 'wesh v2', 'wesh-cg-v2': 'wesh v2 + codegraph' };
const tasks = [...new Set(rows.map(r => r.task))];
// Free models report no price: tokens are priced as if the same work ran on these models (USD per million tokens).
const PRICES = { 'Sonnet 5.5': { in: 3, cw: 3.75, cr: 0.3, out: 15 }, 'Opus 5.5': { in: 5, cw: 6.25, cr: 0.5, out: 25 } };
const price = (r, p) => (r.input * p.in + r.cacheWrite * p.cw + r.cacheRead * p.cr + r.output * p.out) / 1e6;
// Solved is judged by outcome only; a run that reported an intermediate error but finished the job still counts.
const solved = r => r.hidden.total > 0 && r.hidden.pass === r.hidden.total && r.visible.ok;
const churn = r => r.diff.codeAdded + r.diff.codeRemoved;
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const f0 = n => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '-');
const f1 = n => (Number.isFinite(n) ? n.toFixed(1) : '-');
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '-');
const usd = n => (Number.isFinite(n) ? `$${n.toFixed(3)}` : '-');

const by = (arm, task) => rows.filter(r => r.arm === arm && (!task || r.task === task));
const stats = list => ({
  n: list.length, solved: list.filter(solved).length, hp: list.reduce((a, r) => a + r.hidden.pass, 0), ht: list.reduce((a, r) => a + r.hidden.total, 0),
  visible: list.filter(r => r.visible.ok).length, errors: list.filter(r => !r.ok).length,
  timeMed: median(list.map(r => r.wallMs / 1000)), timeMean: mean(list.map(r => r.wallMs / 1000)),
  steps: mean(list.map(r => r.turns || 0)), tools: mean(list.map(r => r.toolCalls || 0)),
  input: mean(list.map(r => r.input)), cacheRead: mean(list.map(r => r.cacheRead)), cacheWrite: mean(list.map(r => r.cacheWrite)), output: mean(list.map(r => r.output)),
  processed: mean(list.map(r => r.input + r.cacheRead + r.cacheWrite + r.output)),
  sonnet: mean(list.map(r => price(r, PRICES['Sonnet 5.5']))), opus: mean(list.map(r => price(r, PRICES['Opus 5.5']))),
  churn: mean(list.map(churn)), tests: mean(list.map(r => r.diff.testAdded)), files: mean(list.map(r => r.diff.files)),
});
const S = Object.fromEntries(ARMS.map(a => [a, stats(by(a))]));
const host = rows[0]?.host || 'claude', model = rows[0]?.model || '?';
const reps = Math.max(...rows.map(r => r.rep));

let md = `# A/B: ${host === 'opencode' ? 'OpenCode 2.2' : 'Claude Code'}, ${model}\n\n`;
md += `${rows.length} real runs: ${tasks.length} tasks x ${ARMS.length} arms x up to ${reps} repeats, ${rows[0]?.at?.slice(0, 10)}. `;
md += 'Every run: a fresh committed copy of the fixture repo, the same prompt, hidden checks the agent never sees, and the visible test suite. ';
md += 'Arms differ only by a project-scoped wesh install. Token counts come from the host\'s own records; free models report no price, so cost is the same tokens priced at Sonnet 5.5 and Opus 5.5 rates.\n\n';

md += `## Overall (mean per run unless noted)\n\n| | ${ARMS.map(a => LABEL[a]).join(' | ')} |\n|---|${ARMS.map(() => '--:').join('|')}|\n`;
const line = (name, fn, delta = true) => { md += `| ${name} | ${ARMS.map(a => fn(S[a]) + (delta && a !== 'none' && S.none ? ` (${pct(rawOf(name, S[a]), rawOf(name, S.none))})` : '')).join(' | ')} |\n`; };
const RAW = {};
const rawOf = (name, s) => RAW[name](s);
const row = (name, raw, fmt, delta = true) => { RAW[name] = raw; line(name, s => fmt(raw(s)), delta); };
md += `| tasks fully solved (all hidden checks + visible suite) | ${ARMS.map(a => `${S[a].solved}/${S[a].n}`).join(' | ')} |\n`;
row('hidden checks passed', s => s.hp / s.ht, v => `${Math.round(v * 1000) / 10}%`, false);
row('visible suite passes after', s => s.visible / s.n, v => `${Math.round(v * 100)}%`, false);
row('run errors', s => s.errors, v => String(v), false);
row('wall time, median (s)', s => s.timeMed, f1);
row('wall time, mean (s)', s => s.timeMean, f1);
row('model steps', s => s.steps, f1);
row('tool calls', s => s.tools, f1);
row('input tokens, uncached', s => s.input, f0);
row('input tokens, cache read', s => s.cacheRead, f0);
row('output tokens (incl. reasoning)', s => s.output, f0);
row('tokens processed, total', s => s.processed, f0);
row('cost if priced as Sonnet 5.5', s => s.sonnet, usd);
row('cost if priced as Opus 5.5', s => s.opus, usd);
row('code lines changed', s => s.churn, f1);
row('test lines added', s => s.tests, f1);
row('files touched', s => s.files, f1);

// Paired by task: each task's mean for an arm divided by its mean without wesh, then the median of those ratios.
md += '\n## Paired by task (median of per-task ratios vs no wesh; robust to one hard task dominating the means)\n\n';
md += `| metric | ${ARMS.filter(a => a !== 'none').map(a => LABEL[a]).join(' | ')} | tasks where wesh is lower |\n|---|${ARMS.filter(a => a !== 'none').map(() => '--:').join('|')}|--:|\n`;
for (const [name, fn] of [['wall time', r => r.wallMs], ['tokens processed', r => r.input + r.cacheRead + r.cacheWrite + r.output],
  ['cost (Sonnet rates)', r => price(r, PRICES['Sonnet 5.5'])], ['model steps', r => r.turns || 0], ['code lines changed', churn]]) {
  const cells = [], wins = [];
  for (const a of ARMS.filter(a => a !== 'none')) {
    const ratios = [];
    let lower = 0, n = 0;
    for (const t of tasks) {
      const base = mean(by('none', t).map(fn)), arm = mean(by(a, t).map(fn));
      if (Number.isFinite(base) && Number.isFinite(arm) && base > 0) { ratios.push(arm / base); n++; if (arm < base) lower++; }
    }
    const m = median(ratios);
    cells.push(Number.isFinite(m) ? `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%` : '-');
    wins.push(`${lower}/${n}`);
  }
  md += `| ${name} | ${cells.join(' | ')} | ${wins.join(' , ')} |\n`;
}

md += '\n## Per task\n\n| task | kind | arm | solved | hidden | time med (s) | steps | tokens processed | cost (Sonnet) | code lines | test lines |\n|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|\n';
for (const t of tasks) for (const a of ARMS) {
  const s = stats(by(a, t));
  if (!s.n) continue;
  md += `| ${t} | ${by(a, t)[0].kind} | ${LABEL[a]} | ${s.solved}/${s.n} | ${s.hp}/${s.ht} | ${f1(s.timeMed)} | ${f1(s.steps)} | ${f0(s.processed)} | ${usd(s.sonnet)} | ${f1(s.churn)} | ${f1(s.tests)} |\n`;
}
const fails = rows.filter(r => !solved(r));
if (fails.length) {
  md += '\n## Runs that did not fully solve the task\n\n';
  for (const r of fails) md += `- ${r.task} / ${LABEL[r.arm]} #${r.rep}: hidden ${r.hidden.pass}/${r.hidden.total}, visible ${r.visible.ok ? 'pass' : 'fail'}${r.ok ? '' : ', run error: ' + (r.error || '').replace(/\s+/g, ' ').slice(0, 140)}\n`;
}
const out = outArg > 0 ? process.argv[outArg + 1] : file.replace(/\.jsonl$/, '.md');
fs.writeFileSync(out, md);
console.log(md);
console.log(`written to ${path.relative(process.cwd(), out)}`);

// Long sessions (--chain): one conversation per arm and repeat, the tasks asked one after another.
function chainReport(rows) {
  const ARMS = ['none', 'wesh', 'wesh-cg', 'wesh-v2', 'wesh-cg-v2'].filter(a => rows.some(r => r.arm === a));
  const LABEL = { none: 'no wesh', wesh: 'wesh', 'wesh-cg': 'wesh + codegraph', 'wesh-v2': 'wesh v2', 'wesh-cg-v2': 'wesh v2 + codegraph' };
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const by = a => rows.filter(r => r.arm === a);
  const full = h => h.total > 0 && h.pass === h.total;
  const tokens = r => r.input + r.cacheRead + r.cacheWrite + r.output;
  const pct = (a, b) => (Number.isFinite(a) && b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '');
  const S = Object.fromEntries(ARMS.map(a => { const l = by(a); return [a, {
    n: l.length, cost: mean(l.map(r => r.costUsd)), time: mean(l.map(r => r.wallMs / 1000)), steps: mean(l.map(r => r.steps)), tokens: mean(l.map(tokens)),
    output: mean(l.map(r => r.output)), cacheRead: mean(l.map(r => r.cacheRead)),
    solved: mean(l.map(r => Object.values(r.final).filter(full).length)), tasks: Object.keys(l[0].final).length,
    regressions: mean(l.map(r => r.turns.filter(t => full(t.hiddenNow) && !full(r.final[t.task])).length)),
    visible: l.filter(r => r.visible.ok).length, errors: l.reduce((a, r) => a + r.turns.filter(t => !t.ok).length, 0),
    code: mean(l.map(r => r.diff.codeAdded + r.diff.codeRemoved)), tests: mean(l.map(r => r.diff.testAdded)),
  }]; }));
  let md = `# Long sessions: Claude Code, ${rows[0].model}\n\n${rows.length} real sessions; each asks the ${S[ARMS[0]].tasks} tasks one after another in one conversation on one repo (mean per session).\n\n`;
  md += `| per session | ${ARMS.map(a => LABEL[a]).join(' | ')} |\n|---|${ARMS.map(() => '--:').join('|')}|\n`;
  const row = (name, k, fmt) => { md += `| ${name} | ${ARMS.map(a => fmt(S[a][k]) + (a !== 'none' && S.none && ['cost', 'time', 'steps', 'tokens', 'output', 'cacheRead', 'code', 'tests'].includes(k) ? ` (${pct(S[a][k], S.none[k])})` : '')).join(' | ')} |\n`; };
  row('sessions', 'n', v => String(v));
  row('tasks solved at the end', 'solved', v => `${v.toFixed(1)} / ${S[ARMS[0]].tasks}`);
  row('earlier fixes broken by later turns', 'regressions', v => v.toFixed(1));
  row('turns that errored', 'errors', v => String(v));
  row('cost', 'cost', v => `$${v.toFixed(3)}`);
  row('wall time (s)', 'time', v => v.toFixed(0));
  row('model steps', 'steps', v => v.toFixed(1));
  row('tokens processed', 'tokens', v => Math.round(v).toLocaleString('en-US'));
  row('cache reads', 'cacheRead', v => Math.round(v).toLocaleString('en-US'));
  row('output tokens', 'output', v => Math.round(v).toLocaleString('en-US'));
  row('code lines changed', 'code', v => v.toFixed(1));
  row('test lines added', 'tests', v => v.toFixed(1));
  md += `\n## Cost per turn as the session grows (mean $)\n\n| turn | task | ${ARMS.map(a => LABEL[a]).join(' | ')} |\n|--:|---|${ARMS.map(() => '--:').join('|')}|\n`;
  const order = rows[0].turns.map(t => t.task);
  order.forEach((task, i) => {
    md += `| ${i + 1} | ${task} | ${ARMS.map(a => { const v = mean(by(a).map(r => r.turns[i]?.costUsd || 0)); return `$${v.toFixed(3)}`; }).join(' | ')} |\n`;
  });
  const out = process.argv.indexOf('--out') > 0 ? process.argv[process.argv.indexOf('--out') + 1] : process.argv[2].replace(/\.jsonl$/, '.md');
  fs.writeFileSync(out, md);
  console.log(md);
}