// Real A/B: the same coding tasks through the real `claude -p`, with and without wesh, on your normal Claude login.
//   node bench/ab/run.mjs --claude <claude binary> [--model claude-sonnet-5-5] [--reps 2] [--arms none,wesh,wesh-cg]
//                         [--tasks id,id] [--parallel 3] [--budget 3] [--out bench/results/ab-runs.jsonl]
//   node bench/ab/run.mjs --selftest     hidden checks fail on the untouched fixture and pass on reference fixes
// Fair by construction: every run gets a fresh committed copy of the fixture; your user-level Claude config (CLAUDE.md,
// skills, agents, hooks, MCP servers) is kept out with --setting-sources project,local, --strict-mcp-config and
// claudeMdExcludes (verified with a mock model), so the only difference between arms is a project-scoped wesh install.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFixture, DAILY_TEST } from './fixture.mjs';
import { TASKS } from './tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOST = arg('--host', 'claude'); // claude | opencode
const TZ = 'Europe/Paris'; // fixed, so the daily-utc task fails the same way on every machine
const ARMS = {
  none: { install: null, label: 'no wesh' },
  wesh: { install: ['--no-codegraph'], label: 'wesh, no codegraph' },
  'wesh-cg': { install: [], label: 'wesh + codegraph' },
};
const ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'Skill', 'TodoWrite', 'PowerShell', 'mcp__codegraph__*',
  ...['node', 'npm', 'npx', 'git', 'ls', 'cat', 'grep', 'rg', 'find', 'head', 'tail', 'wc', 'sed', 'codegraph', 'echo', 'cd'].map(c => `Bash(${c} *)`), 'Bash(npm test)', 'Bash(ls)'];

const env0 = (() => {
  // A plain terminal: nothing inherited from a Claude Code session running this script (its endpoint, its session,
  // CLAUDE_CODE_SIMPLE, which is --bare mode and would skip hooks and CLAUDE.md in the wesh arms).
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(CLAUDE|ANTHROPIC_)/.test(k)) delete e[k];
  return { ...e, TZ, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
})();
const sh = (cmd, args, cwd, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...env0, ...extra }, maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32' && !/\.exe$/i.test(cmd) && cmd !== process.execPath });

const TASKS_RUN = TASKS;
const FX = () => ({ freshRepo, hidden, visible });

function freshRepo(task, armKey) {
  const sb = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ab-run-')) // neutral: the agent sees its folder name;
  const repo = path.join(sb, 'repo');
  writeFixture(repo);
  task.setup?.(repo);
  sh('git', ['init', '-q'], repo);
  sh('git', ['-c', 'user.email=ab@x', '-c', 'user.name=ab', 'add', '-A'], repo);
  sh('git', ['-c', 'user.email=ab@x', '-c', 'user.name=ab', 'commit', '-qm', 'fixture'], repo);
  return { sb, repo };
}

