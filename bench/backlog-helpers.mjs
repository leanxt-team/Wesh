// Shared helpers for the P0 backlog regression tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wesh-p0-'));
export const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// The index runs detached: give the child a moment to record its call.
export const waitFor = async (fn, ms = 5000) => {
  const until = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > until) return false;
    await new Promise(r => setTimeout(r, 50));
  }
};
export const calls = log => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
// The plugin as it is installed: hooks/opencode-squeeze.js imports ../wesh/squeeze.mjs, a path that
// only exists in the installed layout.
export function installedPlugin(home) {
  execFileSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--home', home, '--target', 'opencode'],
    { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '', OPENCODE_DISABLE_CLAUDE_CODE: '', WESH_NO_NPM: '1', WESH_CODEGRAPH: '0' } });
  return pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'wesh-squeeze.js')).href;
}
// The code graph plugin, installed the same way, wired to the given codegraph CLI.
export function installedCodegraphPlugin(home, cli) {
  execFileSync(process.execPath, [path.join(ROOT, 'install.mjs'), '--home', home, '--target', 'opencode', '--codegraph-cli', cli, '--opencode-version', '2'],
    { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '', OPENCODE_DISABLE_CLAUDE_CODE: '', WESH_NO_NPM: '1' } });
  return pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'wesh-codegraph.js')).href;
}
export const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// A codegraph stand-in written in Node, so it behaves the same on Windows and POSIX. It lives in a folder whose
// name has a space (paths like "C:\Program Files\..." must work). `status --json` answers like codegraph 1.6
// (nearest index at or above cwd); every call is logged. Options: state, pending (null: field absent), reindex,
// status (raw status output), slowMs (init/index/sync take this long), fail (every call exits 1), failOn (that command exits 1).
export function fakeCodegraph(dir, { state = 'complete', pending = { added: 0, modified: 0, removed: 0 }, reindex = false,
  status = '', slowMs = 0, fail = false, failOn = '' } = {}) {
  const bin = path.join(dir, 'fake bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(bin, 'calls.log');
  const js = path.join(bin, 'codegraph.mjs');
  fs.writeFileSync(js, `import fs from 'node:fs'; import path from 'node:path';
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');
if (${fail} || a[0] === ${JSON.stringify(failOn)}) process.exit(1);
const slow = () => { if (${slowMs}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${slowMs}); };
if (a[0] === '--version') console.log('1.6.2');
else if (a[0] === 'status') {
  if (${JSON.stringify(status)}) { console.log(${JSON.stringify(status)}); process.exit(0); }
  let d = process.cwd();
  for (;;) {
    if (d.toLowerCase() === ${JSON.stringify(os.homedir().toLowerCase())}) break; // ~/.codegraph holds settings, not an index
    if (fs.existsSync(path.join(d, '.codegraph'))) {
      const s = { initialized: true, indexPath: path.join(d, '.codegraph'), lastIndexed: '2026-01-01T00:00:00.000Z', fileCount: 3,
        index: { state: ${JSON.stringify(state)}, reindexRecommended: ${reindex}, pendingRefs: 0 } };
      const p = ${JSON.stringify(pending)};
      if (p) s.pendingChanges = p;
      console.log(JSON.stringify(s)); process.exit(0);
    }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  console.log('{"initialized":false,"indexPath":"","lastIndexed":null}');
}
else if (a[0] === 'init') { slow(); fs.mkdirSync('.codegraph', { recursive: true }); }
else if (a[0] === 'index' || a[0] === 'sync') slow();
`);
  const shim = process.platform === 'win32' ? path.join(bin, 'codegraph.cmd') : path.join(bin, 'codegraph');
  fs.writeFileSync(shim, process.platform === 'win32' ? `@"${process.execPath}" "${js}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
  return { bin: shim, log };
}
// A pid that is definitely gone, so "the lock is stale" is true.
export function deadPid() {
  for (let p = 4000000; p > 100000; p -= 13) {
    try { process.kill(p, 0); } catch { return p; }
  }
  return 999999;
}
