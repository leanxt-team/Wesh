// Stress test 8: real OpenCode session, scripted model, measured request sizes, with and without wesh.
// node bench/opencode-session.mjs <opencode binary> [cycles=1,5]
// The same scripted agent (grep, read, failing npm test, edit, passing npm test, npm run build, repeat) runs in three
// sandboxed arms: no wesh, wesh, wesh --no-squeeze. A local mock model records every request OpenCode builds, so
// overhead and squeeze are measured on the real prompt; behaviour changes (fewer turns, less code) are not, because the
// script is identical in every arm. Prices: Opus 5.5 $4/$20 per MTok, cache read $0.20, cache write 1.25x input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tokens, TOKENIZER, table } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bin, cyclesArg = '1,5', realLogs] = process.argv.slice(2); // realLogs: dir with test-fail.txt, test-pass.txt, build.txt
if (!bin) { console.error('usage: node bench/opencode-session.mjs <opencode binary> [cycles, e.g. 1,5]'); process.exit(2); }
const version = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
const v2 = /^v?([2-9]|\d{2,})\./.test(version.replace(/^opencode\s+/, ''));
const P = { in: 4, out: 20, read: 0.2 };

function project(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'shop', private: true, scripts: { test: 'node test.js', build: 'node build.js' } }));
  fs.writeFileSync(path.join(dir, 'src', 'money.js'), '// Split an amount of cents into n shares.\n// rev 0\nexport function splitCents(total, n) {\n  const share = Math.round(total / n);\n  return Array.from({ length: n }, () => share);\n}\n');
  fs.writeFileSync(path.join(dir, 'src', 'invoice.js'), "import { splitCents } from './money.js';\nexport const invoiceLines = (t, payers) => splitCents(t, payers.length).map((cents, i) => ({ payer: payers[i], cents }));\n");
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, 'src', `feature${i}.js`), Array.from({ length: 60 }, (_, k) => `export const f${i}_${k} = (x) => x * ${k} + ${i};`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'test.js'), "const fs = require('fs');\nfor (let i = 0; i < 400; i++) console.log('PASS src/feature' + i + '.test.js (3 tests) ' + (i % 37) + 'ms');\n" +
    "if (fs.readFileSync('src/money.js', 'utf8').includes('Math.round(total / n)')) {\n  console.log('FAIL src/invoice.test.js > splitCents keeps the total');\n  console.log('  AssertionError: expected 9999 to be 10000');\n  console.log('    at src/invoice.test.js:12:31');\n  console.log('Tests: 1 failed, 1200 passed');\n  process.exit(1);\n}\nconsole.log('Tests: 1201 passed');\n");
  fs.writeFileSync(path.join(dir, 'build.js'), "for (let i = 0; i < 300; i++) console.log('asset chunk-' + i + '.js ' + (i % 90 + 3) + '.' + (i % 10) + ' KiB [emitted] [minimized] (name: chunk-' + i + ')');\nconsole.log('webpack 5.97.1 compiled successfully in 2345 ms');\n");
  if (realLogs) { // replay real captured logs instead of the synthetic ones
    for (const f of ['test-fail.txt', 'test-pass.txt', 'build.txt']) fs.copyFileSync(path.join(realLogs, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'test.js'), "const fs = require('fs');\nconst bad = fs.readFileSync('src/money.js', 'utf8').includes('Math.round(total / n)');\nprocess.stdout.write(fs.readFileSync(bad ? 'test-fail.txt' : 'test-pass.txt', 'utf8'));\nprocess.exit(bad ? 1 : 0);\n");
    fs.writeFileSync(path.join(dir, 'build.js'), "process.stdout.write(require('fs').readFileSync('build.txt', 'utf8'));\n");
  }
}

function steps(cycles) {
  const s = [['grep', { pattern: 'splitCents' }], ['read', { path: 'src/money.js' }]];
  for (let c = 0; c < cycles; c++) {
    s.push(['shell', { command: 'npm test' }]);
    s.push(['edit', c === 0
      ? { path: 'src/money.js', oldString: '  const share = Math.round(total / n);\n  return Array.from({ length: n }, () => share);', newString: '  const share = Math.floor(total / n);\n  const rest = total - share * n;\n  return Array.from({ length: n }, (_, i) => share + (i < rest ? 1 : 0));' }
      : { path: 'src/money.js', oldString: `// rev ${c - 1}`, newString: `// rev ${c}` }]);
    s.push(['shell', { command: 'npm test' }]);
    s.push(['shell', { command: 'npm run build' }]);
  }
  return s;
}