// Hidden checks: written outside the repo, importing the agent's code by file URL.
function hidden(task, repo) {
  const f = path.join(path.dirname(repo), `hidden-${task.id}.test.mjs`);
  const base = pathToFileURL(repo).href;
  fs.writeFileSync(f, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${task.hidden.replace(/'W\//g, `'${base}/`)}`);
  const r = sh(process.execPath, ['--test', '--test-reporter=tap', f], path.dirname(repo), { WORK: repo, DAILY_TEST });
  const n = k => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  return { pass: n('pass'), fail: n('fail'), total: n('tests') };
}
function visible(repo) {
  const r = sh(process.execPath, ['--test', '--test-reporter=tap'], repo);
  const n = k => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  return { ok: r.status === 0, pass: n('pass'), fail: n('fail') };
}
function diffStats(repo, exclude = []) {
  sh('git', ['add', '-A'], repo);
  const out = sh('git', ['diff', '--cached', '--numstat', 'HEAD', '--', '.', ':!.codegraph', ':!.claude', ':!CLAUDE.md', ':!.mcp.json', ...exclude.map(e => `:!${e}`)], repo).stdout || '';
  const s = { codeAdded: 0, codeRemoved: 0, testAdded: 0, testRemoved: 0, files: 0 };
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [a, d, f] = line.split('\t');
    s.files++;
    const t = /(^|\/)test\/|\.test\./.test(f);
    s[t ? 'testAdded' : 'codeAdded'] += Number(a) || 0; s[t ? 'testRemoved' : 'codeRemoved'] += Number(d) || 0;
  }
  return s;
}

// session: { id, first } for --chain, where all tasks are turns of one persisted conversation.
function runClaude(bin, repo, task, armKey, model, budget, settingsFile, session = null) {
  const args = ['-p', task.prompt, '--output-format', 'json', '--model', model, '--setting-sources', 'project,local', '--strict-mcp-config',
    '--settings', settingsFile, '--permission-mode', 'acceptEdits', '--max-budget-usd', String(budget),
    ...(session ? (session.first ? ['--session-id', session.id] : ['--resume', session.id]) : ['--no-session-persistence']),
    '--allowedTools', ...ALLOWED];
  if (armKey === 'wesh-cg' && fs.existsSync(path.join(repo, '.mcp.json'))) args.push('--mcp-config', path.join(repo, '.mcp.json'));
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(bin, args, { cwd: repo, env: env0, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', c => (out += c)); p.stderr.on('data', c => (err += c));
    const timer = setTimeout(() => p.kill(), 20 * 60 * 1000);
    p.on('exit', code => { clearTimeout(timer); resolve({ code, out, err, wall: Date.now() - t0 }); });
  });
}

// OpenCode 2: a private config, data and state folder per run (XDG is honoured), the Claude fallback off so the real
// ~/.claude never leaks in, and the free OpenCode Zen models (no login). Usage comes from the run's own database.
const ocEnv = sb => ({ ...env0, XDG_CONFIG_HOME: path.join(sb, 'xdg', 'config'), XDG_DATA_HOME: path.join(sb, 'xdg', 'data'),
  XDG_CACHE_HOME: path.join(sb, 'xdg', 'cache'), XDG_STATE_HOME: path.join(sb, 'xdg', 'state'), OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1' });
// No --auto: the run's private global config allows edits inside the repo and a short list of shell commands
// (tests, read-only git, listings); everything else is denied, and nothing outside the repo is reachable.
// OpenCode checks each command of a pipeline, so the read-only filters an agent pipes into are listed too (PowerShell's and
// Unix ones). A first version was too narrow and blocked harmless commands such as `git -C <dir> log`, which made every
// arm flail (most of all the one that piped most): see bench/results/ab-opencode-big-pickle.md.
const SAFE_BASH = ['node*', 'npm test*', 'npm run *', 'npx vitest*', 'npx jest*', 'git status*', 'git diff*', 'git log*', 'git show*', 'git grep*',
  'git -C * status*', 'git -C * diff*', 'git -C * log*', 'git -C * show*', 'ls*', 'dir*', 'cat *', 'type *', 'head *', 'tail *', 'grep *', 'rg *',
  'find *', 'wc *', 'sort*', 'more*', 'findstr *', 'Get-Content *', 'Get-ChildItem*', 'Select-Object *', 'Select-String *', 'Out-String*',
  'Measure-Object*', 'Format-*', 'Where-Object *', 'ForEach-Object *', 'cd *', 'Set-Location *', 'pwd', 'echo *', 'Write-Output *', 'codegraph *'];
function writeOpenCodePermissions(sb) {
  const f = path.join(sb, 'xdg', 'config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: {
    edit: 'allow', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', task: 'allow', skill: 'allow', todowrite: 'allow',
    webfetch: 'deny', websearch: 'deny', external_directory: 'deny',
    bash: { '*': 'deny', ...Object.fromEntries(SAFE_BASH.map(c => [c, 'allow'])) } } }, null, 2));
}
function runOpenCode(bin, repo, sb, task, model) {
  writeOpenCodePermissions(sb);
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(bin, ['run', '--standalone', '--format', 'json', '--model', model, task.prompt], { cwd: repo, env: ocEnv(sb), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', c => (out += c)); p.stderr.on('data', c => (err += c));
    const timer = setTimeout(() => p.kill(), 20 * 60 * 1000);
    p.on('exit', code => { clearTimeout(timer); resolve({ code, out, err, wall: Date.now() - t0 }); });
  });
}
async function openCodeUsage(sb) {
  const { DatabaseSync } = await import('node:sqlite');
  const u = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, reasoning: 0, steps: 0, toolCalls: 0, sessions: 0, models: new Set(), errors: 0 };
  let db;
  try { db = new DatabaseSync(path.join(sb, 'xdg', 'data', 'opencode', 'opencode.db'), { readOnly: true }); } catch { return u; }
  u.sessions = db.prepare('select count(*) n from session_v2').get().n;
  for (const r of db.prepare("select data from session_message where type = 'assistant'").all()) {
    let m; try { m = JSON.parse(r.data); } catch { continue; }
    const t = m.tokens || {};
    u.input += t.input || 0; u.output += t.output || 0; u.reasoning += t.reasoning || 0;
    u.cacheRead += t.cache?.read || 0; u.cacheWrite += t.cache?.write || 0;
    u.steps++; if (m.model?.id) u.models.add(`${m.model.providerID}/${m.model.id}`);
    if (m.error || m.finish === 'error') u.errors++;
    u.toolCalls += (m.content || []).filter(c => /tool/.test(c.type || '')).length;
  }
  db.close();
  return { ...u, models: [...u.models] };
}

