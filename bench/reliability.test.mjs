// Stress test 3: skill validity and installer safety. node --test bench/reliability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findSkills, parseSkill } from './lib.mjs';
// The test projects are tiny: let the auto-index treat them as real projects (production skips repos under 200 files).
process.env.WESH_AUTOINDEX_MIN_FILES = '0';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(ROOT, 'install.mjs');
const skills = findSkills(path.join(ROOT, 'skills'));
const names = skills.map(s => s.front.name);

const run = (args, env = {}) => execFileSync(process.execPath, [INSTALL, ...args],
  { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '', OPENCODE_DISABLE_CLAUDE_CODE: '', OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: '', WESH_NO_NPM: '1', WESH_CODEGRAPH: '0', ...env } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wesh-test-'));
const read = f => fs.readFileSync(f, 'utf8');
const snapshot = dir => {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = read(p);
  } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
};

test('every skill is valid for Claude Code and OpenCode', () => {
  assert.ok(skills.length >= 8);
  for (const s of skills) {
    const dir = path.basename(path.dirname(s.file));
    assert.ok(s.ok, `${dir}: frontmatter`);
    assert.match(s.front.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${dir}: OpenCode name rule`);
    assert.equal(s.front.name, dir, `${dir}: name must match directory`);
    assert.ok(s.front.description && s.front.description.length <= 1024, `${dir}: description 1..1024 chars`);
    assert.ok(s.body.trim().length > 100, `${dir}: body`);
  }
  assert.equal(new Set(names).size, names.length, 'unique names');
});

test('no name collides with Claude Code built-ins', () => {
  for (const n of ['code-review', 'simplify', 'init', 'review', 'security-review', 'loop', 'debug'])
    assert.ok(!names.includes(n), n);
});

test('every wesh-* reference points at a shipped skill or agent', () => {
  const known = new Set([...names, 'wesh-scout']);
  const files = [path.join(ROOT, 'core', 'CORE.md'), ...skills.map(s => s.file)];
  for (const f of files) for (const [ref] of read(f).matchAll(/wesh-[a-z]+/g))
    if (!['wesh-handoff-', 'wesh-bak'].some(x => ref.startsWith(x)) && !/wesh-debt\.md/i.test(ref))
      assert.ok(known.has(ref) || ref === 'wesh-bak', `${path.basename(f)} references unknown ${ref}`);
});

test('model-invocable descriptions stay short (listing cost)', () => {
  for (const s of skills.filter(s => s.front['disable-model-invocation'] !== 'true'))
    assert.ok(s.front.description.length <= 260, `${s.front.name}: ${s.front.description.length} chars`);
});

test('install both: files land, user content survives, OpenCode is not duplicated', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# my rules\nKeep me.\n');
  run(['--home', home, '--target', 'both']);
  const md = read(path.join(home, '.claude', 'CLAUDE.md'));
  assert.match(md, /^# my rules\nKeep me\./);
  assert.match(md, /wesh:begin[\s\S]*Smallest complete change[\s\S]*wesh:end/);
  for (const n of names) assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', n, 'SKILL.md')), n);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'wesh-scout.md')));
  const oc = path.join(home, '.config', 'opencode');
  assert.ok(!fs.existsSync(path.join(oc, 'skills')), 'OpenCode reads ~/.claude/skills; no copy');
  const cfg = JSON.parse(read(path.join(oc, 'opencode.json')));
  assert.equal(cfg.instructions.length, 1, 'core via instructions: OpenCode 2 has no CLAUDE.md fallback');
  assert.match(read(cfg.instructions[0]), /Smallest complete change/);
  for (const n of ['wesh-level', 'wesh-plan', 'wesh-handoff', 'wesh-slim', 'wesh-debt']) assert.equal(cfg.permission.skill[n], 'deny', n);
  assert.equal(cfg.permission.skill['wesh-debug'], undefined);
  const agent = read(path.join(oc, 'agents', 'wesh-scout.md'));
  assert.match(agent, /mode: subagent/);
  assert.doesNotMatch(agent, /^tools:|^model:/m);
  const cmd = read(path.join(oc, 'commands', 'wesh-handoff.md'));
  assert.match(cmd, /^---\ndescription: ".+"\n---\n/);
  assert.match(cmd, /wesh-handoff-<yyyymmdd-hhmm>\.md/, 'skill text inlined');
  assert.match(cmd, /\$ARGUMENTS/);
  assert.doesNotMatch(cmd, /name: wesh-handoff|disable-model-invocation/);
  const settings = JSON.parse(read(path.join(home, '.claude', 'settings.json')));
  assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /claude-squeeze\.mjs/);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'wesh', 'squeeze.mjs')));
  assert.ok(fs.existsSync(path.join(oc, 'plugins', 'wesh-squeeze.js')));
  assert.ok(fs.existsSync(path.join(oc, 'wesh', 'squeeze.mjs')));
});

test('an upgrade takes the skills wesh shipped under an old name away', () => {
  const home = tmp();
  run(['--home', home, '--target', 'both']);
  const claudeSkills = path.join(home, '.claude', 'skills');
  const oc = path.join(home, '.config', 'opencode');
  const cfgFile = path.join(oc, 'opencode.json');
  // an older wesh installed these names, and wrote the deny rules itself
  for (const d of [path.join(claudeSkills, 'wesh'), path.join(oc, 'skills', 'wesh'), path.join(oc, 'skills', 'wesh-compress')]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), 'old\n');
  }
  for (const n of ['wesh', 'wesh-compress']) fs.writeFileSync(path.join(oc, 'commands', `${n}.md`), 'old\n');
  const cfg = JSON.parse(read(cfgFile));
  cfg.permission.skill.wesh = 'deny';
  cfg.permission.skill['wesh-compress'] = 'deny';
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  for (const dir of [path.join(home, '.claude', 'wesh'), path.join(oc, 'wesh')]) {
    const f = path.join(dir, 'state.json');
    const s = JSON.parse(read(f));
    s.options.skills = [...new Set([...(s.options.skills || []), 'wesh', 'wesh-compress'])];
    const ocFile = s.files['opencode.json'];
    if (ocFile) ocFile.added['permission.skill'] = [...new Set([...(ocFile.added['permission.skill'] || []), 'wesh', 'wesh-compress'])];
    fs.writeFileSync(f, JSON.stringify(s, null, 2));
  }
  run(['--home', home, '--target', 'both']);
  for (const d of [path.join(claudeSkills, 'wesh'), path.join(oc, 'skills', 'wesh'), path.join(oc, 'skills', 'wesh-compress')])
    assert.ok(!fs.existsSync(d), `${d}: the old skill is gone`);
  for (const n of ['wesh', 'wesh-compress']) assert.ok(!fs.existsSync(path.join(oc, 'commands', `${n}.md`)), `${n}: the old command is gone`);
  const after = JSON.parse(read(cfgFile));
  assert.equal(after.permission.skill.wesh, undefined, 'the deny rule wesh added is gone');
  assert.equal(after.permission.skill['wesh-compress'], undefined, 'and the other one too');
  for (const n of ['wesh-level', 'wesh-plan', 'wesh-handoff', 'wesh-slim', 'wesh-debt']) assert.equal(after.permission.skill[n], 'deny', n);
  const st = JSON.parse(read(path.join(oc, 'wesh', 'state.json')));
  assert.ok(!st.options.skills.includes('wesh') && !st.options.skills.includes('wesh-compress'), 'the old names are off the list');
});

test('a skill folder of your own with an old wesh name is left alone', () => {
  const home = tmp();
  run(['--home', home, '--target', 'both']);
  const mine = path.join(home, '.claude', 'skills', 'wesh');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), 'mine\n');
  run(['--home', home, '--target', 'both']);
  assert.ok(fs.existsSync(path.join(mine, 'SKILL.md')), 'not in the install state: untouched');
});

test('an OpenCode copy of a skill that became slash-only is removed on upgrade', () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  const oc = path.join(home, '.config', 'opencode');
  // a copy an older wesh made before wesh-plan became slash-only
  const stale = path.join(oc, 'skills', 'wesh-plan');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'SKILL.md'), 'old copy\n');
  run(['--home', home, '--target', 'opencode']);
  assert.ok(!fs.existsSync(stale), 'the stale copy is gone');
  assert.ok(fs.existsSync(path.join(oc, 'commands', 'wesh-plan.md')), 'the command carries the skill now');
});

test('core lets host/harness reporting instructions win over the voice', () => {
  assert.match(read(path.join(ROOT, 'core', 'CORE.md')), /harness[^\n]*(win over|beat) this voice/i);
});

test('--scout-model pins the OpenCode scout; bad values are rejected', () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode', '--scout-model', 'anthropic/claude-haiku-5-5']);
  assert.match(read(path.join(home, '.config', 'opencode', 'agents', 'wesh-scout.md')), /^model: anthropic\/claude-haiku-5-5$/m);
  assert.throws(() => run(['--home', tmp(), '--scout-model', 'haiku']));
});

test('the OpenCode scout is read-only: everything denied, then the read tools back', () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode', '--scout-model', 'anthropic/claude-haiku-5-5']);
  const agent = read(path.join(home, '.config', 'opencode', 'agents', 'wesh-scout.md'));
  assert.match(agent, /^permission:\n {2}"\*": deny$/m, 'deny by default');
  for (const tool of ['read', 'glob', 'grep']) assert.match(agent, new RegExp(`^ {2}${tool}: allow$`, 'm'), `${tool} allowed`);
  for (const tool of ['edit', 'bash', 'webfetch', 'websearch', 'task', 'question']) {
    assert.doesNotMatch(agent, new RegExp(`^ {2}${tool}: allow$`, 'm'), `${tool} stays denied`);
  }
});

test('the scout runs on a cheap model, and does not claim to be cheap without one', () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  const agent = read(path.join(home, '.config', 'opencode', 'agents', 'wesh-scout.md'));
  assert.doesNotMatch(agent, /^model:/m, 'no model: the scout inherits the caller');
  assert.doesNotMatch(agent, /^description: Cheap /m, 'no cheap claim without a cheap model');
  const home2 = tmp();
  const cfg = path.join(home2, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ small_model: 'ollama/qwen3.5:0.8b' }));
  run(['--home', home2, '--target', 'opencode']);
  const agent2 = read(path.join(home2, '.config', 'opencode', 'agents', 'wesh-scout.md'));
  assert.match(agent2, /^model: ollama\/qwen3\.5:0\.8b$/m, 'small_model is used');
  assert.match(agent2, /^description: Cheap /m, 'and it is cheap');
  run(['--home', home2, '--target', 'opencode']); // a second install keeps the model it chose
  assert.match(read(path.join(home2, '.config', 'opencode', 'agents', 'wesh-scout.md')), /^model: ollama\/qwen3\.5:0\.8b$/m);
});

test('one caller-finding rule everywhere: the CLI after a sync, grep as the floor', () => {
  for (const f of ['core/CODEGRAPH.md', 'skills/wesh-debug/SKILL.md', 'skills/wesh-review/SKILL.md', 'skills/wesh-refactor/SKILL.md']) {
    const t = read(path.join(ROOT, f));
    assert.match(t, /codegraph (callers|impact)/, `${f}: the CLI finds the callers`);
    assert.match(t, /codegraph sync/, `${f}: the index is synced first`);
  }
});

test('the rules do not look for a folder: they ask codegraph', () => {
  for (const f of ['core/CODEGRAPH.md', 'skills/wesh-plan/SKILL.md', 'skills/wesh-review/SKILL.md', 'skills/wesh-refactor/SKILL.md']) {
    assert.doesNotMatch(read(path.join(ROOT, f)), /repo has `\.codegraph\/`/, `${f}: no literal folder check`);
  }
  assert.match(read(path.join(ROOT, 'hooks/autoindex.mjs')), /projectPath/, 'the note tells the agent how to reach the index');
});

test('codegraph\'s own guidance block is not duplicated', () => {
  const home = tmp();
  const rules = path.join(home, '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(rules), { recursive: true });
  fs.writeFileSync(rules, '<!-- CODEGRAPH_START -->\ncodegraph rules\n<!-- CODEGRAPH_END -->\n');
  run(['--home', home, '--target', 'claude', '--codegraph-cli', fakeCodegraph().bin]);
  const text = read(rules);
  assert.equal((text.match(/## Code graph/g) || []).length, 0, 'no second copy of the code graph rules');
  assert.match(text, /lazy senior dev/, 'the rest of the rules are there');
});

test('uninstall removes the skills an older wesh installed under another name', () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  const state = path.join(home, '.config', 'opencode', 'wesh', 'state.json');
  const s = JSON.parse(read(state));
  s.options.skills = [...(s.options.skills || []), 'wesh-old-name'];
  fs.writeFileSync(state, JSON.stringify(s, null, 2));
  const old = path.join(home, '.config', 'opencode', 'skills', 'wesh-old-name');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'SKILL.md'), '---\nname: wesh-old-name\ndescription: old\n---\n');
  run(['--home', home, '--target', 'opencode', '--uninstall']);
  assert.ok(!fs.existsSync(old), 'the old skill is gone');
});

test('the skills keep their files private and find the markers everywhere', () => {
  const handoff = read(path.join(ROOT, 'skills/wesh-handoff/SKILL.md'));
  assert.match(handoff, /mode 600/, 'the handoff file is private');
  assert.match(handoff, /~\/\.cache\/wesh/, 'and lands in a private folder');
  const debt = read(path.join(ROOT, 'skills/wesh-debt/SKILL.md'));
  for (const marker of ['<!--', 'REM', ';', '%']) assert.ok(debt.includes(marker), `debt finds ${marker} comments`);
  assert.match(read(path.join(ROOT, 'skills/wesh-level/SKILL.md')), /compaction drops them/, 'the level rule says what compaction does');
});

test('--no-squeeze installs no hook or plugin', () => {
  const home = tmp();
  run(['--home', home, '--no-squeeze']);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')));
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'wesh', 'claude-squeeze.mjs')));
  assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode', 'plugins')));
});

test('squeeze and guard are remembered: turning them off takes them away again', () => {
  const home = tmp();
  const readJson = f => (fs.existsSync(f) ? JSON.parse(read(f)) : {});
  run(['--home', home, '--target', 'both', '--guard']);
  const settings = path.join(home, '.claude', 'settings.json');
  const ocCfg = path.join(home, '.config', 'opencode', 'opencode.json');
  assert.ok(readJson(settings).hooks?.PostToolUse?.length, 'squeeze hook installed');
  assert.ok(readJson(settings).permissions?.ask?.length, 'guard rules installed');
  assert.ok(readJson(ocCfg).permission?.bash?.['git push*'], 'opencode guard installed');
  run(['--home', home, '--target', 'both', '--no-squeeze', '--no-guard']);
  const s = readJson(settings);
  assert.equal((s.hooks?.PostToolUse || []).filter(h => /claude-squeeze/.test(JSON.stringify(h))).length, 0, 'squeeze hook gone');
  assert.equal((s.permissions?.ask || []).filter(r => /git push/.test(r)).length, 0, 'claude guard gone');
  const c = readJson(ocCfg);
  assert.equal(c.permission?.bash?.['git push*'], undefined, 'opencode guard gone');
  assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode', 'plugins', 'wesh-squeeze.js')), 'squeeze plugin gone');
  // and a plain re-install keeps them off
  run(['--home', home, '--target', 'both']);
  assert.equal((readJson(settings).hooks?.PostToolUse || []).length, 0, 'still no squeeze hook');
  assert.equal(readJson(ocCfg).permission?.bash?.['git push*'], undefined, 'still no guard');
});

test('installed Claude hook squeezes long Bash output and keeps the shape', async () => {
  const home = tmp();
  run(['--home', home, '--target', 'claude']);
  const { default: FIX } = await import('./squeeze-fixtures.mjs');
  const f = FIX.find(x => x.name.startsWith('pytest'));
  const ev = { tool_name: 'Bash', tool_use_id: 'toolu_test', tool_input: { command: f.command },
    tool_response: { stdout: f.text, stderr: '', interrupted: false, isImage: false } };
  const out = JSON.parse(execFileSync(process.execPath, [path.join(home, '.claude', 'wesh', 'claude-squeeze.mjs')], { input: JSON.stringify(ev), encoding: 'utf8' }));
  const u = out.hookSpecificOutput.updatedToolOutput;
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.deepEqual(Object.keys(u).sort(), ['interrupted', 'isImage', 'stderr', 'stdout']);
  assert.ok(u.stdout.length < f.text.length / 5);
  for (const m of f.must) assert.ok(u.stdout.includes(m), m);
  const saved = u.stdout.match(/Full output: (.+?\.log)/)[1];
  assert.equal(read(saved), f.text, 'raw output saved losslessly');
  const small = execFileSync(process.execPath, [path.join(home, '.claude', 'wesh', 'claude-squeeze.mjs')],
    { input: JSON.stringify({ ...ev, tool_response: { ...ev.tool_response, stdout: 'ok\n' } }), encoding: 'utf8' });
  assert.equal(small, '', 'small output: no replacement');
  const raw = execFileSync(process.execPath, [path.join(home, '.claude', 'wesh', 'claude-squeeze.mjs')],
    { input: JSON.stringify({ ...ev, tool_input: { command: 'WESH_RAW=1 pytest -v' } }), encoding: 'utf8' });
  assert.equal(raw, '', 'WESH_RAW bypass');
});

test('installed OpenCode plugin squeezes bash output only', async () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  const { default: plugin } = await import(pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'wesh-squeeze.js')).href);
  const hooks = await plugin.server({});
  const { default: FIX } = await import('./squeeze-fixtures.mjs');
  const f = FIX.find(x => x.name.startsWith('cargo'));
  const o = { title: '', output: f.text, metadata: {} };
  await hooks['tool.execute.after']({ tool: 'bash', sessionID: 's', callID: 'c1', args: { command: f.command } }, o);
  assert.ok(o.output.length < f.text.length / 5);
  for (const m of f.must) assert.ok(o.output.includes(m), m);
  const r = { title: '', output: f.text, metadata: {} };
  await hooks['tool.execute.after']({ tool: 'read', sessionID: 's', callID: 'c2', args: {} }, r);
  assert.equal(r.output, f.text, 'non-bash tools untouched');
});

test('installed OpenCode plugin exposes the V2 API (default { id, setup } + tool execute.after)', async () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  const mod = await import(pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'wesh-squeeze.js')).href);
  assert.deepEqual(Object.keys(mod), ['default'], 'one default export serves both APIs');
  assert.equal(mod.default.id, 'wesh-squeeze');
  assert.equal(typeof mod.default.server, 'function', 'OpenCode 1 entry');
  await mod.default.setup({}); // OpenCode 1 preview context without tool hooks: no throw
  const hooks = {};
  await mod.default.setup({ tool: { hook: async (name, fn) => { hooks[name] = fn; return { dispose: async () => {} }; } } });
  const { default: FIX } = await import('./squeeze-fixtures.mjs');
  const f = FIX.find(x => x.name.startsWith('jest'));
  for (const [tool, content] of [['bash', f.text], ['shell', [{ type: 'text', text: f.text }]]]) {
    const ev = { tool, status: 'completed', id: 'c', input: { command: f.command }, result: { content, metadata: { exit: 1 } } };
    hooks['execute.after'](ev);
    const out = typeof ev.result.content === 'string' ? ev.result.content : ev.result.content[0].text;
    assert.ok(out.length < f.text.length / 5, `${tool} squeezed`);
    for (const m of f.must) assert.ok(out.includes(m), `${tool}: ${m}`);
    assert.deepEqual(ev.result.metadata, { exit: 1 }, 'other result fields kept');
  }
  const err = { tool: 'bash', status: 'error', error: { message: 'x' }, input: { command: f.command } };
  hooks['execute.after'](err);
  assert.equal(err.result, undefined, 'errors untouched');
  const read1 = { tool: 'read', status: 'completed', input: {}, result: { content: f.text } };
  hooks['execute.after'](read1);
  assert.equal(read1.result.content, f.text, 'non-shell tools untouched');
});

test('squeeze keeps every needed line on all fixtures; leaves payload and small output alone', async () => {
  const { squeeze } = await import('../hooks/squeeze.mjs');
  const { default: FIX } = await import('./squeeze-fixtures.mjs');
  for (const f of FIX) {
    const r = squeeze(f.text, { command: f.command, id: 'test' });
    for (const m of f.must) assert.ok(r.text.includes(m), `${f.name}: ${m}`);
    if (f.untouched) assert.equal(r.text, f.text, f.name);
  }
  assert.equal(squeeze('x\n'.repeat(5000), { command: 'git diff' }).changed, false, 'git diff is payload');
});

test('install is idempotent', () => {
  const home = tmp();
  run(['--home', home, '--guard']);
  const a = snapshot(home);
  run(['--home', home, '--guard']);
  assert.deepEqual(snapshot(home), a);
});

test('level flag is written into the core block', () => {
  const home = tmp();
  run(['--home', home, '--target', 'claude', '--level', 'ultra']);
  assert.match(read(path.join(home, '.claude', 'CLAUDE.md')), /Level: `ultra`/);
});

test('opencode-only: skills copied, core added via instructions, existing config kept', () => {
  const home = tmp();
  const oc = path.join(home, '.config', 'opencode');
  fs.mkdirSync(oc, { recursive: true });
  fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({ model: 'anthropic/claude-opus-5-5', instructions: ['x.md'] }));
  run(['--home', home, '--target', 'opencode', '--guard']);
  const cfg = JSON.parse(read(path.join(oc, 'opencode.json')));
  assert.equal(cfg.model, 'anthropic/claude-opus-5-5');
  assert.equal(cfg.instructions[0], 'x.md');
  assert.ok(cfg.instructions.some(i => i.endsWith(path.join('wesh', 'CORE.md'))));
  assert.equal(cfg.permission.bash['git push*'], 'ask');
  assert.match(read(path.join(oc, 'wesh', 'CORE.md')), /Smallest complete change/);
  assert.doesNotMatch(read(path.join(oc, 'wesh', 'CORE.md')), /wesh:begin/);
  for (const n of names) assert.equal(fs.existsSync(path.join(oc, 'skills', n, 'SKILL.md')),
    !['wesh-level', 'wesh-plan', 'wesh-handoff', 'wesh-slim', 'wesh-debt'].includes(n), `${n}: only model skills copied`);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'claude untouched');
});

test('both, but OpenCode has its own AGENTS.md: core added to OpenCode too', () => {
  const home = tmp();
  const oc = path.join(home, '.config', 'opencode');
  fs.mkdirSync(oc, { recursive: true });
  fs.writeFileSync(path.join(oc, 'AGENTS.md'), '# oc rules\n');
  run(['--home', home]);
  assert.ok(JSON.parse(read(path.join(oc, 'opencode.json'))).instructions.length === 1);
  assert.equal(read(path.join(oc, 'AGENTS.md')), '# oc rules\n', 'AGENTS.md untouched');
});

test('OPENCODE_DISABLE_CLAUDE_CODE: skills copied for OpenCode', () => {
  const home = tmp();
  run(['--home', home], { OPENCODE_DISABLE_CLAUDE_CODE: '1' });
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'wesh-debug', 'SKILL.md')));
});

test('JSONC opencode.json is never rewritten', () => {
  const home = tmp();
  const f = path.join(home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const jsonc = '{\n  // my comment\n  "model": "x/y",\n}\n';
  fs.writeFileSync(f, jsonc);
  const out = run(['--home', home, '--target', 'opencode']);
  assert.equal(read(f), jsonc);
  assert.match(out, /by hand/);
});

// Regression tests from the independent review.
const writeJson = (f, o, indent = 2) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, indent) + '\n'); };

test('uninstall keeps guard rules the user already had', () => {
  const home = tmp();
  const cs = path.join(home, '.claude', 'settings.json'), oc = path.join(home, '.config', 'opencode', 'opencode.json');
  writeJson(cs, { permissions: { ask: ['Bash(git push:*)'] } });
  writeJson(oc, { permission: { bash: { 'git push*': 'ask' } } });
  run(['--home', home, '--guard']);
  run(['--home', home, '--uninstall']);
  assert.deepEqual(JSON.parse(read(cs)), { permissions: { ask: ['Bash(git push:*)'] } });
  assert.deepEqual(JSON.parse(read(oc)), { permission: { bash: { 'git push*': 'ask' } } });
});

test('uninstall is byte-exact: indent, empty containers, CLAUDE.md spacing and code fences', () => {
  const home = tmp();
  const cs = path.join(home, '.claude', 'settings.json'), md = path.join(home, '.claude', 'CLAUDE.md');
  writeJson(cs, { permissions: { deny: [] }, env: {} }, 4);
  fs.writeFileSync(md, '\n  Indented first line\n```\na\n\n\n\nb\n```\n');
  const before = [read(cs), read(md)];
  run(['--home', home, '--guard']);
  run(['--home', home, '--uninstall']);
  assert.deepEqual([read(cs), read(md)], before);
});

test('the pre-wesh backup is never overwritten, even by uninstall', () => {
  const home = tmp();
  const cs = path.join(home, '.claude', 'settings.json');
  writeJson(cs, { model: 'orig' });
  const orig = read(cs);
  run(['--home', home, '--target', 'claude', '--guard']);
  run(['--home', home, '--target', 'claude', '--level', 'lite']);
  run(['--home', home, '--target', 'claude', '--uninstall']);
  assert.equal(read(cs + '.wesh-bak'), orig);
  assert.equal(read(cs), orig);
});

test('no stale backup is ever restored', () => {
  const home = tmp();
  const cs = path.join(home, '.claude', 'settings.json');
  writeJson(cs, { model: 'old' });
  run(['--home', home, '--target', 'claude']);
  run(['--home', home, '--target', 'claude', '--uninstall']);
  writeJson(cs, {});
  run(['--home', home, '--target', 'claude']);
  run(['--home', home, '--target', 'claude', '--uninstall']);
  assert.deepEqual(JSON.parse(read(cs)), {});
});

test('unexpected config shapes: no crash, file untouched, manual instruction printed', () => {
  const home = tmp();
  const cs = path.join(home, '.claude', 'settings.json'), oc = path.join(home, '.config', 'opencode', 'opencode.json');
  writeJson(cs, { hooks: { PostToolUse: {} } });
  writeJson(oc, { permission: 'allow' });
  const out = run(['--home', home, '--guard']);
  assert.equal(JSON.parse(read(oc)).permission, 'allow', 'odd permission value untouched');
  assert.deepEqual(JSON.parse(read(cs)).hooks, { PostToolUse: {} }, 'odd hooks value untouched');
  assert.ok(JSON.parse(read(cs)).permissions.ask.includes('Bash(git push:*)'), 'the compatible guard edit still applies');
  assert.match(out, /unexpected type[\s\S]*by hand/);
});

test('settings.json with a UTF-8 BOM is accepted', () => {
  const home = tmp();
  const cs = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(cs), { recursive: true });
  fs.writeFileSync(cs, '﻿{"model":"x"}');
  run(['--home', home, '--target', 'claude']);
  const s = JSON.parse(read(cs));
  assert.equal(s.model, 'x');
  assert.ok(s.hooks.PostToolUse.length === 1);
});

test('--home wins over XDG_CONFIG_HOME', () => {
  const home = tmp(), xdg = tmp();
  run(['--home', home], { XDG_CONFIG_HOME: xdg });
  assert.deepEqual(fs.readdirSync(xdg), []);
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'agents', 'wesh-scout.md')));
});

test('uninstall leaves foreign wesh-* skills alone', () => {
  const home = tmp();
  const mine = path.join(home, '.claude', 'skills', 'wesh-deploy', 'SKILL.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, '---\nname: wesh-deploy\ndescription: mine\n---\n');
  run(['--home', home]);
  run(['--home', home, '--uninstall']);
  assert.ok(fs.existsSync(mine));
});

test('OpenCode guard does not weaken a deny-by-default bash policy', () => {
  const home = tmp();
  const oc = path.join(home, '.config', 'opencode', 'opencode.json');
  writeJson(oc, { permission: { bash: { '*': 'deny' } } });
  run(['--home', home, '--target', 'opencode', '--guard']);
  assert.deepEqual(JSON.parse(read(oc)).permission.bash, { '*': 'deny' });
});

test('missing end marker: no second block, user text never deleted', () => {
  const home = tmp();
  const md = path.join(home, '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(md), { recursive: true });
  const text = '# mine\n<!-- wesh:begin (managed by wesh/install.mjs; edit the level line only) -->\nold\n# important user text\n';
  fs.writeFileSync(md, text);
  run(['--home', home, '--target', 'claude']);
  run(['--home', home, '--target', 'claude', '--uninstall']);
  assert.equal(read(md), text);
});

test('uninstall still works after the home folder moved (state is not keyed by absolute path)', () => {
  const a = tmp(), b = a + '-moved';
  writeJson(path.join(a, '.config', 'opencode', 'opencode.json'), { model: 'x/y' });
  run(['--home', a, '--target', 'opencode', '--guard']);
  fs.renameSync(a, b);
  run(['--home', b, '--target', 'opencode', '--uninstall']);
  assert.deepEqual(JSON.parse(read(path.join(b, '.config', 'opencode', 'opencode.json'))), { model: 'x/y' });
});

// codegraph: a fake CLI records its calls, so these tests never download or run the real one.
function fakeCodegraph({ build = true, syncFails = false } = {}) { // init creates .codegraph/ (unless build: false); uninit --force <dir> removes it
  const dir = tmp(), logf = path.join(dir, 'calls.log');
  const bin = process.platform === 'win32' ? path.join(dir, 'codegraph.cmd') : path.join(dir, 'codegraph');
  const status = 'if [ "$1" = "status" ]; then if [ -d .codegraph ]; then echo \'{"initialized":true,"lastIndexed":"2026-01-01T00:00:00.000Z","fileCount":1,"pendingChanges":{"added":0,"modified":0,"removed":0},"index":{"state":"complete"}}\'; else echo \'{"initialized":false,"lastIndexed":null}\'; fi; exit 0; fi';
  const telemetry = 'if [ "$1" = "telemetry" ] && [ "$2" = "status" ]; then echo "Telemetry: enabled (your saved choice)"; exit 0; fi';
  fs.writeFileSync(bin, process.platform === 'win32'
    ? `@echo off\r\necho %*>> "${logf}"\r\nif "%1"=="--version" echo 1.6.2\r\n${build ? 'if "%1"=="init" mkdir .codegraph\r\n' : 'if "%1"=="init" ping -n 4 127.0.0.1 >nul\r\n'}if "%1"=="uninit" rmdir /s /q "%~3\\.codegraph"\r\nif "%1"=="status" (if exist .codegraph (echo {"initialized":true,"lastIndexed":"2026-01-01T00:00:00.000Z","fileCount":1,"pendingChanges":{"added":0,"modified":0,"removed":0},"index":{"state":"complete"}}) else (echo {"initialized":false,"lastIndexed":null}))\r\nif "%1"=="telemetry" if "%2"=="status" echo Telemetry: enabled\r\n${syncFails ? 'if "%1"=="sync" exit /b 1\r\n' : ''}exit /b 0\r\n`
    : `#!/bin/sh\necho "$*" >> "${logf}"\n[ "$1" = "--version" ] && echo 1.6.2\n${build ? '[ "$1" = "init" ] && mkdir .codegraph\n' : '[ "$1" = "init" ] && sleep 3\n'}[ "$1" = "uninit" ] && rm -rf "$3/.codegraph"\n${status}\n${telemetry}\n${syncFails ? '[ "$1" = "sync" ] && exit 1\n' : ''}exit 0\n`, { mode: 0o755 });
  return { dir, bin, calls: () => (fs.existsSync(logf) ? read(logf) : '') };
}
const waitFor = async (f, ms = 15000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 100)); } return true; };
const project = () => { const d = tmp(); fs.writeFileSync(path.join(d, 'package.json'), '{}'); return d; };
const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';