async function arm(name, installArgs, cycles) {
  const sb = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), `wesh-sess-${name}-`));
  const home = path.join(sb, 'home'), proj = path.join(sb, 'proj');
  project(proj);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(sb, 'data'),
    // On Windows OpenCode reads ~/.claude from the real home, whatever HOME says: keep a real wesh install out of every arm.
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    XDG_CACHE_HOME: path.join(sb, 'cache'), XDG_STATE_HOME: path.join(sb, 'state'), OPENCODE_DISABLE_AUTOUPDATE: '1' };
  if (installArgs) execFileSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--home', home, '--project', proj, ...installArgs], { env });
  const plan = steps(cycles), requests = [];
  const sse = (res, delta, finish) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c)).on('end', () => {
      const j = JSON.parse(body || '{}');
      const names = (j.tools || []).map(t => t.function?.name);
      const shell = names.find(n => n === 'bash' || n === 'shell');
      if (!shell) return sse(res, { role: 'assistant', content: 'title' }, 'stop');
      const done = (j.messages || []).filter(m => m.role === 'tool');
      const sys = (j.messages || []).filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      requests.push({ total: tokens(JSON.stringify({ messages: j.messages, tools: j.tools })), system: tokens(sys), tools: tokens(JSON.stringify(j.tools || [])),
        toolResults: done.reduce((a, m) => a + tokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0) });
      const next = plan[done.length];
      if (!next) return sse(res, { role: 'assistant', content: 'Fixed: splitCents now hands out the remainder. Tests pass.' }, 'stop');
      const toolName = next[0] === 'shell' ? shell : next[0];
      const args = next[0] === 'read' && !names.includes('read') ? next[1] : next[1];
      sse(res, { role: 'assistant', tool_calls: [{ index: 0, id: `call_${done.length}`, type: 'function', function: { name: toolName, arguments: JSON.stringify(v2 ? args : v1Args(next[0], args)) } }] }, 'tool_calls');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const cfgFile = path.join(home, '.config', 'opencode', 'opencode.json');
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  Object.assign(cfg, { model: 'mock/m', small_model: 'mock/m', provider: { mock: { npm: '@ai-sdk/openai-compatible', name: 'Mock',
    options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'x' }, models: { m: { name: 'm', tool_call: true } } } } });
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await new Promise((resolve, reject) => {
    const p = spawn(bin, ['run', ...(v2 ? ['--standalone'] : []), 'Accounting says 100.00 split 3 ways gives 99.99. Fix it.'], { cwd: proj, env, stdio: 'ignore' });
    const t = setTimeout(() => { p.kill(); reject(new Error(`${name}: opencode run timed out`)); }, 300000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
  });
  server.close();
  const fixed = !fs.readFileSync(path.join(proj, 'src', 'money.js'), 'utf8').includes('Math.round(total / n)');
  return { name, requests, fixed, expected: plan.length + 1 };
}
// OpenCode 1 argument names (filePath, oldString, newString).
const v1Args = (tool, a) => (tool === 'read' ? { filePath: a.path } : tool === 'edit' ? { filePath: a.path, oldString: a.oldString, newString: a.newString } : a);

function cost(reqs) { // each request re-reads the previous one from cache and writes only what is new
  let c = 0, prev = 0;
  for (const r of reqs) { c += prev * P.read + Math.max(0, r.total - prev) * P.in * 1.25 + 150 * P.out; prev = r.total; }
  return c / 1e6;
}

let md = `# OpenCode session benchmark (${version}, ${TOKENIZER}, ${realLogs ? 'real captured logs' : 'synthetic logs'})\n\n`;
for (const cycles of cyclesArg.split(',').map(Number)) {
  const arms = [];
  for (const [name, args] of [['no wesh', null], ['wesh', ['--level', 'full']], ['wesh, no squeeze', ['--level', 'full', '--no-squeeze']]]) arms.push(await arm(name, args, cycles));
  const base = arms[0];
  const rows = [['arm', 'requests', 'fix applied', 'first request', 'system prompt', 'tool results (last req)', 'tokens sent (sum)', 'cost $', 'vs no wesh']];
  for (const a of arms) {
    const r = a.requests, sum = r.reduce((x, y) => x + y.total, 0), c = cost(r), d = (c / cost(base.requests) - 1) * 100;
    rows.push([a.name, `${r.length}/${a.expected}`, a.fixed ? 'yes' : 'NO', r[0]?.total ?? 0, r[0]?.system ?? 0, r.at(-1)?.toolResults ?? 0,
      sum.toLocaleString('en'), c.toFixed(4), `${d > 0 ? '+' : ''}${d.toFixed(1)}%`]);
  }
  md += `## ${cycles} fix/test/build cycle(s): grep, read, then ${cycles} x (npm test, edit, npm test, npm run build)\n\n${table(rows)}\n\n`;
}
md += 'Same scripted agent in every arm: this isolates what wesh changes mechanically (rules and skill overhead, squeezed\n' +
  'tool output). Behaviour gains (fewer turns, less code) are not in these numbers.\n';
console.log(md);
fs.mkdirSync(path.join(ROOT, 'bench', 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench', 'results', `opencode-session-${version.replace(/[^\w.]+/g, '-')}${realLogs ? '-real-logs' : ''}.md`), md);