// --variant <dir>: install wesh from a copy of this repo with the variant's files laid over it (e.g.
// bench/variants/caveman/core/CORE.md), so a candidate can be measured without replacing the real files.
const INSTALLER = (() => {
  const v = arg('--variant', '');
  if (!v) return path.join(ROOT, 'install.mjs');
  const src = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wesh-variant-'));
  for (const d of ['core', 'skills', 'agents', 'hooks']) fs.cpSync(path.join(ROOT, d), path.join(src, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'install.mjs'), path.join(src, 'install.mjs'));
  fs.cpSync(path.resolve(v), src, { recursive: true });
  return path.join(src, 'install.mjs');
})();
function prepareArm(sb, repo, armKey) {
  const arm = ARMS[armKey];
  if (arm.install) {
    const target = HOST === 'opencode' ? ['--target', 'opencode', '--opencode-version', '2'] : ['--target', 'claude'];
    const r = sh(process.execPath, [INSTALLER, '--home', path.join(sb, 'home'), '--scope', 'project', '--project', repo,
      ...target, '--level', 'full', ...arm.install], repo, { WESH_NO_NPM: '1', ...(HOST === 'opencode' ? { OPENCODE_DISABLE_CLAUDE_CODE: '1' } : {}) });
    if (r.status !== 0) throw new Error(`install failed: ${r.stderr}`);
    // Steady state of a project opened before: indexed, unless it is under the auto-index floor (200 tracked files),
    // where the installed wesh builds no graph either.
    const tracked = (spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '').split('\n').filter(Boolean).length;
    if (armKey === 'wesh-cg' && tracked >= 200) sh('codegraph', ['init', '--yes'], repo);
    sh('git', ['-c', 'user.email=ab@x', '-c', 'user.name=ab', 'add', '-A'], repo);
    sh('git', ['-c', 'user.email=ab@x', '-c', 'user.name=ab', 'commit', '-qm', 'wesh'], repo);
  }
}
const claudeResult = r => { try { return JSON.parse(r.out.trim().split('\n').filter(l => l.startsWith('{')).at(-1) || '{}'); } catch { return {}; } };

