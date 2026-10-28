// The code graph index: built, synced and repaired with no developer action (C1, C2, C13, A1-A12), and the
// stale-index rules in the skills (C6). node --test bench/autoindex-p0.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, tmp, write, waitFor, calls, deadPid, installedCodegraphPlugin, hasGit, fakeCodegraph } from './backlog-helpers.mjs';
// The test projects are tiny: let the auto-index treat them as real projects (production skips repos under 200 files).
process.env.WESH_AUTOINDEX_MIN_FILES = '0';

const load = () => import(pathToFileURL(path.join(ROOT, 'hooks/autoindex.mjs')).href);
const real = d => fs.realpathSync.native(d);
// A plain project (no git needed): a manifest at its root.
function project(dir) { write(path.join(dir, 'package.json'), '{"name":"p"}\n'); write(path.join(dir, 'src/x.js'), 'export const x = 1;\n'); return dir; }
function indexed(dir) { project(dir); write(path.join(dir, '.codegraph/.gitignore'), '*'); return dir; }
// A project with a git root above the folder the session opens (the monorepo case).
function gitProject(dir) {
  execFileSync('git', ['init', '-q', dir]);
  write(path.join(dir, 'package.json'), '{"name":"root"}\n');
  write(path.join(dir, 'packages/a/src/x.js'), 'export const x = 1;\n');
  write(path.join(dir, 'packages/b/src/y.js'), 'export const y = 2;\n');
  return dir;
}
const noGit = !hasGit && 'git is not installed';

test('C1: a session opened in a monorepo subfolder does not build a nested index', { skip: noGit }, async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const project = gitProject(path.join(home, 'repo'));
  write(path.join(project, '.codegraph/.gitignore'), '*');
  const cg = fakeCodegraph(home);
  const sub = path.join(project, 'packages/a');
  assert.equal(autoIndex(sub, { cmd: cg.bin, ledger: path.join(home, 'ledger.log') }), 'indexed', 'the root index covers the subfolder');
  assert.ok(!fs.existsSync(path.join(sub, '.codegraph')), 'no nested index');
  assert.doesNotMatch(calls(cg.log), /^(init|index|unlock|sync)/m, 'nothing but status ran');
});

test('C1: a session opened at the git root still builds the index there', { skip: noGit }, async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const project = gitProject(path.join(home, 'repo'));
  const cg = fakeCodegraph(home);
  assert.equal(autoIndex(project, { cmd: cg.bin, ledger: path.join(home, 'ledger.log') }), 'started');
  assert.ok(await waitFor(() => /^init/m.test(calls(cg.log)), 20000), 'init ran at the root');
});

test('C2: an interrupted index is repaired, and a repaired index is not claimed by wesh', async () => {
  const { autoIndex } = await load();
  const home = tmp(), ledger = path.join(home, 'ledger.log');
  const project = indexed(path.join(home, 'repo'));
  write(path.join(project, '.codegraph/codegraph.lock'), `${deadPid()}\n`); // a pid that is not alive
  const cg = fakeCodegraph(home, { state: 'indexing' });
  assert.equal(autoIndex(project, { cmd: cg.bin, ledger }), 'started', 'rebuilds the truncated index');
  assert.ok(await waitFor(() => /^unlock/m.test(calls(cg.log)) && /^index/m.test(calls(cg.log)), 20000), 'stale lock removed, index re-run');
  assert.ok(!fs.existsSync(ledger), 'the index is the user\'s: uninstall must never delete it');
});

test('C2: an index a live process is still building is left alone', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const project = indexed(path.join(home, 'repo'));
  write(path.join(project, '.codegraph/codegraph.lock'), `${process.pid}\n`); // this process is alive
  const cg = fakeCodegraph(home, { state: 'indexing' });
  assert.equal(autoIndex(project, { cmd: cg.bin, ledger: path.join(home, 'l') }), 'building', 'a live indexer holds the lock');
  await new Promise(r => setTimeout(r, 300));
  assert.doesNotMatch(calls(cg.log), /^(unlock|index|sync)/m, 'nothing destructive while another process indexes');
});

