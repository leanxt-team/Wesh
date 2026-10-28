// Stress test 10: real Claude Code, end to end, against a local mock Anthropic API (no API key, nothing leaves the
// machine). node bench/claude-e2e.mjs <path-to-claude-binary> [extra install flags, e.g. --scope project]
// Sandboxed: CLAUDE_CONFIG_DIR/HOME point at a temp dir; the mock records exactly what Claude Code sends to the model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageSource } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bin, ...args] = process.argv.slice(2);
// --e2e-push: the control for --guard (git push allowed and attempted, with no guard rule).
// --e2e-twice: edit a source file, then open a second session (the index must catch up by itself).
// --e2e-powershell: the model uses Claude Code's PowerShell tool instead of Bash (Windows without Git Bash, or opted in).
const twice = args.includes('--e2e-twice'), pushControl = args.includes('--e2e-push'), usePwsh = args.includes('--e2e-powershell'), installArgs = args.filter(a => !a.startsWith('--e2e-'));
if (!bin) { console.error('usage: node bench/claude-e2e.mjs <claude binary> [install flags]'); process.exit(2); }
const projectScope = installArgs.includes('project');
const squeezeOn = !installArgs.includes('--no-squeeze'), guard = installArgs.includes('--guard');

// Long-form temp path: codegraph 1.6.2's Windows file watcher crashes on 8.3 short names (C:\Users\ABCDEF~1\...).
const sb = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wesh-cc-'));
const home = path.join(sb, 'home'), proj = path.join(sb, 'proj with space');
fs.mkdirSync(proj, { recursive: true });
const { install, tag } = stageSource(path.join(sb, 'src'), ROOT);
// A plain terminal: nothing inherited from a Claude Code session running this script (CLAUDE_CODE_SIMPLE is --bare).
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC_)/.test(k)));
const env = { ...clean, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', WESH_AUTOINDEX_MIN_FILES: '0', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_ERROR_REPORTING: '1' };
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|CLAUDE_CODE_SESSION)/.test(k)) delete env[k];
execFileSync(process.execPath, [install, '--home', home, '--project', proj, '--target', 'claude', '--level', 'ultra', ...installArgs],
  { env, cwd: proj, encoding: 'utf8' });
if (usePwsh) env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1';
// Records what every PostToolUse hook receives, so a tool's output shape can be read when a check fails.
const hookDump = path.join(sb, 'posttooluse-input.jsonl');
{
  const sf = path.join(home, '.claude', 'settings.json'), s = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : {};
  fs.mkdirSync(path.dirname(sf), { recursive: true });
  const dumper = path.join(sb, 'dump.mjs');
  fs.writeFileSync(dumper, `import fs from 'node:fs';\nlet i = '';\nprocess.stdin.on('data', c => (i += c)).on('end', () => fs.appendFileSync(${JSON.stringify(hookDump)}, i.replace(/\\n/g, ' ') + '\\n'));\n`);
  ((s.hooks ??= {}).PostToolUse ??= []).push({ matcher: '.*', hooks: [{ type: 'command', command: 'node', args: [dumper] }] });
  fs.writeFileSync(sf, JSON.stringify(s, null, 2));
}
// With CLAUDE_CONFIG_DIR, Claude Code reads its global config (user MCP servers) from inside that folder.
if (fs.existsSync(path.join(home, '.claude.json'))) fs.copyFileSync(path.join(home, '.claude.json'), path.join(home, '.claude', '.claude.json'));
const mcpFile = projectScope ? path.join(proj, '.mcp.json') : path.join(home, '.claude.json');
const cgBin = (() => { try { return JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers?.codegraph?.command || ''; } catch { return ''; } })();