test('codegraph is on by default: a plain install finds codegraph on PATH and wires it', () => {
  const home = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--opencode-version', '2'], { WESH_CODEGRAPH: '', [pathKey]: cg.dir + path.delimiter + process.env[pathKey] });
  assert.match(cg.calls(), /telemetry off/);
  assert.equal(JSON.parse(read(path.join(home, '.claude.json'))).mcpServers.codegraph.command, 'codegraph');
  const s = JSON.parse(read(path.join(home, '.claude', 'settings.json')));
  assert.ok(s.hooks.SessionStart.some(h => /claude-autoindex\.mjs/.test(h.hooks[0].command)), 'session-start auto-index hook');
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'plugins', 'wesh-codegraph.js')), 'OpenCode auto-index plugin');
  assert.deepEqual(JSON.parse(read(path.join(home, '.claude', 'wesh', 'codegraph.json'))), { cmd: 'codegraph', node: process.execPath });
});

test('auto-index: real projects only, never home/root, one build at a time, opt-out', async () => {
  const { autoIndex } = await import('../hooks/autoindex.mjs');
  const cg = fakeCodegraph(), slow = fakeCodegraph({ build: false }), ledger = path.join(tmp(), 'log');
  const proj = project();
  assert.equal(autoIndex(proj, { cmd: cg.bin, ledger }), 'started');
  assert.ok(await waitFor(() => fs.existsSync(path.join(proj, '.codegraph'))), 'index built in the background');
  assert.equal(autoIndex(proj, { cmd: cg.bin, ledger }), 'indexed');
  assert.ok(await waitFor(() => read(ledger).trim() === fs.realpathSync.native(proj)), 'the ledger names the root once the index is done');
  assert.equal(autoIndex(tmp(), { cmd: cg.bin, ledger }), 'not-a-project', 'no project marker');
  assert.equal(autoIndex(os.homedir(), { cmd: cg.bin, ledger }), 'not-a-project');
  assert.equal(autoIndex(path.parse(process.cwd()).root, { cmd: cg.bin, ledger }), 'not-a-project');
  const p2 = project();
  assert.equal(autoIndex(p2, { cmd: slow.bin, ledger }), 'started');
  assert.equal(autoIndex(p2, { cmd: slow.bin, ledger }), 'building', 'second session does not start a second build');
  process.env.WESH_AUTOINDEX = '0';
  try { assert.equal(autoIndex(project(), { cmd: cg.bin, ledger }), 'off'); } finally { delete process.env.WESH_AUTOINDEX; }
});

