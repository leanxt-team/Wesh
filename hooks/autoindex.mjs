// Keeps each project's codegraph index present and fresh without the developer thinking about it. Shared by the
// Claude Code SessionStart hook and the OpenCode plugin. Never blocks: the slow work (init, sync, repair) runs in a
// detached Node process, and a running codegraph MCP server picks the index up as soon as it exists.
//   no index          -> `codegraph init` (listed in the ledger: wesh built it, uninstall removes it)
//   index, behind     -> `codegraph sync` (changes made while no MCP server was watching)
//   index, broken     -> `codegraph index` (killed or failed run, or an upgrade that asks for a re-index)
// Indexes wesh repairs or syncs are not added to the ledger: an index you built stays yours.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THIS = fileURLToPath(import.meta.url);
const HERE = path.dirname(THIS);
// A folder counts as a project only with one of these at its root: no indexing of random folders.
const MARKERS = ['.git', 'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'mix.exs', 'pubspec.yaml', 'Package.swift', 'CMakeLists.txt', 'deno.json'];
const LOCK_MS = 30 * 60 * 1000;
const RUN_TIMEOUT = 15 * 1000;
const JOB_TIMEOUT = 2 * 60 * 60 * 1000; // a background init/sync/index never runs forever
// A big repository is not wesh's to index: that is the user's call.
const MAX_FILES = 20000;
// codegraph 1.6 index states that need a full re-index; anything else (complete, partial, null, a new name) is usable.
const BROKEN = new Set(['indexing', 'failed']);

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const real = p => { try { return fs.realpathSync.native(p); } catch { return p; } };
// Never a project: a drive root, the home folder or the temp folder (also through a short or linked path).
export const forbidden = dir => [path.parse(path.resolve(dir)).root, os.homedir(), os.tmpdir()]
  .some(f => same(dir, f) || same(real(dir), real(f)));
// Windows runs codegraph's .cmd shim through cmd.exe: one command line, quoted only where needed.
const winArg = s => (/[\s"&|<>^()%!]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);

export function config() {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'codegraph.json'), 'utf8')); } catch { return { cmd: 'codegraph' }; }
}

const hasMarker = dir => {
  try { return fs.readdirSync(dir).some(n => MARKERS.includes(n) || /\.(sln|csproj)$/i.test(n)); } catch { return false; }
};

// A background job's output goes nowhere (an init can print more than any buffer holds); a query's is read.
function run(cmd, args, cwd, timeout = RUN_TIMEOUT, job = false) {
  const opts = { cwd, encoding: 'utf8', timeout, stdio: ['ignore', job ? 'ignore' : 'pipe', 'ignore'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 };
  return process.platform === 'win32' ? execSync([cmd, ...args].map(winArg).join(' '), opts) : execFileSync(cmd, args, opts);
}

// The project root: the git top level, so a session opened in a monorepo subfolder uses the root's index
// instead of building a nested one that shadows it (codegraph uses the nearest index at or above the cwd).
function projectRoot(dir) {
  try {
    const top = run('git', ['rev-parse', '--show-toplevel'], dir).trim();
    if (top) return fs.realpathSync.native(top);
  } catch {}
  // No git here: the outermost ancestor with a project marker.
  let best = dir, d = dir;
  for (;;) {
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
    if (same(d, os.homedir()) || same(d, os.tmpdir()) || same(d, path.parse(d).root)) break;
    if (hasMarker(d)) best = d;
  }
  return best;
}

// What codegraph itself thinks of this project: the nearest index at or above the root, its state, and how far
// behind the files it is. known:false means the CLI could not answer at all: fall back to the folder check.
function status(root, cmd) {
  const none = { known: true, initialized: false, indexPath: '', lastIndexed: null, state: '', reindex: false, pending: -1 };
  let out;
  try { out = run(cmd, ['status', '--json'], root); } catch { return { ...none, known: false }; }
  try {
    const s = JSON.parse(out.slice(Math.max(0, out.search(/^\s*\{/m)))); // a notice printed before the JSON is skipped
    const c = s.pendingChanges;
    // -1: codegraph did not say, so a sync is the safe choice.
    const pending = c && typeof c === 'object' ? (c.added || 0) + (c.modified || 0) + (c.removed || 0) + (s.index?.pendingRefs || 0) : -1;
    return { known: true, initialized: !!s.initialized, indexPath: s.indexPath || '', lastIndexed: s.lastIndexed || null,
      state: s.index?.state || '', reindex: !!s.index?.reindexRecommended, pending };
  } catch { return none; } // unreadable output: not indexed
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; } };

// Is codegraph itself building this index? Its lock file holds the pid.
function lockHeld(indexDir) {
  let pid;
  try { pid = Number.parseInt(fs.readFileSync(path.join(indexDir, 'codegraph.lock'), 'utf8').trim(), 10); } catch { return false; }
  if (!Number.isInteger(pid) || pid <= 0) return true; // cannot tell: assume it is held
  return alive(pid);
}

const hash = root => crypto.createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 16);
const lockPath = root => path.join(os.tmpdir(), `wesh-autoindex-${hash(root)}.lock`);
// A build that failed or was killed (timeout) is not retried at every session: wait a day, so a repo too big to finish
// in time does not start a full index again and again.
const failedPath = root => path.join(os.tmpdir(), `wesh-autoindex-${hash(root)}.failed`);
const BACKOFF_MS = 24 * 60 * 60 * 1000;
const backingOff = root => { try { return Date.now() - fs.statSync(failedPath(root)).mtimeMs < BACKOFF_MS; } catch { return false; } };