fs.writeFileSync(path.join(proj, 'package.json'), '{ "name": "p", "private": true, "scripts": { "test": "node gen.js", "test:fail": "node gen.js fail" } }');
fs.writeFileSync(path.join(proj, 'gen.js'), "for (let i = 0; i < 500; i++) console.log('PASS src/f' + i + '.test.js (3 tests) ' + (i % 40) + 'ms');" +
  "console.log('WARN src/slow.test.js took 2100ms\\n    at src/slow.test.js:9:3\\nTests: 1500 passed');" +
  "if (process.argv[2] === 'fail') { console.log('FAIL src/billing.test.js\\n  AssertionError: expected 99 to be 100'); process.exitCode = 1; }");
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src', 'money.js'), '// Split cents into n shares.\nexport function splitCents(total, n) {\n  const share = Math.round(total / n);\n  return Array.from({ length: n }, () => share);\n}\n');
fs.writeFileSync(path.join(proj, 'src', 'invoice.js'), "import { splitCents } from './money.js';\nexport const invoiceLines = (t, payers) => splitCents(t, payers.length).map((cents, i) => ({ payer: payers[i], cents }));\n");
const indexReady = async () => { for (let i = 0; i < 1200 && !fs.existsSync(path.join(proj, '.codegraph', 'codegraph.db')); i++) await new Promise(r => setTimeout(r, 100)); };

