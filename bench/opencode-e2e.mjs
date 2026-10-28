// Stress test 7: real OpenCode, end to end, against a local mock model (no API key, nothing leaves the machine).
// node bench/opencode-e2e.mjs <path-to-opencode-binary> [extra install flags, e.g. --target opencode]
// Sandboxed: HOME/XDG point at a temp dir; the mock records exactly what OpenCode sends to the model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageSource } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bin, ...argv] = process.argv.slice(2);
// Harness options (not passed to the installer): --e2e-uninstall installs then uninstalls, then checks OpenCode sees no
// wesh at all; --e2e-twice edits a source file and opens a second session, which must bring the index up to date.
const uninstalled = argv.includes('--e2e-uninstall'), twice = argv.includes('--e2e-twice');
const installArgs = argv.filter(a => !a.startsWith('--e2e-'));
if (!bin) { console.error('usage: node bench/opencode-e2e.mjs <opencode binary> [install flags]'); process.exit(2); }

// Long-form temp path: codegraph 1.6.2's Windows file watcher crashes on 8.3 short names (C:\Users\ABCDEF~1\...).
const sb = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wesh-oc-'));
const home = path.join(sb, 'home'), proj = path.join(sb, 'proj');
fs.mkdirSync(proj, { recursive: true });
const { install, tag } = stageSource(path.join(sb, 'src'), ROOT);
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(sb, 'data'),
  XDG_CACHE_HOME: path.join(sb, 'cache'), XDG_STATE_HOME: path.join(sb, 'state'), OPENCODE_DISABLE_AUTOUPDATE: '1', PWD: proj, WESH_AUTOINDEX_MIN_FILES: '0' };
// --project always points at the sandbox, so a --scope project run can never write into the current folder.
execFileSync(process.execPath, [install, '--home', home, '--project', proj, '--level', 'ultra', ...installArgs], { env });
if (uninstalled) execFileSync(process.execPath, [install, '--home', home, '--project', proj, ...installArgs, '--uninstall'], { env });
// codegraph checks run whenever the install wired codegraph (plain install with codegraph on PATH, or --codegraph-cli).
// User scope writes ~/.config/opencode/opencode.json, project scope <project>/opencode.json.
const ocCfgs = [path.join(home, '.config', 'opencode', 'opencode.json'), path.join(proj, 'opencode.json')]
  .map(f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } });
const cgBin = ocCfgs.map(c => (c.mcp?.servers?.codegraph || c.mcp?.codegraph)?.command?.[0]).find(Boolean) || '';
if (cgBin) {
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'money.js'), '// Split cents into n shares.\nexport function splitCents(total, n) {\n  const share = Math.round(total / n);\n  return Array.from({ length: n }, () => share);\n}\n');
  fs.writeFileSync(path.join(proj, 'src', 'invoice.js'), "import { splitCents } from './money.js';\nexport const invoiceLines = (t, payers) => splitCents(t, payers.length).map((cents, i) => ({ payer: payers[i], cents }));\n");
  // No `codegraph init` here: wesh's OpenCode plugin must build the index by itself when OpenCode opens the project.
}
const indexReady = async () => { for (let i = 0; i < 900 && !fs.existsSync(path.join(proj, '.codegraph', 'codegraph.db')); i++) await new Promise(r => setTimeout(r, 100)); };

// Mock OpenAI-compatible model: asks for `npm test`, then answers "done".
const seen = [];
const sse = (res, chunks) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', ...c })}\n\n`);
  res.end('data: [DONE]\n\n');
};
const say = (res, t) => sse(res, [{ choices: [{ index: 0, delta: { role: 'assistant', content: t } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }]);
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c)).on('end', async () => {
    const j = JSON.parse(body || '{}');
    const tools = (j.tools || []).map(t => t.function?.name);
    const shell = tools.find(t => t === 'bash' || t === 'shell'); // V1 names it bash; V2 may name it shell
    const explore = tools.find(t => /codegraph_explore$/.test(t || ''));
    const toolMsgs = (j.messages || []).filter(m => m.role === 'tool');
    const tool = toolMsgs.at(-1);
    seen.push({ tools, raw: j, tasks: (j.tools || []).filter(t => /^(task|subagent)$/.test(t.function?.name)).map(t => t.function.description).join('\n'),
      allResults: toolMsgs.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))),
      skillTool: (j.tools || []).find(t => t.function?.name === 'skill')?.function?.description || '',
      system: (j.messages || []).filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'),
      result: !tool ? '' : typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content) });
    if (!shell) return say(res, 'title');