// Is a wesh background job already working on this project? Its lock holds the job's pid; an old or dead one is stale.
function busy(root) {
  const lock = lockPath(root);
  try {
    const st = fs.statSync(lock);
    const pid = Number.parseInt(fs.readFileSync(lock, 'utf8'), 10);
    // A live job holds the lock however long it runs (a big index can take hours); a lock without a pid expires.
    if (Number.isInteger(pid) && pid > 0 ? alive(pid) : Date.now() - st.mtimeMs < LOCK_MS) return true;
    fs.rmSync(lock, { force: true });
  } catch {}
  return false;
}

// Measured (bench/ab): on a ~60-file repo the code graph cost more than it saved; on a ~400-file one it paid. Below
// this many tracked files, grep and Read are cheaper than the graph's tool definitions and explore calls.
const MIN_FILES = 200;
const envNumber = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
// 'too-big' (left to the user), 'too-small' (grep is cheaper) or 'ok'. WESH_AUTOINDEX_FORCE=1 overrides both.
function sizeVerdict(root) {
  if (process.env.WESH_AUTOINDEX_FORCE === '1') return 'ok';
  const max = envNumber('WESH_AUTOINDEX_MAX_FILES', MAX_FILES), min = envNumber('WESH_AUTOINDEX_MIN_FILES', MIN_FILES);
  const n = fileCount(root, max);
  return n > max ? 'too-big' : n < min ? 'too-small' : 'ok';
}
// How many files the repository tracks (git), else how many files it holds, stopping once past max.
function fileCount(root, max) {
  try { return run('git', ['ls-files'], root).split('\n').filter(Boolean).length; } catch {}
  // No git: count the files, stopping as soon as the limit is passed.
  const skip = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.venv', 'venv', '__pycache__', 'target']);
  let n = 0;
  const walk = dir => {
    if (n > max) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (++n > max) return;
    }
  };
  walk(root);
  return n;
}

// The Node that runs the background job. Inside OpenCode the host runtime may be Bun or OpenCode's own binary,
// which must never be handed a script: use the Node the installer recorded, else node on PATH.
function nodeBin() {
  const real = !process.versions.bun && /^node(\.exe)?$/i.test(path.basename(process.execPath));
  if (real) return process.execPath;
  const n = config().node;
  return n && fs.existsSync(n) ? n : 'node';
}

// Locks of jobs that died, and the helper scripts and locks older wesh versions never removed, go once they are old.
function sweep() {
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!/^wesh-(autoindex-[0-9a-f]{16}\.lock|index-[0-9a-f]{16}\.(cmd|sh))$/.test(f)) continue;
      const p = path.join(os.tmpdir(), f);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs <= LOCK_MS) continue;
        // An old lock still held by a live job (a big index takes hours) is that job's, not litter.
        const pid = f.endsWith('.lock') ? Number.parseInt(fs.readFileSync(p, 'utf8'), 10) : NaN;
        if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
        fs.rmSync(p, { force: true });
      } catch {}
    }
  } catch {}
}