test('a huge repository is left to the user', async () => {
  const { autoIndex } = await import('../hooks/autoindex.mjs');
  const cg = fakeCodegraph(), ledger = path.join(tmp(), 'log');
  const proj = project();
  const old = process.env.WESH_AUTOINDEX_MAX_FILES;
  process.env.WESH_AUTOINDEX_MAX_FILES = '0';
  try {
    assert.equal(autoIndex(proj, { cmd: cg.bin, ledger }), 'too-big', 'not indexed without a say');
    process.env.WESH_AUTOINDEX_FORCE = '1';
    assert.equal(autoIndex(proj, { cmd: cg.bin, ledger }), 'started', 'unless forced');
  } finally {
    delete process.env.WESH_AUTOINDEX_FORCE;
    if (old === undefined) delete process.env.WESH_AUTOINDEX_MAX_FILES; else process.env.WESH_AUTOINDEX_MAX_FILES = old;
  }
});

test('Claude session-start hook and OpenCode plugin index the project; uninstall removes those indexes', async () => {
  const home = tmp(), cg = fakeCodegraph(), projA = project(), projB = project();
  run(['--home', home, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  const out = execFileSync(process.execPath, [path.join(home, '.claude', 'wesh', 'claude-autoindex.mjs')], { input: JSON.stringify({ cwd: projA }), encoding: 'utf8' });
  assert.match(out, /building this repo's code graph/);
  assert.ok(await waitFor(() => fs.existsSync(path.join(projA, '.codegraph'))));
  assert.equal(execFileSync(process.execPath, [path.join(home, '.claude', 'wesh', 'claude-autoindex.mjs')], { input: JSON.stringify({ cwd: projA }), encoding: 'utf8' }), '', 'already indexed: silent');
  const { default: plugin } = await import(pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'wesh-codegraph.js')).href);
  await plugin.setup({ location: { directory: projB } });
  assert.ok(await waitFor(() => fs.existsSync(path.join(projB, '.codegraph'))), 'OpenCode 2 plugin');
  assert.equal(typeof (await plugin.server({ directory: projB })).event, 'function', 'OpenCode 1 entry');
  const mine = project(); fs.mkdirSync(path.join(mine, '.codegraph')); // an index the user built: never touched
  run(['--home', home, '--uninstall']);
  assert.ok(!fs.existsSync(path.join(projA, '.codegraph')) && !fs.existsSync(path.join(projB, '.codegraph')), 'wesh-built indexes removed');
  assert.ok(fs.existsSync(path.join(mine, '.codegraph')), 'user index kept');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')), 'hooks and permissions gone');
});

test('the install gives the user their telemetry setting back', () => {
  const home = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--codegraph-cli', cg.bin]);
  assert.match(cg.calls(), /telemetry off/, 'telemetry is off while wesh is installed');
  const state = JSON.parse(read(path.join(home, '.config', 'opencode', 'wesh', 'state.json')));
  assert.equal(state.options.telemetry, 'enabled', 'the previous setting is remembered');
  run(['--home', home, '--codegraph-cli', cg.bin, '--uninstall']);
  assert.match(cg.calls(), /telemetry on/, 'and given back on uninstall');
});

test('npm -g is never run without a terminal, and an old codegraph warns', () => {
  const home = tmp();
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const out = run(['--home', home], { [pathKey]: '/nonexistent', WESH_NO_NPM: '', WESH_CODEGRAPH: '' });
  assert.match(out, /Install it yourself/, 'no silent global install');
  const cg = fakeCodegraph();
  fs.writeFileSync(cg.bin, fs.readFileSync(cg.bin, 'utf8').replace('echo 1.6.2', 'echo 1.7.0'));
  const out2 = run(['--home', tmp(), '--codegraph-cli', cg.bin]);
  assert.match(out2, /tested with 1\.6\.x/, 'an unsupported version warns');
});

test('on OpenCode 1 with the Claude fallback the rules are not loaded twice', () => {
  const home = tmp();
  run(['--home', home, '--target', 'both', '--opencode-version', '1']);
  const oc = JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json')));
  assert.equal((oc.instructions || []).length, 0, 'no second copy in OpenCode');
  assert.match(read(path.join(home, '.claude', 'CLAUDE.md')), /lazy senior dev/, 'the rules are in CLAUDE.md');
});

test('--codegraph wires both hosts, turns telemetry off, and adds the rules and scout tool', () => {
  const home = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  assert.match(cg.calls(), /telemetry off/);
  const cj = JSON.parse(read(path.join(home, '.claude.json')));
  assert.deepEqual(cj.mcpServers.codegraph, { type: 'stdio', command: cg.bin, args: ['serve', '--mcp'], alwaysLoad: true, env: { CODEGRAPH_TELEMETRY: '0' } });
  assert.ok(JSON.parse(read(path.join(home, '.claude', 'settings.json'))).permissions.allow.includes('mcp__codegraph__*'));
  assert.match(read(path.join(home, '.claude', 'CLAUDE.md')), /## Code graph[\s\S]*codegraph_explore[\s\S]*wesh:end/);
  assert.match(read(path.join(home, '.claude', 'agents', 'wesh-scout.md')), /^tools: Read, Glob, Grep, mcp__codegraph__codegraph_explore$/m);
  const oc = JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json')));
  assert.deepEqual(oc.mcp.servers.codegraph, { type: 'local', command: [cg.bin, 'serve', '--mcp'], disabled: false, codemode: false, environment: { CODEGRAPH_TELEMETRY: '0' } });
  assert.match(read(path.join(home, '.config', 'opencode', 'wesh', 'CORE.md')), /## Code graph/);
});

test('--codegraph writes the OpenCode 1 MCP shape for OpenCode 1', () => {
  const home = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--target', 'opencode', '--codegraph-cli', cg.bin, '--opencode-version', '1']);
  const oc = JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json')));
  assert.deepEqual(oc.mcp, { codegraph: { type: 'local', command: [cg.bin, 'serve', '--mcp'], enabled: true, environment: { CODEGRAPH_TELEMETRY: '0' } } });
});

test('codegraph is sticky, --no-codegraph and uninstall remove exactly what wesh added', () => {
  const home = tmp(), cg = fakeCodegraph();
  const cjFile = path.join(home, '.claude.json');
  writeJson(cjFile, { numStartups: 3, mcpServers: { mine: { command: 'x' } }, projects: { a: { allowedTools: [] } } });
  const before = read(cjFile);
  run(['--home', home, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  run(['--home', home]); // plain re-install keeps codegraph
  assert.ok(JSON.parse(read(cjFile)).mcpServers.codegraph);
  assert.match(read(path.join(home, '.claude', 'CLAUDE.md')), /## Code graph/);
  run(['--home', home, '--no-codegraph']);
  assert.equal(read(cjFile), before, '~/.claude.json back to the exact original');
  assert.doesNotMatch(read(path.join(home, '.claude', 'CLAUDE.md')), /## Code graph/);
  assert.doesNotMatch(read(path.join(home, '.claude', 'agents', 'wesh-scout.md')), /mcp__codegraph/);
  assert.equal(JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json'))).mcp, undefined);
  run(['--home', home, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  run(['--home', home, '--uninstall']);
  assert.equal(read(cjFile), before);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')));
});

test('an existing codegraph setup (its own installer, or yours) is left alone', () => {
  const home = tmp(), cg = fakeCodegraph();
  const mine = { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] };
  writeJson(path.join(home, '.claude.json'), { mcpServers: { codegraph: mine } });
  writeJson(path.join(home, '.config', 'opencode', 'opencode.json'), { mcp: { servers: { codegraph: { type: 'local', command: ['codegraph'] } } } });
  run(['--home', home, '--codegraph-cli', cg.bin]);
  run(['--home', home, '--uninstall']);
  assert.deepEqual(JSON.parse(read(path.join(home, '.claude.json'))).mcpServers.codegraph, mine);
  assert.deepEqual(JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json'))).mcp.servers.codegraph, { type: 'local', command: ['codegraph'] });
});

test('codegraph CLI gone on re-install: wiring removed cleanly, the rest of wesh stays', () => {
  const home = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--codegraph-cli', cg.bin]);
  fs.rmSync(cg.bin);
  const out = run(['--home', home]);
  assert.match(out, /does not run; codegraph wiring skipped/);
  assert.ok(!fs.existsSync(path.join(home, '.claude.json')), 'MCP entry removed');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'wesh-review', 'SKILL.md')));
});

test('codegraph CLI missing: wiring skipped with a message, the rest of wesh installs', () => {
  const home = tmp();
  const out = run(['--home', home, '--codegraph-cli', path.join(home, 'nope', 'codegraph.cmd')]);
  assert.match(out, /does not run; codegraph wiring skipped/);
  assert.ok(!fs.existsSync(path.join(home, '.claude.json')));
  assert.doesNotMatch(read(path.join(home, '.claude', 'CLAUDE.md')), /## Code graph/);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'wesh-debug', 'SKILL.md')));
});

test('project scope: codegraph goes to .mcp.json and leaves no trace after uninstall', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--scope', 'project', '--project', proj, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  assert.ok(JSON.parse(read(path.join(proj, '.mcp.json'))).mcpServers.codegraph);
  run(['--home', home, '--scope', 'project', '--project', proj, '--uninstall']);
  assert.deepEqual(fs.readdirSync(proj), []);
});

test('project scope: wesh\'s own files stay out of the code graph', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--scope', 'project', '--project', proj, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  const cfg = JSON.parse(read(path.join(proj, 'codegraph.json')));
  for (const e of ['.claude/wesh/**', '.opencode/wesh/**', '.opencode/plugins/wesh-*.js']) assert.ok(cfg.exclude.includes(e), e);
});

test('project scope: a second install adds no duplicate excludes', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  const args = ['--home', home, '--scope', 'project', '--project', proj, '--codegraph-cli', cg.bin, '--opencode-version', '2'];
  run(args);
  run(args);
  const cfg = JSON.parse(read(path.join(proj, 'codegraph.json')));
  assert.deepEqual(cfg.exclude, ['.claude/wesh/**', '.opencode/wesh/**', '.opencode/plugins/wesh-*.js']);
});

test('project scope: your own codegraph.json entries survive install and uninstall', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  const file = path.join(proj, 'codegraph.json');
  fs.writeFileSync(file, JSON.stringify({ exclude: ['vendor/**'], extensions: { '.foo': 'foo' } }, null, 2));
  run(['--home', home, '--scope', 'project', '--project', proj, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  const after = JSON.parse(read(file));
  assert.ok(after.exclude.includes('vendor/**'), 'your exclude stays');
  assert.deepEqual(after.extensions, { '.foo': 'foo' }, 'your extensions stay');
  run(['--home', home, '--scope', 'project', '--project', proj, '--uninstall']);
  const back = JSON.parse(read(file));
  assert.deepEqual(back.exclude, ['vendor/**'], 'only wesh\'s entries go');
  assert.deepEqual(back.extensions, { '.foo': 'foo' }, 'your file stays');
});

const CLAUDE_EXCLUDES = ['.claude/wesh/**'];
const OPENCODE_EXCLUDES = ['.opencode/wesh/**', '.opencode/plugins/wesh-*.js'];
const projectArgs = (home, proj, cg, ...more) => ['--home', home, '--scope', 'project', '--project', proj, '--codegraph-cli', cg.bin, '--opencode-version', '2', ...more];
const cgLedger = (proj, host) => JSON.parse(read(path.join(proj, host, 'wesh', 'state.json'))).files['codegraph.json'];
const excludes = proj => JSON.parse(read(path.join(proj, 'codegraph.json'))).exclude;

test('project scope: uninstalling Claude Code keeps OpenCode\'s codegraph excludes', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(projectArgs(home, proj, cg));
  run(projectArgs(home, proj, cg, '--target', 'claude', '--uninstall'));
  assert.deepEqual(excludes(proj), OPENCODE_EXCLUDES);
  assert.ok(fs.existsSync(path.join(proj, '.opencode', 'wesh')) && fs.existsSync(path.join(proj, '.opencode', 'plugins', 'wesh-codegraph.js')));
  assert.ok(!fs.existsSync(path.join(proj, 'codegraph.json.wesh-bak')), 'wesh\'s own file is never backed up');
  run(projectArgs(home, proj, cg, '--target', 'opencode', '--uninstall'));
  assert.deepEqual(fs.readdirSync(proj), [], 'the last uninstall removes the file wesh made');
});

test('project scope: OpenCode then Claude Code, uninstall OpenCode: Claude Code\'s exclude stays', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(projectArgs(home, proj, cg, '--target', 'opencode'));
  run(projectArgs(home, proj, cg, '--target', 'claude'));
  run(projectArgs(home, proj, cg, '--target', 'opencode', '--uninstall'));
  assert.deepEqual(excludes(proj), CLAUDE_EXCLUDES);
  run(projectArgs(home, proj, cg, '--target', 'claude', '--uninstall'));
  assert.deepEqual(fs.readdirSync(proj), [], 'the last uninstall removes the file wesh made');
});

test('project scope: a shared exclude ledger from an older wesh is split by owner on reinstall', () => {
  // 0939002 recorded all three entries under the target that installed first, and nothing under the other.
  const legacy = (proj, owner, other) => {
    for (const [host, fsx] of [[owner, { created: true, containers: ['exclude'], added: { exclude: [...CLAUDE_EXCLUDES, ...OPENCODE_EXCLUDES] } }],
      [other, { created: false, containers: [], added: {} }]]) {
      const f = path.join(proj, host, 'wesh', 'state.json'), st = JSON.parse(read(f));
      st.files['codegraph.json'] = fsx;
      fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
    }
  };
  for (const [first, owner, other, drop, keep] of [['both', '.claude', '.opencode', 'claude', OPENCODE_EXCLUDES], ['opencode', '.opencode', '.claude', 'opencode', CLAUDE_EXCLUDES]]) {
    const home = tmp(), proj = tmp(), cg = fakeCodegraph();
    if (first === 'both') run(projectArgs(home, proj, cg));
    else { run(projectArgs(home, proj, cg, '--target', 'opencode')); run(projectArgs(home, proj, cg, '--target', 'claude')); }
    legacy(proj, owner, other);
    run(projectArgs(home, proj, cg));
    assert.deepEqual(cgLedger(proj, '.claude').added.exclude, CLAUDE_EXCLUDES, `${first}: Claude Code owns its own`);
    assert.deepEqual(cgLedger(proj, '.opencode').added.exclude, OPENCODE_EXCLUDES, `${first}: OpenCode owns its own`);
    run(projectArgs(home, proj, cg, '--target', drop, '--uninstall'));
    assert.deepEqual(excludes(proj), keep, `${first}: uninstall ${drop} keeps the other's`);
    run(projectArgs(home, proj, cg, '--target', drop === 'claude' ? 'opencode' : 'claude', '--uninstall'));
    assert.deepEqual(fs.readdirSync(proj), [], `${first}: nothing left`);
  }
});

test('project scope: an older shared ledger is split even by an uninstall without a reinstall', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(projectArgs(home, proj, cg));
  const f = path.join(proj, '.claude', 'wesh', 'state.json'), st = JSON.parse(read(f));
  st.files['codegraph.json'].added.exclude = [...CLAUDE_EXCLUDES, ...OPENCODE_EXCLUDES];
  fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
  const o = path.join(proj, '.opencode', 'wesh', 'state.json'), sto = JSON.parse(read(o));
  sto.files['codegraph.json'] = { created: false, containers: [], added: {} };
  fs.writeFileSync(o, JSON.stringify(sto, null, 2) + '\n');
  run(projectArgs(home, proj, cg, '--target', 'claude', '--uninstall'));
  assert.deepEqual(excludes(proj), OPENCODE_EXCLUDES);
  run(projectArgs(home, proj, cg, '--target', 'opencode', '--uninstall'));
  assert.deepEqual(fs.readdirSync(proj), []);
});

test('project scope: an older shared ledger, one target reinstalled, the other uninstalled without a reinstall', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(projectArgs(home, proj, cg));
  const f = path.join(proj, '.claude', 'wesh', 'state.json'), st = JSON.parse(read(f));
  st.files['codegraph.json'].added.exclude = [...CLAUDE_EXCLUDES, ...OPENCODE_EXCLUDES];
  fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
  const o = path.join(proj, '.opencode', 'wesh', 'state.json'), sto = JSON.parse(read(o));
  sto.files['codegraph.json'] = { created: false, containers: [], added: {} };
  fs.writeFileSync(o, JSON.stringify(sto, null, 2) + '\n');
  const optionsBefore = JSON.parse(read(o)).options;
  run(projectArgs(home, proj, cg, '--target', 'claude'));
  assert.deepEqual(cgLedger(proj, '.claude').added.exclude, CLAUDE_EXCLUDES);
  assert.deepEqual(cgLedger(proj, '.opencode').added.exclude, OPENCODE_EXCLUDES, 'handed to OpenCode, which stays installed');
  assert.deepEqual(JSON.parse(read(o)).options, optionsBefore, 'only the codegraph.json record of OpenCode\'s state is written');
  run(projectArgs(home, proj, cg, '--target', 'opencode', '--uninstall'));
  assert.deepEqual(excludes(proj), CLAUDE_EXCLUDES);
  run(projectArgs(home, proj, cg, '--target', 'claude', '--uninstall'));
  assert.deepEqual(fs.readdirSync(proj), []);
});

test('project scope: an older single-target install drops the other target\'s orphan excludes', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(projectArgs(home, proj, cg, '--target', 'claude'));
  const file = path.join(proj, 'codegraph.json');
  fs.writeFileSync(file, JSON.stringify({ exclude: [...CLAUDE_EXCLUDES, ...OPENCODE_EXCLUDES] }, null, 2) + '\n');
  const f = path.join(proj, '.claude', 'wesh', 'state.json'), st = JSON.parse(read(f));
  st.files['codegraph.json'].added.exclude = [...CLAUDE_EXCLUDES, ...OPENCODE_EXCLUDES];
  fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
  run(projectArgs(home, proj, cg, '--target', 'claude'));
  assert.deepEqual(excludes(proj), CLAUDE_EXCLUDES);
  run(projectArgs(home, proj, cg, '--target', 'claude', '--uninstall'));
  assert.deepEqual(fs.readdirSync(proj), []);
});

test('project scope: an existing index is synced once when the excludes are added', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  fs.mkdirSync(path.join(proj, '.codegraph'));
  run(projectArgs(home, proj, cg));
  const syncs = () => cg.calls().split(/\r?\n/).filter(l => /^sync\b/.test(l));
  assert.deepEqual(syncs(), [`sync --quiet ${proj}`], 'one sync for both targets');
  run(projectArgs(home, proj, cg));
  assert.equal(syncs().length, 1, 'nothing added: no second sync');
  const fresh = tmp(), cg2 = fakeCodegraph();
  run(projectArgs(tmp(), fresh, cg2));
  assert.doesNotMatch(cg2.calls(), /^sync/m, 'no index yet: nothing to sync');
  const dry = tmp(), cg3 = fakeCodegraph();
  fs.mkdirSync(path.join(dry, '.codegraph'));
  run(projectArgs(tmp(), dry, cg3, '--dry-run'));
  assert.doesNotMatch(cg3.calls(), /^sync/m, 'dry run: no sync');
});