test('C2: a status output that cannot be parsed counts as not indexed', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const cg = fakeCodegraph(home, { status: 'not json' });
  assert.equal(autoIndex(project(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'started', 'falls back to indexing');
});

test('A1: an up-to-date index is left alone', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const cg = fakeCodegraph(home);
  assert.equal(autoIndex(indexed(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'indexed');
  await new Promise(r => setTimeout(r, 300));
  assert.doesNotMatch(calls(cg.log), /^(init|index|unlock|sync)/m);
});

test('A2: files changed while no MCP server watched are synced at session start, with no ledger entry', async () => {
  const { autoIndex } = await load();
  const home = tmp(), ledger = path.join(home, 'l');
  const cg = fakeCodegraph(home, { pending: { added: 1, modified: 2, removed: 0 } });
  assert.equal(autoIndex(indexed(path.join(home, 'repo')), { cmd: cg.bin, ledger }), 'syncing');
  assert.ok(await waitFor(() => /^sync/m.test(calls(cg.log)), 20000), 'sync ran in the background');
  assert.ok(!fs.existsSync(ledger));
});

test('A3: a codegraph that does not report pending changes still gets a sync', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const cg = fakeCodegraph(home, { pending: null });
  assert.equal(autoIndex(indexed(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'syncing');
  assert.ok(await waitFor(() => /^sync/m.test(calls(cg.log)), 20000));
});

test('A4: after a codegraph upgrade that asks for it, the index is rebuilt once', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const cg = fakeCodegraph(home, { reindex: true });
  assert.equal(autoIndex(indexed(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'started');
  assert.ok(await waitFor(() => /^index/m.test(calls(cg.log)), 20000));
});

test('A5: an index state this wesh does not know (a newer codegraph) is trusted, not rebuilt every session', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  for (const state of ['ready', 'partial', '']) {
    const cg = fakeCodegraph(path.join(home, state || 'none'), { state });
    assert.equal(autoIndex(indexed(path.join(home, `repo-${state || 'none'}`)), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'indexed', state);
  }
});

test('A6: one background job per project; the next session runs again once it is done', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const cg = fakeCodegraph(home, { slowMs: 2500 });
  const repo = project(path.join(home, 'repo'));
  assert.equal(autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') }), 'started');
  assert.equal(autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') }), 'building', 'a second session does not start a second job');
  assert.ok(await waitFor(() => fs.existsSync(path.join(repo, '.codegraph')), 20000));
  assert.ok(await waitFor(() => autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') }) === 'indexed', 20000), 'the job released its lock');
});

test('A7: a new index is listed in the ledger at once (a killed first run is still cleaned up)', async () => {
  const { autoIndex } = await load();
  const home = tmp(), ledger = path.join(home, 'l');
  const cg = fakeCodegraph(home, { slowMs: 1500 });
  const repo = project(path.join(home, 'repo'));
  assert.equal(autoIndex(repo, { cmd: cg.bin, ledger }), 'started');
  assert.equal(fs.readFileSync(ledger, 'utf8').trim(), real(repo));
});

test('A8: no helper script is left in the temp folder', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const before = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('wesh-index-')));
  const cg = fakeCodegraph(home);
  const repo = project(path.join(home, 'repo'));
  autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') });
  assert.ok(await waitFor(() => fs.existsSync(path.join(repo, '.codegraph')), 20000));
  await waitFor(() => autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') }) === 'indexed', 20000);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('wesh-index-') && !before.has(f)), []);
});

test('A13: the sweep never removes an old lock that a live job still holds', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const held = path.join(os.tmpdir(), 'wesh-autoindex-00000000000000cc.lock');
  fs.writeFileSync(held, String(process.pid));
  const old = Date.now() / 1000 - 3 * 3600;
  fs.utimesSync(held, old, old);
  try {
    autoIndex(project(path.join(home, 'repo')), { cmd: fakeCodegraph(home).bin, ledger: path.join(home, 'l') }); // runs the sweep
    assert.ok(fs.existsSync(held), 'a 3-hour-old lock of a live job stays');
  } finally { fs.rmSync(held, { force: true }); }
});

test('A12: old locks and helper scripts that earlier versions left in the temp folder are swept', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const old = Date.now() / 1000 - 3600, files = ['wesh-autoindex-00000000000000aa.lock', 'wesh-index-00000000000000aa.cmd'];
  const fresh = path.join(os.tmpdir(), 'wesh-autoindex-00000000000000bb.lock');
  const dead = String(deadPid()); // the job that left the lock is gone; pid 1 is alive on Linux, so it cannot be the fixture
  for (const f of files) { fs.writeFileSync(path.join(os.tmpdir(), f), dead); fs.utimesSync(path.join(os.tmpdir(), f), old, old); }
  fs.writeFileSync(fresh, dead);
  try {
    const cg = fakeCodegraph(home);
    autoIndex(project(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') });
    for (const f of files) assert.ok(!fs.existsSync(path.join(os.tmpdir(), f)), `${f} swept`);
    assert.ok(fs.existsSync(fresh), 'a recent lock is never swept');
  } finally { fs.rmSync(fresh, { force: true }); }
});

test('P0-1: a home folder kept in git is never indexed, even from a subfolder', { skip: noGit }, async () => {
  const { autoIndex } = await load();
  const fakeHome = tmp(), ledger = path.join(tmp(), 'l');
  execFileSync('git', ['init', '-q', fakeHome]);
  const sub = path.join(fakeHome, 'notes');
  fs.mkdirSync(sub);
  fs.mkdirSync(path.join(fakeHome, '.codegraph')); // codegraph's own settings folder, not an index
  const cg = fakeCodegraph(tmp());
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = fakeHome;
  try { assert.equal(autoIndex(sub, { cmd: cg.bin, ledger }), 'not-a-project'); }
  finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await new Promise(r => setTimeout(r, 300));
  assert.doesNotMatch(calls(cg.log), /^(init|index|unlock|sync)/m, 'nothing ran in the home folder');
  assert.ok(!fs.existsSync(ledger), 'and nothing was claimed');
});

test('P0-4: a live job holds its lock however old; a failed build backs off instead of looping', async () => {
  const { autoIndex } = await load();
  const crypto = await import('node:crypto');
  const home = tmp();
  const repo = project(path.join(home, 'repo'));
  const key = fs.realpathSync.native(repo).toLowerCase();
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  const lock = path.join(os.tmpdir(), `wesh-autoindex-${h}.lock`), failed = path.join(os.tmpdir(), `wesh-autoindex-${h}.failed`);
  try {
    fs.writeFileSync(lock, String(process.pid));
    const old = Date.now() / 1000 - 3 * 3600;
    fs.utimesSync(lock, old, old);
    const cg = fakeCodegraph(path.join(home, 'a'));
    assert.equal(autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') }), 'building', 'a 3-hour-old lock of a live job still holds');
    fs.rmSync(lock);
    const bad = fakeCodegraph(path.join(home, 'b'), { failOn: 'init' });
    assert.equal(autoIndex(repo, { cmd: bad.bin, ledger: path.join(home, 'l') }), 'started');
    assert.ok(await waitFor(() => fs.existsSync(failed), 20000), 'the failure is remembered');
    await waitFor(() => !fs.existsSync(lock), 20000);
    assert.equal(autoIndex(repo, { cmd: bad.bin, ledger: path.join(home, 'l') }), 'backoff', 'no new build at the next session');
  } finally { fs.rmSync(lock, { force: true }); fs.rmSync(failed, { force: true }); }
});

test('P2: a notice printed before the status JSON does not count as "no index"', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const repo = indexed(path.join(home, 'repo'));
  const json = JSON.stringify({ initialized: true, indexPath: path.join(repo, '.codegraph'), lastIndexed: '2026-01-01T00:00:00.000Z',
    pendingChanges: { added: 0, modified: 0, removed: 0 }, index: { state: 'complete', pendingRefs: 0 } });
  const cg = fakeCodegraph(home, { status: `A new version of codegraph is available\n${json}` });
  assert.equal(autoIndex(repo, { cmd: cg.bin, ledger: path.join(home, 'l') }), 'indexed');
});

test('A9: a codegraph that does not run changes nothing and claims nothing', async () => {
  const { autoIndex } = await load();
  const home = tmp(), ledger = path.join(home, 'l');
  const cg = fakeCodegraph(home, { fail: true });
  assert.equal(autoIndex(project(path.join(home, 'repo')), { cmd: cg.bin, ledger }), 'failed');
  assert.ok(!fs.existsSync(ledger));
  assert.equal(autoIndex(project(path.join(home, 'gone')), { cmd: path.join(home, 'nope', 'codegraph'), ledger }), 'failed', 'missing CLI');
});

test('A10: the detached entry point (the OpenCode path) indexes without blocking', async () => {
  const { autoIndexDetached } = await load();
  const home = tmp();
  const repo = project(path.join(home, 'repo'));
  const cg = fakeCodegraph(home);
  // The detached run reads codegraph.json next to autoindex.mjs: use an installed copy.
  const wesh = path.join(home, 'wesh');
  fs.mkdirSync(wesh);
  fs.copyFileSync(path.join(ROOT, 'hooks/autoindex.mjs'), path.join(wesh, 'autoindex.mjs'));
  fs.writeFileSync(path.join(wesh, 'codegraph.json'), JSON.stringify({ cmd: cg.bin, node: process.execPath }));
  const { autoIndexDetached: installed } = await import(pathToFileURL(path.join(wesh, 'autoindex.mjs')).href);
  const t = Date.now();
  installed(repo);
  assert.ok(Date.now() - t < 1000, 'returns at once');
  assert.ok(await waitFor(() => fs.existsSync(path.join(repo, '.codegraph')), 20000), 'index built');
  assert.equal(fs.readFileSync(path.join(wesh, 'autoindex.log'), 'utf8').trim(), real(repo), 'and listed as wesh\'s');
  assert.equal(typeof autoIndexDetached, 'function');
});

test('A11: WESH_AUTOINDEX=0 turns everything off', async () => {
  const { autoIndex } = await load();
  const home = tmp();
  const cg = fakeCodegraph(home, { pending: { added: 3, modified: 0, removed: 0 } });
  process.env.WESH_AUTOINDEX = '0';
  try { assert.equal(autoIndex(indexed(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'off'); }
  finally { delete process.env.WESH_AUTOINDEX; }
});

test('C13: a shared OpenCode 2 service indexes every project a session opens', async () => {
  const home = tmp();
  const cg = fakeCodegraph(home);
  const { default: plugin } = await import(installedCodegraphPlugin(home, cg.bin));
  const projA = project(path.join(tmp(), 'a')), projB = project(path.join(tmp(), 'b'));
  const hooks = await plugin.setup({ location: { directory: projA } });
  assert.ok(await waitFor(() => fs.existsSync(path.join(projA, '.codegraph')), 30000), 'the first project is indexed');
  await hooks.event({ event: { type: 'session.created', properties: { info: { directory: projB } } } });
  assert.ok(await waitFor(() => fs.existsSync(path.join(projB, '.codegraph')), 30000), 'the second project is indexed too');
  const v1 = await plugin.server({ directory: projA });
  assert.equal(typeof v1.event, 'function', 'OpenCode 1 gets the same session hook');
});

test('C6: the skills say a CLI result is never proof on its own', () => {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['core/CODEGRAPH.md', 'skills/wesh-review/SKILL.md', 'skills/wesh-refactor/SKILL.md', 'skills/wesh-plan/SKILL.md']) {
    const text = read(f);
    assert.match(text, /codegraph sync/, `${f} tells the agent to sync before trusting the index`);
    assert.match(text, /grep/i, `${f} tells the agent to confirm with grep`);
  }
});

test('C7: the always-on core names no codegraph command (it loads for users without codegraph too)', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'core/CORE.md'), 'utf8'), /codegraph[_ ](explore|callers|sync|status)/);
});

test('A14: a small repository gets no code graph, and the session is told why (grep is cheaper there)', async () => {
  const { autoIndex, TOO_SMALL } = await load();
  const home = tmp(), cg = fakeCodegraph(home);
  process.env.WESH_AUTOINDEX_MIN_FILES = '200';
  try { assert.equal(autoIndex(project(path.join(home, 'repo')), { cmd: cg.bin, ledger: path.join(home, 'l') }), 'too-small'); }
  finally { process.env.WESH_AUTOINDEX_MIN_FILES = '0'; }
  assert.doesNotMatch(calls(cg.log), /^init/m);
  assert.match(TOO_SMALL, /grep\/Read/);
});