async function one(bin, task, armKey, rep, model, budget, settingsFile) {
  const { sb, repo } = FX().freshRepo(task, armKey);
  prepareArm(sb, repo, armKey);
  if (HOST === 'opencode') {
    const r = await runOpenCode(bin, repo, sb, task, model);
    const u = await openCodeUsage(sb);
    return {
      host: 'opencode', task: task.id, kind: task.kind, arm: armKey, rep, model, at: new Date().toISOString(),
      ok: r.code === 0 && u.steps > 0 && !u.errors, subtype: '', error: r.code === 0 && !u.errors ? '' : (r.err || r.out).slice(-400),
      wallMs: r.wall, durationMs: r.wall, apiMs: null, turns: u.steps, toolCalls: u.toolCalls, subSessions: u.sessions - 1, costUsd: null,
      input: u.input, cacheWrite: u.cacheWrite, cacheRead: u.cacheRead, output: u.output + u.reasoning, reasoning: u.reasoning, models: u.models,
      hidden: hidden(task, repo), visible: visible(repo), diff: diffStats(repo), sandbox: path.basename(sb),
    };
  }
  const r = await runClaude(bin, repo, task, armKey, model, budget, settingsFile);
  let j = {};
  try { j = JSON.parse(r.out.trim().split('\n').filter(l => l.startsWith('{')).at(-1) || '{}'); } catch {}
  const u = j.usage || {};
  return {
    task: task.id, kind: task.kind, arm: armKey, rep, model, at: new Date().toISOString(),
    ok: r.code === 0 && !j.is_error, subtype: j.subtype || '', error: r.code === 0 ? '' : (r.err || r.out).slice(-400),
    wallMs: r.wall, durationMs: j.duration_ms ?? null, apiMs: j.duration_api_ms ?? null, turns: j.num_turns ?? null, costUsd: j.total_cost_usd ?? null,
    input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0,
    models: Object.keys(j.modelUsage || {}),
    hidden: FX().hidden(task, repo, j.result || ''), visible: FX().visible(repo), diff: diffStats(repo), sandbox: path.basename(sb), // no user name in the results
  };
}

// --chain: one long Claude Code session per arm and repeat. The 8 tasks are asked one after another as turns of the
// same persisted conversation (turn 1 --session-id, then --resume), on one repo, like a working day: the context grows,
// and compaction may happen as it would for a user. Each task's hidden checks run right after its turn and again at
// the end, so a later turn that breaks an earlier fix shows up as a regression.
async function chain(bin, armKey, rep, model, budget, settingsFile) {
  const { sb, repo } = FX().freshRepo({ id: 'chain' }, armKey);
  prepareArm(sb, repo, armKey);
  const id = crypto.randomUUID(), turns = [], t0 = Date.now();
  const answers = {};
  for (const [n, task] of TASKS_RUN.entries()) {
    task.setup?.(repo); // the failing test of daily-utc appears only when that task is asked
    const r = await runClaude(bin, repo, task, armKey, model, budget, settingsFile, { id, first: n === 0 });
    const j = claudeResult(r), u = j.usage || {};
    turns.push({ task: task.id, ok: r.code === 0 && !j.is_error, error: r.code === 0 ? '' : (r.err || r.out).slice(-300), wallMs: r.wall,
      steps: j.num_turns ?? null, costUsd: j.total_cost_usd ?? null, input: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0, models: Object.keys(j.modelUsage || {}), hiddenNow: FX().hidden(task, repo, (answers[task.id] = j.result || '')) });
    console.log(`  ${armKey} #${rep} turn ${n + 1} ${task.id}: ${(r.wall / 1000).toFixed(0)}s, ${j.num_turns} steps, $${j.total_cost_usd?.toFixed(3)}, hidden ${turns.at(-1).hiddenNow.pass}/${turns.at(-1).hiddenNow.total}`);
  }
  const sum = k => turns.reduce((a, t) => a + (t[k] || 0), 0);
  return {
    mode: 'chain', host: 'claude', arm: armKey, rep, model, at: new Date().toISOString(), sessionId: id,
    ok: turns.every(t => t.ok), wallMs: Date.now() - t0, steps: sum('steps'), costUsd: sum('costUsd'),
    input: sum('input'), cacheWrite: sum('cacheWrite'), cacheRead: sum('cacheRead'), output: sum('output'), turns,
    final: Object.fromEntries(TASKS_RUN.map(t => [t.id, FX().hidden(t, repo, answers[t.id])])), visible: FX().visible(repo),
    diff: diffStats(repo, ['test/daily.test.js']), sandbox: path.basename(sb),
  };
}