test('project scope: a failing sync never fails the install, and says what to run', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph({ syncFails: true });
  fs.mkdirSync(path.join(proj, '.codegraph'));
  const out = run(projectArgs(home, proj, cg));
  assert.match(cg.calls(), /^sync --quiet/m);
  const hints = out.split('\n').filter(l => /codegraph sync/.test(l));
  assert.deepEqual(hints, [`  codegraph: run \`codegraph sync\` in ${proj} to drop wesh's files from the index`]);
  assert.ok(fs.existsSync(path.join(proj, '.claude', 'wesh', 'state.json')) && fs.existsSync(path.join(proj, '.opencode', 'wesh', 'state.json')));
});

test('parallel squeezes always save the full output (no race)', () => {
  const dir = tmp();
  const script = path.join(dir, 'p.mjs');
  fs.writeFileSync(script, `import { squeeze } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'hooks', 'squeeze.mjs')).href)};
    const big = Array.from({ length: 400 }, (_, i) => 'PASS src/t' + i + '.test.js').join('\\n') + '\\nFAIL x';
    let bad = 0; for (let i = 0; i < 40; i++) { const r = squeeze(big, { command: 'npx jest' }); if (!/Full output: /.test(r.text)) bad++; }
    process.stdout.write(String(bad));`);
  const procs = Array.from({ length: 12 }, () => new Promise(res => {
    import('node:child_process').then(({ execFile }) => execFile(process.execPath, [script], (e, out) => res(Number(out))));
  }));
  return Promise.all(procs).then(r => assert.deepEqual(r, Array(12).fill(0)));
});

