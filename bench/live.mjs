// Stress test 4 (live, costs money): A/B the wesh core against no rules and against "Answer concisely."
// on coding tasks with hidden checks. Measures output tokens, cost, code lines and pass rate.
// Needs ANTHROPIC_API_KEY (or an `ant auth login` profile) and `npm i` in bench/.
// node bench/live.mjs [--runs 3] [--model claude-opus-5-5] [--tasks csv-sum,safe-join] [--plan]
// Generated code runs in a child Node process with a 10 s timeout, in a temp dir: run this on a dev machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { table } from './lib.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(opt('--runs', 3));
const MODEL = opt('--model', 'claude-opus-5-5');
const PRICE = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] }[MODEL];
const CORE = fs.readFileSync(path.join(DIR, '..', 'core', 'CORE.md'), 'utf8');
const ARMS = {
  'no rules': 'You are a coding assistant.',
  'concise': 'You are a coding assistant. Answer concisely.',
  'wesh': 'You are a coding assistant.\n\n' + CORE,
};
const ASK = 'Node 20 ESM. Reply with the complete module in one ```js block, then anything you must tell me.';

const TASKS = {
  'csv-sum': {
    prompt: `Export \`csvSum(text, column)\`: sum the numeric values of the named column in CSV text with a header row. Fields may be double-quoted and contain commas or "" escapes. Skip blank lines. ${ASK}`,
    check: `import { csvSum } from './m.mjs'; import assert from 'node:assert/strict';
      assert.equal(csvSum('a,b\\n1,2\\n3,4\\n', 'b'), 6);
      assert.equal(csvSum('name,amt\\n"Smith, J",10.5\\n\\n"x ""q""",2\\n', 'amt'), 12.5);
      assert.equal(csvSum('a\\n', 'a'), 0);`,
  },
  'safe-join': {
    prompt: `Export \`safeJoin(base, userPath)\`: return the absolute path of userPath inside directory base; throw if it would escape base (.., absolute paths, prefix tricks like base + "-evil"). ${ASK}`,
    check: `import { safeJoin } from './m.mjs'; import assert from 'node:assert/strict'; import path from 'node:path';
      const b = path.resolve('srv');
      assert.equal(safeJoin(b, 'a/b.txt'), path.join(b, 'a', 'b.txt'));
      for (const p of ['../x', '/etc/passwd', 'a/../../x', '../srv-evil/x']) assert.throws(() => safeJoin(b, p), p);`,
  },
  'split-bill': {
    prompt: `Export \`splitBill(totalCents, n)\`: split an integer amount of cents into n integer shares that sum exactly to the total and differ by at most 1, larger shares first. Throw on n < 1 or non-integer input. ${ASK}`,
    check: `import { splitBill } from './m.mjs'; import assert from 'node:assert/strict';
      assert.deepEqual(splitBill(100, 3), [34, 33, 33]);
      assert.deepEqual(splitBill(-7, 2), [-3, -4].sort((a, b) => b - a));
      assert.equal(splitBill(1000001, 7).reduce((a, b) => a + b), 1000001);
      assert.throws(() => splitBill(10, 0)); assert.throws(() => splitBill(1.5, 2));`,
  },
  'rate-limit': {
    prompt: `Export \`createRateLimiter({ limit, windowMs, now = Date.now })\` returning \`{ allow(key) }\`: sliding window, at most \`limit\` allowed calls per key in any \`windowMs\` span; memory must not grow without bound for idle keys. ${ASK}`,
    check: `import { createRateLimiter } from './m.mjs'; import assert from 'node:assert/strict';
      let t = 0; const r = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
      assert.ok(r.allow('a')); assert.ok(r.allow('a')); assert.ok(!r.allow('a')); assert.ok(r.allow('b'));
      t = 999; assert.ok(!r.allow('a')); t = 1000; assert.ok(r.allow('a'));`,
  },
  'parse-duration': {
    prompt: `Export \`parseDuration(s)\`: parse strings like "1h30m", "45s", "2d", "1h 5m 3s" into milliseconds. Units d h m s ms. Throw on empty, unknown unit, or garbage. ${ASK}`,
    check: `import { parseDuration } from './m.mjs'; import assert from 'node:assert/strict';
      assert.equal(parseDuration('1h30m'), 5400000); assert.equal(parseDuration('250ms'), 250);
      assert.equal(parseDuration('1h 5m 3s'), 3903000); assert.equal(parseDuration('2d'), 172800000);
      for (const s of ['', '5x', 'abc', '1h30']) assert.throws(() => parseDuration(s), s);`,
  },
  'group-by': {
    prompt: `Export \`groupBy(items, keyFn)\` returning a Map from key to array of items, in first-seen key order. ${ASK}`,
    check: `import { groupBy } from './m.mjs'; import assert from 'node:assert/strict';
      const m = groupBy([1, 2, 3, 4, 5], x => x % 2 ? 'odd' : 'even');
      assert.deepEqual([...m.keys()], ['odd', 'even']); assert.deepEqual(m.get('odd'), [1, 3, 5]);`,
  },
};