// --selftest: each hidden check must fail on the fixture and pass on a reference fix.
const REF = {
  'money-split': d => edit(d, 'src/money.js', /const share[\s\S]*?\);\n/, "const base = Math.floor(total / n), extra = total - base * n;\n  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));\n"),
  'member-coupon': d => edit(d, 'src/pricing/discounts.js', 'const base = applyMemberDiscount(cents, user);', 'const base = cents;'),
  'csv-export': d => fs.appendFileSync(path.join(d, 'src/reports/export.js'), "const q = v => { const s = String(v); return /[\",\\n\\r]/.test(s) ? '\"' + s.replace(/\"/g, '\"\"') + '\"' : s; };\nexport const ordersToCsv = orders => ['id,customer,total,date', ...orders.map(o => [o.id, o.customerId, (o.total / 100).toFixed(2), o.date].map(q).join(','))].join('\\r\\n') + '\\r\\n';\n"),
  'user-validation': d => edit(d, 'src/users/users.js', "export function createUser({ email, age, member = false }) {", "import { ValidationError } from './errors.js';\nexport function createUser({ email, age, member = false }) {\n  if (typeof email !== 'string' || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) throw new ValidationError('email', 'invalid email');\n  if (!Number.isInteger(age) || age < 13 || age > 120) throw new ValidationError('age', 'age must be an integer from 13 to 120');"),
  rename: d => { for (const f of ['src/orders/order.js', 'src/orders/invoice.js', 'test/orders.test.js']) edit(d, f, /\bcalcTotal\b/g, 'computeOrderTotal'); },
  'sales-perf': d => edit(d, 'src/reports/sales.js', /export function[\s\S]*$/, "export function salesByCustomer(orders, users) {\n  const agg = new Map();\n  for (const o of orders) if (o.status !== 'cancelled') { const a = agg.get(o.customerId) || { total: 0, count: 0 }; a.total += o.total; a.count++; agg.set(o.customerId, a); }\n  const rows = [];\n  for (const u of users) { const a = agg.get(u.id); if (a) rows.push({ customerId: u.id, email: u.email, orders: a.count, total: a.total }); }\n  return rows.sort((a, b) => b.total - a.total);\n}\n"),
  'path-traversal': d => edit(d, 'src/files/download.js', 'return path.join(baseDir, name);', "const base = path.resolve(baseDir), full = path.resolve(base, name);\n  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('outside downloads');\n  if (full === base) throw new Error('not a file');\n  return full;"),
  'daily-utc': d => edit(d, 'src/reports/daily.js', /const day = .*;/, 'const day = d.toISOString().slice(0, 10);'),
};
function edit(dir, file, from, to) {
  const f = path.join(dir, file), t = fs.readFileSync(f, 'utf8');
  const next = t.replace(from, to);
  if (next === t) throw new Error(`selftest edit did not apply: ${file}`);
  fs.writeFileSync(f, next);
}
if (process.argv.includes('--selftest')) {
  let bad = 0;
  for (const task of TASKS) {
    const { sb, repo } = freshRepo(task, 'selftest');
    const before = hidden(task, repo), vis0 = visible(repo);
    REF[task.id](repo);
    const after = hidden(task, repo), vis1 = visible(repo);
    const ok = before.fail > 0 && after.fail === 0 && after.pass === after.total && after.total > 0 && vis1.ok && (task.id === 'daily-utc' ? !vis0.ok : vis0.ok);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${task.id}: fixture ${before.pass}/${before.total} hidden, visible ${vis0.ok ? 'pass' : 'fail'} -> reference ${after.pass}/${after.total}, visible ${vis1.ok ? 'pass' : 'fail'}`);
    fs.rmSync(sb, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}

// --- the real runs ---
const bin = HOST === 'opencode' ? arg('--opencode') : arg('--claude');
if (!bin) { console.error('usage: node bench/ab/run.mjs --claude <claude binary> | --host opencode --opencode <opencode binary> [options] | --selftest'); process.exit(2); }
const model = arg('--model', HOST === 'opencode' ? 'opencode/big-pickle' : 'claude-sonnet-5-5'), reps = Number(arg('--reps', 2)), parallel = Number(arg('--parallel', 3)), budget = Number(arg('--budget', 3));
const arms = arg('--arms', 'none,wesh,wesh-cg').split(','), only = arg('--tasks', '');
const out = path.resolve(arg('--out', path.join(ROOT, 'bench', 'results', `ab-runs-${HOST}-${model.replace(/[^\w.-]+/g, '-')}.jsonl`)));
const tasks = TASKS_RUN.filter(t => !only || only.split(',').includes(t.id));
const settingsFile = path.join(os.tmpdir(), 'wesh-ab-settings.json');
// Keep the user's own memory file out of every arm (the wesh arms bring theirs in the project).
fs.writeFileSync(settingsFile, JSON.stringify({ claudeMdExcludes: [path.join(os.homedir(), '.claude', 'CLAUDE.md').replace(/\\/g, '/'), '**/.claude/CLAUDE.md'] }));
if (process.argv.includes('--chain')) {
  const chainOut = path.resolve(arg('--out', path.join(ROOT, 'bench', 'results', `ab-chain-claude-${model.replace(/[^\w.-]+/g, '-')}.jsonl`)));
  const have = new Set(fs.existsSync(chainOut) ? fs.readFileSync(chainOut, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.arm}|${r.rep}`; }) : []);
  const sessions = [];
  for (let rep = 1; rep <= reps; rep++) for (const a of arms) if (!have.has(`${a}|${rep}`)) sessions.push([a, rep]);
  console.log(`${sessions.length} chained sessions of ${TASKS_RUN.length} turns to do, ${parallel} at a time, model ${model}`);
  let i = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (i < sessions.length) {
      const [a, rep] = sessions[i++];
      try {
        const r = await chain(bin, a, rep, model, budget, settingsFile);
        fs.appendFileSync(chainOut, JSON.stringify(r) + '\n');
        const fin = Object.values(r.final), solved = fin.filter(h => h.total && h.pass === h.total).length;
        console.log(`${r.ok ? 'done' : 'ERR '} session ${a} #${rep}: ${(r.wallMs / 1000).toFixed(0)}s, ${r.steps} steps, $${r.costUsd.toFixed(3)}, ${solved}/${fin.length} tasks solved at the end, visible ${r.visible.ok ? 'pass' : 'FAIL'}`);
      } catch (e) { console.log(`ERR  session ${a} #${rep}: ${e.message}`); }
    }
  }));
  process.exit(0);
}
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.task}|${r.arm}|${r.rep}`; }) : []);
const jobs = [];
for (let rep = 1; rep <= reps; rep++) for (const t of tasks) for (const a of arms) if (!done.has(`${t.id}|${a}|${rep}`)) jobs.push([t, a, rep]);
console.log(`${jobs.length} runs to do (${done.size} already in ${path.relative(process.cwd(), out)}), ${parallel} at a time, model ${model}`);
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const [t, a, rep] = jobs[next++];
    try {
      const r = await one(bin, t, a, rep, model, budget, settingsFile);
      fs.appendFileSync(out, JSON.stringify(r) + '\n');
      console.log(`${r.ok ? 'done' : 'ERR '} ${t.id} ${a} #${rep}: ${(r.wallMs / 1000).toFixed(0)}s, ${r.turns} turns, $${r.costUsd?.toFixed(3)}, hidden ${r.hidden.pass}/${r.hidden.total}, visible ${r.visible.ok ? 'pass' : 'FAIL'}, +${r.diff.codeAdded}/-${r.diff.codeRemoved} code, +${r.diff.testAdded} test${r.error ? ' | ' + r.error.replace(/\s+/g, ' ').slice(0, 160) : ''}`);
    } catch (e) { console.log(`ERR  ${t.id} ${a} #${rep}: ${e.message}`); }
  }
};
await Promise.all(Array.from({ length: parallel }, worker));