test('uninstall restores the user state exactly', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# my rules\n');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { ask: ['Bash(npm publish:*)'] } }, null, 2) + '\n');
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'mine'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: x\n---\n');
  run(['--home', home, '--guard']);
  run(['--home', home, '--uninstall']);
  assert.equal(read(path.join(home, '.claude', 'CLAUDE.md')), '# my rules\n');
  assert.deepEqual(JSON.parse(read(path.join(home, '.claude', 'settings.json'))),
    { permissions: { ask: ['Bash(npm publish:*)'] } }, 'guard and squeeze hook removed, user settings kept');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'wesh')));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'mine', 'SKILL.md')), 'foreign skill kept');
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'skills')), ['mine']);
  const oc = path.join(home, '.config', 'opencode');
  assert.deepEqual(Object.keys(snapshot(oc)), [], 'no OpenCode leftovers');
});

test('project scope writes only inside the project, and uninstall leaves it empty', () => {
  const home = tmp(), proj = tmp();
  run(['--home', home, '--scope', 'project', '--project', proj, '--guard']);
  assert.deepEqual(fs.readdirSync(home), []);
  assert.ok(fs.existsSync(path.join(proj, '.claude', 'skills', 'wesh-review', 'SKILL.md')));
  assert.match(read(path.join(proj, 'CLAUDE.md')), /wesh:begin/);
  assert.ok(fs.existsSync(path.join(proj, '.opencode', 'agents', 'wesh-scout.md')));
  run(['--home', home, '--scope', 'project', '--project', proj, '--uninstall']);
  assert.deepEqual(fs.readdirSync(proj), [], 'no files or empty folders left');
});

