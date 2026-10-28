// P0 backlog: the shell-output squeezer (S1: command classification) and the OpenCode plugin
// (S5: squeeze the full output, not the preview).
// node --test bench/squeeze-p0.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import { ROOT, tmp, installedPlugin } from './backlog-helpers.mjs';
// The test projects are tiny: let the auto-index treat them as real projects (production skips repos under 200 files).
process.env.WESH_AUTOINDEX_MIN_FILES = '0';

test('S1: a search whose pattern names a tool is payload, not noise', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks/squeeze.mjs')).href);
  const hits = Array.from({ length: 300 }, (_, i) => `src/file${i}.py:12:    result = pytest_case(${i})`).join('\n');
  for (const command of ['grep -rn "pytest" .', 'rg -n make', 'ls -la && make -n', 'git grep -n pytest', 'find . -name "*.ts"']) {
    const r = squeeze(hits, { command, id: 'test' });
    assert.equal(r.changed, false, `${command} must pass untouched`);
    assert.equal(r.text, hits, `${command} output unchanged`);
  }
});

test('S1: real build and test commands still squeeze', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks/squeeze.mjs')).href);
  const noise = Array.from({ length: 300 }, (_, i) => `npm http fetch GET 200 https://registry.npmjs.org/pkg-${i} ${20 + i}ms (cache hit)`).join('\n');
  for (const command of ['npm install', 'npx vitest run', 'pytest -v', 'cargo build', 'make', 'npx tsc --noEmit', 'sudo npm install', 'npx jest -- --grep foo']) {
    const r = squeeze(noise, { command, id: 'test' });
    assert.equal(r.changed, true, `${command} must squeeze`);
  }
});

test('S2: a timestamp is not a signal, but file:line:col is', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks/squeeze.mjs')).href);
  const logs = Array.from({ length: 300 }, (_, i) => `2026-01-09T12:${String(i % 60).padStart(2, '0')}:11Z app-${i % 4} | request handled in ${i % 90}ms`).join('\n');
  const r = squeeze(logs, { command: 'docker compose logs', id: 'test' });
  assert.equal(r.changed, true, 'timestamped logs compress');
  assert.ok(r.text.length < logs.length / 5, 'and shrink a lot');
  const withPos = Array.from({ length: 300 }, (_, i) => `at src/a.ts:${i + 10}:30 in handler`).join('\n');
  const r2 = squeeze(withPos, { command: 'npm test', id: 'test' });
  assert.ok(r2.text.includes('src/a.ts:10:30'), 'file:line:col stays');
});

test('S3: deprecated packages are noise; real warnings and errors stay', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks/squeeze.mjs')).href);
  const out = Array.from({ length: 200 }, (_, i) => `npm WARN deprecated pkg-${i}@1.0.0: no longer supported`).join('\n')
    + '\nnpm WARN config production Use `npm ci --omit=dev`\nERROR build failed\n';
  const r = squeeze(out, { command: 'npm install', id: 'test' });
  assert.equal(r.changed, true);
  assert.ok(r.text.includes('npm WARN config production'), 'a real warning stays');
  assert.ok(r.text.includes('ERROR build failed'), 'an error stays');
  assert.ok(r.text.length < out.length / 2, 'the deprecation spam collapses');
});

test('S6: saving the raw output can be turned off', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks/squeeze.mjs')).href);
  const out = Array.from({ length: 400 }, (_, i) => `npm http fetch GET 200 https://registry.npmjs.org/pkg-${i} ${20 + i}ms (cache hit)`).join('\n');
  process.env.WESH_SQUEEZE_SAVE = '0';
  try {
    const r = squeeze(out, { command: 'npm install', id: 'nosave' });
    assert.equal(r.changed, true);
    assert.match(r.text, /Full output not saved \(WESH_SQUEEZE_SAVE=0\)/);
    assert.doesNotMatch(r.text, /Full output: /, 'no file is offered');
  } finally { delete process.env.WESH_SQUEEZE_SAVE; }
});

test('S5: OpenCode preview text is expanded to the full output it points at', async () => {
  const home = tmp();
  const { default: plugin } = await import(installedPlugin(home));
  const work = tmp();
  const full = path.join(work, 'shell.out');
  const lines = Array.from({ length: 4000 }, (_, i) => `step ${i} running`);
  lines[3] = 'FAIL  src/billing/split.test.ts > splitBill > keeps the total exact';
  fs.writeFileSync(full, lines.join('\n') + '\n');
  const preview = `[showing lines 1-100 of 4000; full output saved to ${full}]\n` + lines.slice(0, 100).join('\n');
  const hooks = {};
  await plugin.setup({ tool: { hook: async (name, fn) => { hooks[name] = fn; return { dispose: async () => {} }; } } });
  const ev = { tool: 'bash', status: 'completed', id: 'c1', input: { command: 'npm test' }, result: { content: preview } };
  hooks['execute.after'](ev);
  const out = typeof ev.result.content === 'string' ? ev.result.content : ev.result.content[0].text;
  assert.ok(out.includes('FAIL  src/billing/split.test.ts'), 'the early failure survives');
  assert.match(out, /Full output: .*shell\.out/, 'the note points at the full output file');
  assert.doesNotMatch(out, /wesh-squeeze/, 'no partial copy of the preview is written');
});

test('S5: the OpenCode 1 marker ("Full output saved to:") is understood too', async () => {
  const home = tmp();
  const { default: plugin } = await import(installedPlugin(home));
  const work = tmp();
  const full = path.join(work, 'shell.out');
  const lines = Array.from({ length: 4000 }, (_, i) => `step ${i} running`);
  lines[2] = 'FAIL  src/order.test.js > order total';
  fs.writeFileSync(full, lines.join('\n') + '\n');
  const preview = `Full output saved to: ${full}\n` + lines.slice(0, 100).join('\n');
  const hooks = await plugin.server({});
  const o = { title: '', output: preview, metadata: {} };
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: 's', callID: 'c1', args: { command: 'npm test' } }, o);
  assert.ok(o.output.includes('FAIL  src/order.test.js'), 'the early failure survives');
  assert.match(o.output, /Full output: .*shell\.out/, 'the note points at the full output file');
});