// Starts `node autoindex.mjs --job <root> <lock> <unlock> <cmd> <args...>` detached; the job removes the lock when done.
function background(root, cmd, args, { unlock = false } = {}) {
  sweep();
  const lock = lockPath(root);
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch { return 'building'; } // another session got there first
  try {
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    const child = spawn(nodeBin(), [THIS, '--job', root, lock, unlock ? '1' : '0', cmd, ...args], {
      cwd: root, env: { ...process.env, CODEGRAPH_TELEMETRY: '0' }, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', () => { try { fs.rmSync(lock, { force: true }); } catch {} });
    if (child.pid) fs.writeFileSync(lock, String(child.pid));
    child.unref();
    return 'started';
  } catch { try { fs.rmSync(lock, { force: true }); } catch {} return 'failed'; }
}

// The ledger is what uninstall cleans up after, so it lists every root wesh created once.
function record(ledger, root) {
  try {
    const seen = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').map(s => s.trim()) : [];
    if (!seen.includes(root)) fs.appendFileSync(ledger, root + '\n');
  } catch {}
}

// Returns what happened: indexed | syncing | started | building | backoff | not-a-project | too-big | off | missing | failed.
export function autoIndex(dir, { cmd = config().cmd || 'codegraph', ledger = path.join(HERE, 'autoindex.log') } = {}) {
  if (process.env.WESH_AUTOINDEX === '0') return 'off';
  let root;
  try { root = fs.realpathSync.native(path.resolve(dir)); } catch { return 'missing'; } // long path: codegraph's Windows watcher fails on 8.3 names
  // Before the index check: codegraph keeps its own settings in ~/.codegraph, which is not a project index.
  if (forbidden(root)) return 'not-a-project';
  root = projectRoot(root);
  // Again after: a home folder kept in git (dotfiles) makes its top level the "project" of every folder below it.
  if (forbidden(root)) return 'not-a-project';
  if (busy(root)) return 'building';
  let st = status(root, cmd);
  // An "index" in the home folder is codegraph's settings folder (~/.codegraph): this project has none.
  if (st.indexPath && same(path.dirname(st.indexPath), os.homedir())) st = { ...st, initialized: false, indexPath: '' };
  const indexDir = st.indexPath || path.join(root, '.codegraph');
  const hasIndex = fs.existsSync(indexDir);
  if (!st.known) return hasIndex ? 'indexed' : 'failed'; // the CLI does not run: nothing wesh can do
  if (st.initialized || hasIndex) {
    if (lockHeld(indexDir)) return 'building'; // codegraph (an MCP server or another run) is writing it right now
    // Killed or failed run, an index older than the installed codegraph, or a folder without a database: rebuild.
    if (!st.initialized || BROKEN.has(st.state) || st.reindex || !st.lastIndexed) {
      if (backingOff(root)) return 'backoff';
      return background(root, cmd, ['index'], { unlock: true });
    }
    // Files changed while no MCP server was watching: bring the index up to date. Cheap when little changed.
    if (st.pending !== 0) return background(root, cmd, ['sync']) === 'started' ? 'syncing' : 'building';
    return 'indexed';
  }
  if (!hasMarker(root)) return 'not-a-project';
  const size = sizeVerdict(root);
  if (size !== 'ok') return size;
  if (backingOff(root)) return 'backoff';
  const r = background(root, cmd, ['init', '--yes']);
  if (r === 'started') record(ledger, root); // listed now, so a killed first run is still cleaned up by uninstall
  return r;
}

// For hosts that must never wait (the OpenCode plugin): the whole decision runs in a detached Node process.
export function autoIndexDetached(dir) {
  if (process.env.WESH_AUTOINDEX === '0' || !dir) return;
  try {
    const child = spawn(nodeBin(), [THIS, '--auto', dir], { cwd: os.tmpdir(), detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

function job([root, lock, unlock, cmd, ...args]) {
  try {
    if (unlock === '1') try { run(cmd, ['unlock'], root, RUN_TIMEOUT, true); } catch {}
    try { run(cmd, args, root, JOB_TIMEOUT, true); fs.rmSync(failedPath(root), { force: true }); }
    catch { if (args[0] !== 'sync') try { fs.writeFileSync(failedPath(root), new Date().toISOString()); } catch {} }
  } finally { try { fs.rmSync(lock, { force: true }); } catch {} }
}

if (process.argv[1] && same(process.argv[1], THIS)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--job') job(rest);
  else if (mode === '--auto') { try { autoIndex(rest[0]); } catch {} }
}

export const NOTE = 'wesh: building this repo\'s code graph in the background (about 1 minute per 1,000 source files). '
  + 'Until it exists, use grep/Read. `codegraph_explore` works as soon as it is built, no restart needed; '
  + 'until the server has found it, pass projectPath=<project root>.';
export const TOO_SMALL = 'wesh: small repository, no code graph: use grep/Read (cheaper at this size).';
export const TOO_BIG = 'wesh: this repository is large, so its code graph was not built automatically; use grep/Read. '
  + 'Tell the user once: to have one built, start the agent with WESH_AUTOINDEX_FORCE=1 set.';