test('dry run writes nothing', () => {
  const home = tmp();
  run(['--home', home, '--dry-run', '--guard']);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('the Claude Code scout runs on Haiku; --help documents every option', () => {
  assert.equal(parseSkill(path.join(ROOT, 'agents', 'wesh-scout.md')).front.model, 'haiku');
  const help = run(['--help']);
  for (const opt of ['--target', '--scope', '--level', '--no-codegraph', '--codegraph-cli', '--opencode-version', '--scout-model', '--no-squeeze', '--guard', '--dry-run', '--uninstall', 'WESH_AUTOINDEX'])
    assert.ok(help.includes(opt), opt);
});

test('default target follows the agents found: only OpenCode present -> OpenCode only', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  const out = run(['--home', home]);
  assert.match(out, /Installing for: OpenCode/);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'no Claude Code files when Claude Code is absent');
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'wesh-debug', 'SKILL.md')), 'skills copied for OpenCode');
});

// Regressions from the second review.
test('R1: the telemetry setting survives a re-install and comes back on uninstall and on --no-codegraph', () => {
  for (const off of [['--uninstall'], ['--no-codegraph']]) {
    const home = tmp(), cg = fakeCodegraph();
    run(['--home', home, '--codegraph-cli', cg.bin]);
    run(['--home', home, '--codegraph-cli', cg.bin]); // the switch now reads "disabled": wesh turned it off
    const state = JSON.parse(read(path.join(home, '.claude', 'wesh', 'state.json')));
    assert.equal(state.options.telemetry, 'enabled', 'still the pre-wesh setting after a re-install');
    run(['--home', home, '--codegraph-cli', cg.bin, ...off]);
    assert.match(cg.calls(), /telemetry on/, `given back on ${off[0]}`);
  }
});