// Mock Anthropic Messages API. Script: Bash `npm test` (passes, long), Bash `npm run test:fail` (fails, long),
// codegraph_explore once it is offered and the index exists, then "done".
const seen = [];
const text = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text ?? (b.content !== undefined ? text(b.content) : '')).join('\n') : '');
function reply(res, stream, block) {
  const msg = { id: `msg_${seen.length}`, type: 'message', role: 'assistant', model: 'claude-mock', content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } };
  const stop = block.type === 'tool_use' ? 'tool_use' : 'end_turn';
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...msg, content: [block], stop_reason: stop }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: msg });
  if (block.type === 'tool_use') {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: block.text } });
  }
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  ev('message_stop', {});
  res.end();
}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c)).on('end', async () => {
    if (!/\/v1\/messages(\?|$)/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(req.url.includes('count_tokens') ? '{"input_tokens":1}' : '{}'); }
    let j = {};
    try { j = JSON.parse(body || '{}'); } catch {}
    const tools = (j.tools || []).map(t => t.name);
    const msgs = j.messages || [];
    const uses = msgs.flatMap(m => (Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_use'));
    const results = msgs.flatMap(m => (Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result'))
      .map(b => ({ id: b.tool_use_id, error: !!b.is_error, text: text(b.content) }));
    seen.push({ tools, raw: j, system: text(j.system), firstUser: text(msgs[0]?.content), results, uses });
    const shell = usePwsh && tools.includes('PowerShell') ? 'PowerShell' : tools.includes('Bash') ? 'Bash' : tools.includes('PowerShell') ? 'PowerShell' : '';
    if (!shell) return reply(res, j.stream, { type: 'text', text: 'ok' }); // titles, summaries, other side requests
    const explore = tools.find(t => /codegraph_explore$/.test(t));
    const ran = cmd => uses.some(u => (u.input?.command || '') === cmd);
    const id = `toolu_${seen.length}`;
    if (!ran('npm test')) return reply(res, j.stream, { type: 'tool_use', id, name: shell, input: { command: 'npm test', description: 'Run tests' } });
    if (!ran('npm run test:fail')) return reply(res, j.stream, { type: 'tool_use', id, name: shell, input: { command: 'npm run test:fail', description: 'Run failing tests' } });
    if ((guard || pushControl) && !ran('git push origin main')) return reply(res, j.stream, { type: 'tool_use', id, name: shell, input: { command: 'git push origin main', description: 'Push' } });
    if (cgBin && explore && !uses.some(u => u.name === explore)) {
      await indexReady();
      return reply(res, j.stream, { type: 'tool_use', id, name: explore, input: { query: 'how does splitCents work and who calls it', projectPath: proj } });
    }
    return reply(res, j.stream, { type: 'text', text: 'done' });
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
env.ANTHROPIC_API_KEY = 'sk-ant-mock';

const version = execFileSync(bin, ['--version'], { env, encoding: 'utf8' }).trim();
const runOnce = () => new Promise((resolve, reject) => {
  // --guard: real permission rules, so the ask rule for git push is in force (no one is there to answer it).
  // Every git command is allowed: only the guard's ask rule can stop the push.
  const perms = guard || pushControl ? ['--allowedTools', 'Bash(npm test)', 'Bash(npm run test:fail)', 'Bash(git:*)'] : ['--dangerously-skip-permissions'];
  const p = spawn(bin, ['-p', 'run the tests', '--output-format', 'json', '--model', 'claude-sonnet-5-5', ...perms],
    { cwd: proj, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '';
  p.stdout.on('data', c => (o += c)); p.stderr.on('data', c => (o += c));
  const t = setTimeout(() => { p.kill(); reject(new Error('claude -p timed out')); }, 300000);
  p.on('exit', () => { clearTimeout(t); resolve(o); });
});
const out = await runOnce();
// --e2e-twice: an edit made while no session ran must be in the index after the next session starts, unasked.
let synced = null;
if (twice && cgBin) {
  await indexReady();
  for (let i = 0; i < 120 && fs.readdirSync(os.tmpdir()).some(f => /^wesh-autoindex-.*\.lock$/.test(f) && Date.now() - fs.statSync(path.join(os.tmpdir(), f)).mtimeMs < 60000); i++)
    await new Promise(r => setTimeout(r, 500)); // the first build has finished
  fs.appendFileSync(path.join(proj, 'src', 'money.js'), '\nexport function addedBetweenSessions() { return 1; }\n');
  await runOnce();
  const q = () => { try { return execFileSync(cgBin, ['query', 'addedBetweenSessions'], { cwd: proj, encoding: 'utf8', shell: process.platform === 'win32' }); } catch { return ''; } };
  synced = false;
  for (let i = 0; i < 60 && !synced; i++) { synced = /money\.js/.test(q()); if (!synced) await new Promise(r => setTimeout(r, 1000)); }
}
server.close();

const main = seen.find(s => s.tools.includes('Bash') || s.tools.includes('PowerShell')) || {};
const last = seen.filter(s => s.results?.length).at(-1) || { results: [] };
const resultOf = cmd => { const u = (last.uses || []).find(x => x.input?.command === cmd); return (last.results || []).find(r => r.id === u?.id) || {}; };
const pass = resultOf('npm test'), fail = resultOf('npm run test:fail');
const exploreUse = (last.uses || []).find(u => /codegraph_explore$/.test(u.name));
const explored = (last.results || []).find(r => r.id === exploreUse?.id)?.text || '';
const everything = JSON.stringify(main.raw || {});
// Skills and agents as Claude Code lists them to the model: "- wesh-tdd: <description>".
// Only entries carrying this run's tag count: the real ~/.claude/skills is visible too (see stageSource).
const listed = name => new RegExp(`- ${name}: (?:(?!\\\\n).){0,700}?\\[${tag}\\]`).test(everything);
// On Windows Claude Code finds the real home folder through the OS, so the real ~/.claude/CLAUDE.md is loaded too:
// rule checks read only the sandbox's own memory block.
const memories = [...everything.matchAll(/Contents of (.+?) \((?:user|project)[^)]*\):([\s\S]*?)(?=Contents of |<\/system-reminder>|$)/g)];
const sandboxMemory = memories.filter(m => m[1].replace(/\\\\/g, '\\').toLowerCase().startsWith(sb.toLowerCase())).map(m => m[2]).join('\n');
const scoutViaOsHome = !listed('wesh-scout') && process.platform === 'win32' && !projectScope && /- wesh-scout: /.test(everything)
  && fs.existsSync(path.join(os.homedir(), '.claude', 'agents', 'wesh-scout.md'));
const realLedger = (() => { try { return fs.readFileSync(path.join(os.homedir(), '.claude', 'wesh', 'autoindex.log'), 'utf8'); } catch { return ''; } })();
fs.writeFileSync(path.join(sb, 'first-request.json'), JSON.stringify(main.raw ?? null, null, 2));
fs.writeFileSync(path.join(sb, 'last-request.json'), JSON.stringify(last.raw ?? null, null, 2));
fs.writeFileSync(path.join(sb, 'claude-output.txt'), out);
const checks = [
  ['mock received requests (no real model used)', seen.length > 0],
  ['core rules loaded from the installed CLAUDE.md', /lazy senior dev, pay every token/.test(sandboxMemory)],
  ['installed level is the one in effect', /Level: `ultra`/.test(sandboxMemory)],
  ['5 auto skills listed', ['wesh-commit', 'wesh-debug', 'wesh-refactor', 'wesh-review', 'wesh-tdd'].every(listed)],
  ['5 slash-only skills not offered to the model', !['wesh-level', 'wesh-plan', 'wesh-handoff', 'wesh-slim', 'wesh-debt'].some(listed)],
  // In user scope Claude Code on Windows reads agents from the OS home's ~/.claude/agents, not CLAUDE_CONFIG_DIR (skills it reads from the sandbox).
  scoutViaOsHome ? ['wesh-scout offered as subagent (Windows user scope: read from the real ~/.claude/agents)', true]
    : ['wesh-scout offered as subagent', listed('wesh-scout')],
  ['your real hooks never ran in the sandbox', !realLedger.includes(sb) && (cgBin || !fs.existsSync(path.join(proj, '.codegraph')))],
  ['code graph rules present exactly when codegraph is on', /## Code graph/.test(sandboxMemory) === !!cgBin],
  squeezeOn ? ['passing long npm test squeezed by the hook', /\[wesh squeeze: /.test(pass.text || '')]
    : ['--no-squeeze: output left whole', !/\[wesh squeeze: /.test(pass.text || '') && /PASS src\/f499/.test(pass.text || '')],
  ...(guard ? [['--guard: git push is stopped, never run', (() => { const r = resultOf('git push origin main'); return !!r.id && r.error && !/fatal|not a git repository/i.test(r.text); })()]] : []),
  ...(pushControl ? [['control: without --guard the same git push runs', /fatal|not a git repository/i.test(resultOf('git push origin main').text || '')]] : []),
  ['signal lines kept', ['WARN src/slow.test.js', 'src/slow.test.js:9:3', 'Tests: 1500 passed'].every(s => (pass.text || '').includes(s))],
  ['failing run arrives intact (PostToolUseFailure cannot replace it)', /expected 99 to be 100/.test(fail.text || '')],
  ...(cgBin ? [
    ['session-start hook told the model the graph is being built', /building this repo's code graph/.test(everything)],
    ['project indexed automatically by wesh', fs.existsSync(path.join(proj, '.codegraph', 'codegraph.db'))],
    ['codegraph_explore offered to the model', seen.some(s => s.tools.some(t => /codegraph_explore$/.test(t)))],
    ['codegraph answered from the index (source + caller)', /splitCents/.test(explored) && /invoiceLines|invoice\.js/.test(explored)],
    ...(twice ? [['second session: an edit made between sessions is in the index', synced === true]] : []),
  ] : []),
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
console.log(`tool used: ${(last.uses || []).find(u => u.input?.command === 'npm test')?.name || 'none'}`);
console.log(`Claude Code ${version}; ${seen.length} model requests; failing-run squeezed: ${/\[wesh squeeze: /.test(fail.text || '')}`);
console.log(`sandbox (requests saved as first-request.json / last-request.json): ${sb}`);
const passed = checks.every(c => c[1]);
// A passing sandbox is deleted (set WESH_E2E_KEEP=1 to keep it); a failing one stays for inspection.
if (passed && process.env.WESH_E2E_KEEP !== '1') { try { fs.rmSync(sb, { recursive: true, force: true }); } catch { console.log(`could not delete ${sb} (a process still has it open)`); } }
process.exit(passed ? 0 : 1);