// Script: codegraph_explore as soon as it is offered (OpenCode 2 connects MCP servers after its first request in a
    // one-shot `run`), shell `npm test` once, then done. While the MCP server is still connecting the shell runs
    // again: the tools of a request are fixed, so explore can only be called from a later request.
    const called = re => (j.messages || []).some(m => (m.tool_calls || []).some(tc => re.test(tc.function?.name || '')));
    const shellCalls = (j.messages || []).filter(m => (m.tool_calls || []).some(tc => /^(bash|shell)$/.test(tc.function?.name || ''))).length;
    if (cgBin && !explore && shellCalls < 4) await new Promise(r => setTimeout(r, 1500)); // wait for the MCP server
    const next = cgBin && explore && !called(/codegraph_explore$/) ? [explore, { query: 'how does splitCents work and who calls it', projectPath: proj }]
      : !called(/^(bash|shell)$/) || (cgBin && !explore && shellCalls < 4) ? [shell, { command: 'npm test', description: 'Run tests' }] : null;
    if (!next) return say(res, 'done');
    if (/codegraph_explore$/.test(next[0])) await indexReady();
    sse(res, [{ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${toolMsgs.length + 1}`, type: 'function',
      function: { name: next[0], arguments: JSON.stringify(next[1]) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }]);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

// Point OpenCode at the mock (merged into whatever config wesh wrote).
const cfgFile = path.join(home, '.config', 'opencode', 'opencode.json');
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
Object.assign(cfg, { model: 'mock/m', small_model: 'mock/m', provider: { mock: { npm: '@ai-sdk/openai-compatible', name: 'Mock',
  options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'x' }, models: { m: { name: 'm', tool_call: true } } } } });
fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
fs.writeFileSync(path.join(proj, 'package.json'), '{ "name": "p", "private": true, "scripts": { "test": "node gen.js" } }');
fs.writeFileSync(path.join(proj, 'gen.js'), "for (let i = 0; i < 500; i++) console.log('PASS src/f' + i + '.test.js (3 tests) ' + (i % 40) + 'ms');" +
  "console.log('FAIL src/billing.test.js\\n  AssertionError: expected 99 to be 100\\n    at src/billing.test.js:14:30\\nTests: 1 failed, 1500 passed'); process.exitCode = 1;");

// OpenCode 2 runs a shared background service by default; --standalone keeps a private server for this run only.
const version = execFileSync(bin, ['--version'], { env, encoding: 'utf8' }).trim();
const v2 = /^v?([2-9]|\d{2,})\./.test(version.replace(/^opencode\s+/, ''));
const runOnce = () => new Promise((resolve, reject) => {
  const p = spawn(bin, ['run', ...(v2 ? ['--standalone'] : []), 'run the tests'], { cwd: proj, env, stdio: 'ignore' });
  const t = setTimeout(() => { p.kill(); reject(new Error('opencode run timed out')); }, 180000);
  p.on('exit', () => { clearTimeout(t); resolve(); });
});
await runOnce();
// Second session after an edit made while no OpenCode ran: the index must catch up with no one asking.
let synced = null;
if (twice && cgBin) {
  fs.appendFileSync(path.join(proj, 'src', 'money.js'), '\nexport function addedBetweenSessions() { return 1; }\n');
  await runOnce();
  const q = () => { try { return execFileSync(cgBin, ['query', 'addedBetweenSessions'], { cwd: proj, encoding: 'utf8', shell: process.platform === 'win32' }); } catch { return ''; } };
  synced = false;
  for (let i = 0; i < 60 && !synced; i++) { synced = /money\.js/.test(q()); if (!synced) await new Promise(r => setTimeout(r, 1000)); }
}
server.close();

const main = seen.find(s => s.tools.some(t => t === 'bash' || t === 'shell') && !s.result.trim()) || {};
const last = seen.filter(s => s.allResults?.length).at(-1) || {};
const after = { result: (last.allResults || []).find(r => /> node gen\.js/.test(r)) || (last.allResults || []).find(r => /squeeze|PASS src|FAIL src/.test(r)) || last.result || '' };
fs.writeFileSync(path.join(sb, 'first-request.json'), JSON.stringify(main.raw ?? null, null, 2)); // for inspection
fs.writeFileSync(path.join(sb, 'last-request.json'), JSON.stringify(seen.at(-1)?.raw ?? null, null, 2)); // the MCP server is connected by now
fs.writeFileSync(path.join(sb, 'requests.json'), JSON.stringify(seen.map(s => ({ tools: s.tools, results: (s.allResults || []).map(r => r.slice(0, 200)) })), null, 2));
// Skill list: V1 uses <name>…</name> in the system prompt; otherwise look in the skill tool description.
const tagged = [...(main.system || '').matchAll(/<name>(wesh[\w-]*)<\/name>/g)].map(m => m[1]);
const listed = (tagged.length ? tagged
  : [...(main.skillTool || '').matchAll(/\bwesh(?:-[a-z]+)?\b/g)].map(m => m[0])).filter((v, i, a) => a.indexOf(v) === i).sort();
const everything = JSON.stringify(seen.map(s => s.raw));
// Only entries carrying this run's tag count: on Windows the real ~/.claude/skills is visible too (see stageSource).
// V2 lists skills as <name>x</name><description>…</description>, agents as "- x: …"; the tag ends the description.
const mainText = JSON.stringify(main.raw || {});
// With the Claude fallback (wesh installed for both hosts) OpenCode reads skills from ~/.claude/skills of the home it
// resolves itself; on Windows that is always the real home, so this run's tagged copies cannot be seen there: the
// check then accepts the untagged entries of the real ~/.claude/skills and says so.
const viaOsHome = process.platform === 'win32' && fs.existsSync(path.join(home, '.claude', 'skills', 'wesh-debug'))
  && !fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'wesh-debug')) && !fs.existsSync(path.join(proj, '.opencode', 'skills', 'wesh-debug'));
const fromRealHome = name => viaOsHome && new RegExp(`<name>${name}</name>`).test(mainText) && fs.existsSync(path.join(os.homedir(), '.claude', 'skills', name));
const fromInstall = name => fromRealHome(name) || new RegExp(`(<name>${name}</name>(\\\\n|\\s)*<description>|- ${name}: )(?:(?!\\\\n)[^<]){0,700}?\\[${tag}\\]`).test(mainText);
const checks = uninstalled ? [
  ['mock received requests (no real model used)', seen.length > 0],
  ['after uninstall: no core rules', !/lazy senior dev/.test(everything)],
  ['after uninstall: no skill, agent or command from this install', !everything.includes(`[${tag}]`)],
  ['after uninstall: no squeeze plugin', !/\[wesh squeeze: /.test(everything)],
  ['after uninstall: no level line from this install', !/Level: `ultra`/.test(everything)],
  ['after uninstall: no codegraph tool', !seen.some(s => s.tools?.some(t => /codegraph/.test(t || '')))],
] : [
  ['mock received requests (no real model used)', seen.length > 0],
  ['core rules in system prompt', /lazy senior dev, pay every token/.test(main.system || '')],
  ['installed level is the one in effect', /Level: `ultra`/.test(main.system || '')],
  ['code graph present exactly when installed (no leak from your real config)',
    seen.some(s => s.tools?.some(t => /codegraph_explore$/.test(t || ''))) === !!cgBin && /## Code graph/.test(main.system || '') === !!cgBin],
  [`5 auto skills listed (${viaOsHome ? 'Windows + Claude fallback: read from the real ~/.claude/skills' : 'from this install'})`, ['wesh-commit', 'wesh-debug', 'wesh-refactor', 'wesh-review', 'wesh-tdd'].every(fromInstall)],
  ['5 slash-only skills hidden', !['wesh-level', 'wesh-plan', 'wesh-handoff', 'wesh-slim', 'wesh-debt'].some(fromInstall)],
  ['wesh-scout offered as subagent (from this install)', fromInstall('wesh-scout')],
  ['bash output squeezed by the plugin', /\[wesh squeeze: /.test(after.result || '')],
  ['failure lines kept', ['expected 99 to be 100', 'billing.test.js:14:30', 'Tests: 1 failed'].every(s => (after.result || '').includes(s))],
  ...(cgBin ? [
    ['project indexed automatically by wesh', fs.existsSync(path.join(proj, '.codegraph', 'codegraph.db'))],
    ['codegraph_explore offered to the model', seen.some(s => s.tools?.some(t => /codegraph_explore$/.test(t || '')))],
    ['codegraph answered from the index (source + caller)', (last.allResults || []).some(r => /splitCents/.test(r) && /money\.js/.test(r) && /invoiceLines|invoice\.js/.test(r))],
    ['codegraph rule in system prompt', /## Code graph/.test(main.system || '')],
    ...(twice ? [['second session: an edit made between sessions is in the index', synced === true]] : []),
  ] : []),
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
console.log(`${version}; skills seen: ${listed.join(', ') || 'none'}`);
console.log(`sandbox (first request saved as first-request.json): ${sb}`);
const passed = checks.every(c => c[1]);
// A passing sandbox is deleted (set WESH_E2E_KEEP=1 to keep it); a failing one stays for inspection.
if (passed && process.env.WESH_E2E_KEEP !== '1') { try { fs.rmSync(sb, { recursive: true, force: true }); } catch { console.log(`could not delete ${sb} (a process still has it open)`); } }
process.exit(passed ? 0 : 1);