test('R2: dry run never touches the telemetry switch', () => {
  const home = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--codegraph-cli', cg.bin]);
  const before = cg.calls();
  run(['--home', home, '--codegraph-cli', cg.bin, '--uninstall', '--dry-run']);
  assert.doesNotMatch(cg.calls().slice(before.length), /telemetry on/);
});

test('R3: the level is remembered, and a hand-edited level line is kept', () => {
  const home = tmp();
  const md = path.join(home, '.claude', 'CLAUDE.md'), core = path.join(home, '.config', 'opencode', 'wesh', 'CORE.md');
  run(['--home', home, '--level', 'ultra']);
  run(['--home', home]);
  assert.match(read(md), /Level: `ultra`/);
  assert.match(read(core), /Level: `ultra`/);
  fs.writeFileSync(md, read(md).replace('Level: `ultra`', 'Level: `lite`'));
  run(['--home', home]);
  assert.match(read(md), /Level: `lite`/, 'the hand edit wins over the last install');
  run(['--home', home, '--level', 'full']);
  assert.match(read(md), /Level: `full`/, 'an explicit --level wins over both');
});

test('R4: sources checked out with CRLF still give a locked-down OpenCode scout and a valid Claude scout', () => {
  const src = tmp();
  for (const d of ['core', 'skills', 'agents', 'hooks']) fs.cpSync(path.join(ROOT, d), path.join(src, d), { recursive: true });
  fs.copyFileSync(INSTALL, path.join(src, 'install.mjs'));
  const crlf = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) crlf(p); else if (p.endsWith('.md')) fs.writeFileSync(p, read(p).replace(/\r?\n/g, '\r\n'));
  } };
  crlf(src);
  const home = tmp(), cg = fakeCodegraph();
  execFileSync(process.execPath, [path.join(src, 'install.mjs'), '--home', home, '--codegraph-cli', cg.bin, '--opencode-version', '2'],
    { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '', OPENCODE_DISABLE_CLAUDE_CODE: '', WESH_NO_NPM: '1' } });
  const oc = read(path.join(home, '.config', 'opencode', 'agents', 'wesh-scout.md'));
  assert.match(oc, /^mode: subagent$/m);
  assert.match(oc, /^ {2}"\*": deny$/m, 'deny-all first');
  assert.doesNotMatch(oc, /\r/);
  assert.match(read(path.join(home, '.claude', 'agents', 'wesh-scout.md')), /^tools: Read, Glob, Grep, mcp__codegraph__codegraph_explore$/m);
  assert.match(read(path.join(home, '.config', 'opencode', 'commands', 'wesh-debt.md')), /^---\ndescription: "/);
});

test('R5: an older wesh hook is brought up to date in place; your hooks in the same group stay', () => {
  const home = tmp(), cg = fakeCodegraph();
  const settings = path.join(home, '.claude', 'settings.json');
  const mine = { type: 'command', command: 'echo mine' };
  const old = cmd => ({ type: 'command', command: `node "${path.join(home, '.claude', 'wesh', cmd)}"`, timeout: 15 });
  writeJson(settings, { hooks: {
    SessionStart: [{ matcher: 'startup|resume|clear', hooks: [mine, old('claude-autoindex.mjs')] }],
    PostToolUse: [{ matcher: 'Bash', hooks: [old('claude-squeeze.mjs')] }] } });
  run(['--home', home, '--codegraph-cli', cg.bin]);
  const s = JSON.parse(read(settings));
  assert.equal(s.hooks.SessionStart.length, 1, 'no second group');
  assert.deepEqual(s.hooks.SessionStart[0].hooks[0], mine, 'your hook kept');
  assert.equal(s.hooks.SessionStart[0].hooks[1].timeout, 30, 'wesh hook updated');
  assert.doesNotMatch(s.hooks.SessionStart[0].hooks[1].command, /\\/, 'forward slashes: same in Git Bash and PowerShell');
  assert.equal(s.hooks.PostToolUse.length, 1);
  assert.equal(s.hooks.PostToolUse[0].matcher, 'Bash|PowerShell');
  run(['--home', home, '--uninstall']);
  assert.deepEqual(JSON.parse(read(settings)).hooks, { SessionStart: [{ matcher: 'startup|resume|clear', hooks: [mine] }] }, 'only your hook is left');
});

test('R6: project-scope hooks use exec form, so PowerShell never sees $CLAUDE_PROJECT_DIR', () => {
  const home = tmp(), proj = tmp(), cg = fakeCodegraph();
  run(['--home', home, '--scope', 'project', '--project', proj, '--codegraph-cli', cg.bin]);
  const s = JSON.parse(read(path.join(proj, '.claude', 'settings.json')));
  for (const [ev, script] of [['PostToolUse', 'claude-squeeze.mjs'], ['SessionStart', 'claude-autoindex.mjs']]) {
    const h = s.hooks[ev][0].hooks[0];
    assert.equal(h.command, 'node', ev);
    assert.deepEqual(h.args, [`\${CLAUDE_PROJECT_DIR}/.claude/wesh/${script}`], ev);
  }
  // The scripts the args point at exist and run: feed the squeeze hook a real event.
  const out = execFileSync(process.execPath, [path.join(proj, '.claude', 'wesh', 'claude-squeeze.mjs')], { encoding: 'utf8',
    input: JSON.stringify({ tool_use_id: 'x', tool_input: { command: 'npm install' }, tool_response: { stdout: Array.from({ length: 400 }, (_, i) => `npm http fetch GET 200 https://r/p${i} ${i}ms`).join('\n'), stderr: '', interrupted: false, isImage: false } }) });
  assert.equal(JSON.parse(out).hookSpecificOutput.updatedToolOutput.interrupted, false, 'output shape kept');
  run(['--home', home, '--scope', 'project', '--project', proj, '--uninstall']);
  assert.deepEqual(fs.readdirSync(proj), []);
});