const pick = opt('--tasks', null);
const tasks = Object.entries(TASKS).filter(([k]) => !pick || pick.split(',').includes(k));
const calls = tasks.length * Object.keys(ARMS).length * RUNS;
if (process.argv.includes('--plan')) {
  console.log(`${calls} requests on ${MODEL}. Rough cost: $${(calls * (400 * PRICE[0] + 2500 * PRICE[1]) / 1e6).toFixed(2)} (assumes ~2.5k output tokens incl. thinking).`);
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  const { default: REF } = await import('./live-ref.mjs');
  let bad = 0;
  for (const [k, t] of tasks) {
    const g = grade('```js\n' + REF[k] + '\n```', t.check);
    console.log(`${k}: reference ${g.pass ? 'pass' : 'FAIL'}`);
    if (!g.pass) bad++;
  }
  process.exit(bad ? 1 : 0);
}

let Anthropic;
try { ({ default: Anthropic } = await import('@anthropic-ai/sdk')); } catch {
  console.error('Run `npm i @anthropic-ai/sdk` in bench/ first.'); process.exit(1);
}
const client = new Anthropic();

function grade(text, check) {
  const code = (text.match(/```(?:js|javascript|mjs)?\n([\s\S]*?)```/) || [])[1];
  if (!code) return { pass: false, loc: 0 };
  const loc = code.split('\n').filter(l => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wesh-live-'));
  fs.writeFileSync(path.join(dir, 'm.mjs'), code);
  fs.writeFileSync(path.join(dir, 'check.mjs'), check);
  try { execFileSync(process.execPath, ['check.mjs'], { cwd: dir, timeout: 10000, stdio: 'pipe' }); return { pass: true, loc }; }
  catch { return { pass: false, loc }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const rows = [];
for (const [task, t] of tasks) for (const [arm, system] of Object.entries(ARMS)) for (let r = 0; r < RUNS; r++) {
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 16000, system, output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: t.prompt }],
  });
  if (msg.stop_reason === 'refusal') { rows.push({ task, arm, refused: true }); continue; }
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const g = grade(text, t.check);
  rows.push({ task, arm, in: msg.usage.input_tokens, out: msg.usage.output_tokens, ...g,
    cost: (msg.usage.input_tokens * PRICE[0] + msg.usage.output_tokens * PRICE[1]) / 1e6 });
  process.stdout.write('.');
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const out = [['arm', 'pass', 'median output tok', 'median code lines', 'total cost $', 'output vs no rules']];
const base = median(rows.filter(r => r.arm === 'no rules' && !r.refused).map(r => r.out));
for (const arm of Object.keys(ARMS)) {
  const rs = rows.filter(r => r.arm === arm && !r.refused);
  const mo = median(rs.map(r => r.out));
  out.push([arm, `${rs.filter(r => r.pass).length}/${rs.length}`, mo, median(rs.map(r => r.loc)),
    rs.reduce((a, r) => a + r.cost, 0).toFixed(3), `${Math.round((mo / base - 1) * 100)}%`]);
}
const md = `\n# Live A/B (${MODEL}, ${RUNS} runs x ${tasks.length} tasks, ${new Date().toISOString().slice(0, 10)})\n\n${table(out)}\n`;
console.log(md);
fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'results', `live-${MODEL}.md`), md);
fs.writeFileSync(path.join(DIR, 'results', `live-${MODEL}.json`), JSON.stringify(rows, null, 2));