test('R7: squeeze recognises runners, Windows shims, paths and script variants; PowerShell bypass works', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'squeeze.mjs')).href);
  const noise = Array.from({ length: 300 }, (_, i) => `npm http fetch GET 200 https://registry.npmjs.org/pkg-${i} ${20 + i}ms (cache hit)`).join('\n');
  for (const command of ['python -m pytest -q', 'python3 -m unittest', 'uv run pytest', 'poetry run pytest', 'npm run test:unit',
    'pnpm build', 'yarn lint', 'pnpm vitest run', 'pnpm exec vitest', 'npm.cmd test', './node_modules/.bin/jest',
    "& 'C:\\Program Files\\nodejs\\npx.cmd' vitest", 'cargo nextest run', 'uv pip install -r req.txt', '.\\gradlew.bat build'])
    assert.equal(squeeze(noise, { command, id: 't' }).changed, true, command);
  for (const command of ['npm run report', 'pnpm ls', 'python script.py', 'uv run python main.py', '$env:WESH_RAW=1; npm test', 'WESH_RAW=1 npm test'])
    assert.equal(squeeze(noise, { command, id: 't' }).changed, false, command);
  assert.match(squeeze(noise, { command: 'npm install', id: 't' }).text, /\$env:WESH_RAW=1; <cmd>/, 'the note tells PowerShell users how');
});
// Regressions from the independent review (P0-P2).
test('P0-2: uninstalling one host keeps codegraph (CLI, telemetry, indexes) for the host that stays', () => {
  const home = tmp(), cg = fakeCodegraph(), proj = project();
  fs.mkdirSync(path.join(proj, '.codegraph'));
  run(['--home', home, '--codegraph-cli', cg.bin, '--opencode-version', '2']);
  fs.writeFileSync(path.join(home, '.claude', 'wesh', 'autoindex.log'), fs.realpathSync.native(proj) + '\n');
  const before = cg.calls().length;
  run(['--home', home, '--uninstall', '--target', 'claude']);
  const during = cg.calls().slice(before);
  assert.doesNotMatch(during, /uninit|telemetry on/, 'nothing shared is touched while OpenCode still uses it');
  assert.ok(fs.existsSync(path.join(proj, '.codegraph')), 'the index stays');
  assert.match(read(path.join(home, '.config', 'opencode', 'wesh', 'autoindex.log')), new RegExp(path.basename(proj)), 'and is handed to OpenCode');
  run(['--home', home, '--uninstall', '--target', 'opencode']);
  assert.ok(!fs.existsSync(path.join(proj, '.codegraph')), 'the last host removes it');
  assert.match(cg.calls(), /telemetry on/);
});

test('P1-7: the MCP entry wesh wrote follows a new codegraph path and a new OpenCode config shape', () => {
  const home = tmp(), a = fakeCodegraph(), b = fakeCodegraph();
  run(['--home', home, '--codegraph-cli', a.bin, '--opencode-version', '1']);
  run(['--home', home, '--codegraph-cli', b.bin, '--opencode-version', '2']);
  assert.equal(JSON.parse(read(path.join(home, '.claude.json'))).mcpServers.codegraph.command, b.bin);
  const oc = JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json')));
  assert.equal(oc.mcp.servers.codegraph.command[0], b.bin, 'V2 shape, new path');
  assert.equal(oc.mcp.codegraph, undefined, 'the V1 entry moved, not duplicated');
  run(['--home', home, '--uninstall']);
  assert.ok(!fs.existsSync(path.join(home, '.claude.json')));
});

test('P1-8: switching OpenCode to the Claude fallback removes the old skill copies; the hide rule is always written', () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'wesh-debug', 'SKILL.md')));
  run(['--home', home, '--target', 'both']);
  assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'wesh-debug')), 'no second, stale copy');
  const home2 = tmp();
  run(['--home', home2, '--target', 'both'], { OPENCODE_DISABLE_CLAUDE_CODE: '1' });
  assert.equal(JSON.parse(read(path.join(home2, '.config', 'opencode', 'opencode.json'))).permission.skill['wesh-debt'], 'deny');
});

test('P1-9: in OpenCode the squeeze never returns more than the preview, and never saves a second copy', async () => {
  const home = tmp();
  run(['--home', home, '--target', 'opencode']);
  const { default: plugin } = await import(pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'wesh-squeeze.js')).href);
  const full = path.join(tmp(), 'out.txt');
  fs.writeFileSync(full, Array.from({ length: 3000 }, (_, i) => `FAIL src/t${i}.test.js > case ${i}\n  AssertionError: expected ${i} to be ${i + 1}`).join('\n'));
  const preview = `[showing lines 1-100 of 6000; full output saved to ${full}]\n` + 'x\n'.repeat(100);
  const hooks = {};
  await plugin.setup({ tool: { hook: async (n, fn) => { hooks[n] = fn; } } });
  const ev = { tool: 'shell', status: 'completed', id: 'p19-nosave', input: { command: 'npm test' }, result: { content: preview } };
  hooks['execute.after'](ev);
  const out = typeof ev.result.content === 'string' ? ev.result.content : ev.result.content[0].text;
  assert.equal(out, preview, 'a squeeze many times longer than what OpenCode already showed is dropped');
  const dir = process.platform === 'win32' ? path.join(os.tmpdir(), 'wesh-squeeze') : path.join(os.homedir(), '.cache', 'wesh-squeeze');
  assert.ok(!fs.existsSync(path.join(dir, 'p19-nosave.log')), 'OpenCode kept the full output: no second copy');
});

test('P1-11: an existing opencode.jsonc is the config; no second opencode.json appears', () => {
  const home = tmp(), jsonc = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  writeJson(jsonc, { model: 'x/y' });
  run(['--home', home, '--target', 'opencode']);
  assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.json')));
  assert.ok(JSON.parse(read(jsonc)).instructions.length, 'wesh rules added to the .jsonc');
  run(['--home', home, '--target', 'opencode', '--uninstall']);
  assert.deepEqual(JSON.parse(read(jsonc)), { model: 'x/y' });
});

test('P2-12: a guard rule you add after --no-guard survives uninstall', () => {
  const home = tmp(), settings = path.join(home, '.claude', 'settings.json');
  run(['--home', home, '--target', 'claude', '--guard']);
  run(['--home', home, '--target', 'claude', '--no-guard']);
  const s = JSON.parse(read(settings));
  ((s.permissions ??= {}).ask ??= []).push('Bash(git push:*)');
  writeJson(settings, s);
  run(['--home', home, '--target', 'claude', '--uninstall']);
  assert.deepEqual(JSON.parse(read(settings)).permissions.ask, ['Bash(git push:*)']);
});

test('P2-13: an end marker quoted earlier in CLAUDE.md does not break the wesh block', () => {
  const home = tmp(), md = path.join(home, '.claude', 'CLAUDE.md');
  const text = '# mine\n```\n<!-- wesh:end -->\n```\n';
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, text);
  run(['--home', home, '--target', 'claude']);
  run(['--home', home, '--target', 'claude', '--level', 'ultra']);
  assert.equal((read(md).match(/wesh:begin/g) || []).length, 1, 'one block');
  assert.match(read(md), /Level: `ultra`/, 'and it is the one updated');
  run(['--home', home, '--target', 'claude', '--uninstall']);
  assert.equal(read(md), text);
});

test('P2-16: a hand-edited level in OpenCode is kept by an OpenCode re-install', () => {
  const home = tmp(), core = path.join(home, '.config', 'opencode', 'wesh', 'CORE.md');
  run(['--home', home, '--level', 'ultra']);
  fs.writeFileSync(core, read(core).replace('Level: `ultra`', 'Level: `lite`'));
  run(['--home', home, '--target', 'opencode']);
  assert.match(read(core), /Level: `lite`/);
});

test('P2: with no OpenCode on PATH, the existing config decides the MCP shape', () => {
  const home = tmp(), cg = fakeCodegraph();
  writeJson(path.join(home, '.config', 'opencode', 'opencode.json'), { mcp: { mine: { type: 'local', command: ['x'], enabled: true } } });
  run(['--home', home, '--target', 'opencode', '--codegraph-cli', cg.bin], { [pathKey]: path.dirname(process.execPath) });
  const oc = JSON.parse(read(path.join(home, '.config', 'opencode', 'opencode.json')));
  assert.ok(oc.mcp.codegraph && !oc.mcp.servers, 'OpenCode 1 shape kept');
});

test('core rules: run commands plainly, never pipe output through Unix-only filters', () => {
  const core = read(path.join(ROOT, 'core', 'CORE.md'));
  assert.match(core, /Never pipe through `tail`, `head`, `grep`/);
  assert.match(core, /PowerShell/);
  assert.doesNotMatch(core, /Grep the failure/);
});
test('cost: squeeze sees tests run through scripts and npm flags; payload stays payload', async () => {
  const { squeeze } = await import(pathToFileURL(path.join(ROOT, 'hooks', 'squeeze.mjs')).href);
  const noise = Array.from({ length: 300 }, (_, i) => `ok ${i} - suite > case ${i} (0.${i % 9}ms)`).join('\n');
  for (const command of ['node test/run.mjs', 'npm --prefix app test', 'node --import ./test/_hooks/register.mjs --test test/unit/a.test.mjs',
    'npx tsx scripts/build.ts', 'cd app && node test/run.mjs', 'node scripts/run-tests.mjs'])
    assert.equal(squeeze(noise, { command, id: 't' }).changed, true, command);
  for (const command of ['node server.js', 'node scripts/report.mjs', 'git --no-pager log', 'node -e "console.log(1)"'])
    assert.equal(squeeze(noise, { command, id: 't' }).changed, false, command);
});

test('cost: tests and test runs are proportional to risk in the core rules', () => {
  const core = read(path.join(ROOT, 'core', 'CORE.md'));
  assert.doesNotMatch(core, /New non-trivial logic .* leaves one small test/);
  assert.match(core, /Tests: only when asked, or risky logic/);
  assert.match(core, /Never re-run passing command/);
  assert.match(core, /Explanation user asked: every fact/);
});