#!/usr/bin/env node
// wesh installer: Claude Code and OpenCode (OpenChamber uses OpenCode's config). Run `node install.mjs --help`.
const HELP = `wesh installer

  node install.mjs              install for the agents found on this machine (Claude Code, OpenCode)
  node install.mjs --uninstall  remove everything wesh added

Options (all optional; the defaults need no setup):
  --target claude|opencode|both   which agents (default: the ones found; both if none found)
  --scope user|project            user = every project (default); project = only the current folder
  --project <dir>                 folder for --scope project (default: current folder)
  --level lite|full|ultra         default voice: lite = normal prose, full = terse (default), ultra = terser (remembered)
  --no-codegraph / --codegraph    code graph off / back on (on by default; the choice is remembered)
  --codegraph-cli <path>          codegraph binary that is not on PATH
  --opencode-version 1|2          OpenCode config format (default: detected, else 2)
  --scout-model provider/model    OpenCode: cheap model for the wesh-scout subagent
  --squeeze / --no-squeeze      turn the output squeeze on or off (remembered)
  --guard / --no-guard          ask before git push, reset --hard, clean, branch -D, rm -rf (remembered)
  --dry-run                       show what would change, change nothing
Environment: WESH_CODEGRAPH=0 (code graph off by default), WESH_AUTOINDEX=0 (no automatic indexing),
             WESH_RAW=1 before a command (its output untrimmed), WESH_SQUEEZE=0 (no trimming at all).`;
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forbidden } from './hooks/autoindex.mjs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const BEGIN = '<!-- wesh:begin (managed by wesh/install.mjs; edit the level line only) -->';
const END = '<!-- wesh:end -->';
const USER_ONLY = ['wesh', 'wesh-handoff', 'wesh-compress', 'wesh-debt'];
const GUARD_CLAUDE = ['Bash(git push:*)', 'Bash(git reset --hard:*)', 'Bash(git clean:*)', 'Bash(git branch -D:*)',
  'Bash(git checkout -- .:*)', 'Bash(git restore .:*)', 'Bash(rm -rf:*)'];
const GUARD_OPENCODE = ['git push*', 'git reset --hard*', 'git clean*', 'git branch -D*', 'git checkout -- .*',
  'git restore .*', 'rm -rf*'];
const CODEGRAPH_PKG = '@colbymchenry/codegraph@1.6.2'; // pinned; installed only with --codegraph when no CLI is found
const CODEGRAPH_ALLOW = 'mcp__codegraph__*';
const CODEGRAPH_TOOL = 'mcp__codegraph__codegraph_explore';
const CODEGRAPH_OC_TOOL = 'codegraph_codegraph_explore'; // OpenCode names MCP tools <server>_<tool>

function parseArgs(argv) {
  const o = { target: '', scope: 'user', level: '', scoutModel: '', squeeze: undefined, guard: undefined, uninstall: false,
    dryRun: false, home: os.homedir(), homeGiven: false, project: process.cwd(), codegraph: undefined, codegraphCli: '', opencodeVersion: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--target') o.target = val();
    else if (a === '--scope') o.scope = val();
    else if (a === '--level') o.level = val();
    else if (a === '--scout-model') o.scoutModel = val();
    else if (a === '--home') { o.home = path.resolve(val()); o.homeGiven = true; }
    else if (a === '--project') o.project = path.resolve(val());
    else if (a === '--guard') o.guard = true;
    else if (a === '--no-guard') o.guard = false;
    else if (a === '--no-squeeze') o.squeeze = false;
    else if (a === '--squeeze') o.squeeze = true;
    else if (a === '--codegraph') o.codegraph = true;
    else if (a === '--no-codegraph') o.codegraph = false;
    else if (a === '--codegraph-cli') { o.codegraphCli = path.resolve(val()); o.codegraph ??= true; }
    else if (a === '--opencode-version') o.opencodeVersion = val();
    else if (a === '--uninstall') o.uninstall = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else throw new Error(`unknown option ${a} (see --help)`);
  }
  if (o.target && !['claude', 'opencode', 'both'].includes(o.target)) throw new Error('--target must be claude, opencode or both');
  if (!['user', 'project'].includes(o.scope)) throw new Error('--scope must be user or project');
  if (o.level && !['lite', 'full', 'ultra'].includes(o.level)) throw new Error('--level must be lite, full or ultra');
  if (o.scoutModel && !/^[\w.-]+\/[\w.:-]+$/.test(o.scoutModel)) throw new Error('--scout-model must be provider/model, e.g. anthropic/claude-haiku-5-5');
  if (o.opencodeVersion && !['1', '2'].includes(o.opencodeVersion)) throw new Error('--opencode-version must be 1 or 2');
  return o;
}

function paths(o) {
  const user = o.scope === 'user';
  const claude = user ? path.join(o.home, '.claude') : path.join(o.project, '.claude');
  const xdg = !o.homeGiven && process.env.XDG_CONFIG_HOME; // --home is a sandbox: never escape it
  const oc = user ? path.join(xdg || path.join(o.home, '.config'), 'opencode') : path.join(o.project, '.opencode');
  return {
    claudeSkills: path.join(claude, 'skills'),
    claudeAgents: path.join(claude, 'agents'),
    claudeRules: user ? path.join(claude, 'CLAUDE.md') : path.join(o.project, 'CLAUDE.md'),
    claudeSettings: path.join(claude, 'settings.json'),
    claudeMcp: user ? path.join(o.home, '.claude.json') : path.join(o.project, '.mcp.json'), // where Claude Code reads MCP servers
    claudeWesh: path.join(claude, 'wesh'),
    squeezeHook: hookEntry(user, claude, 'claude-squeeze.mjs', 10),
    ocSkills: path.join(oc, 'skills'),
    ocAgents: path.join(oc, 'agents'),
    ocCommands: path.join(oc, 'commands'),
    ocRules: user ? path.join(oc, 'AGENTS.md') : path.join(o.project, 'AGENTS.md'),
    ocWesh: path.join(oc, 'wesh'),
    ocCore: path.join(oc, 'wesh', 'CORE.md'),
    ocCoreRef: user ? path.join(oc, 'wesh', 'CORE.md') : '.opencode/wesh/CORE.md',
    ocConfig: jsonOrJsonc(user ? path.join(oc, 'opencode.json') : path.join(o.project, 'opencode.json')),
    ocPlugin: path.join(oc, 'plugins', 'wesh-squeeze.js'),
    ocCgPlugin: path.join(oc, 'plugins', 'wesh-codegraph.js'),
    autoindexHook: hookEntry(user, claude, 'claude-autoindex.mjs', 30),
  };
}
// User scope: an absolute path with forward slashes, which Git Bash, PowerShell and sh all read the same way.
// Project scope: exec form, where Claude Code itself fills in ${CLAUDE_PROJECT_DIR} with no shell involved
// (in shell form PowerShell would read $CLAUDE_PROJECT_DIR as an empty PowerShell variable).
function hookEntry(user, claude, script, timeout) {
  return user ? { type: 'command', command: `node "${path.join(claude, 'wesh', script).replace(/\\/g, '/')}"`, timeout }
    : { type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/.claude/wesh/${script}`], timeout };
}
// One wesh hook (any install's path form: backslashes, forward slashes, $CLAUDE_PROJECT_DIR, exec args).
const isWeshHook = (x, script) => new RegExp(`wesh[\\\\/]${script.replace('.', '\\.')}`).test([x?.command || '', ...(x?.args || [])].join(' '));
const hasWeshHook = (group, script) => (group?.hooks || []).some(x => isWeshHook(x, script));
// Add wesh's hook to an event list, or bring an older wesh hook up to date in place (path form, timeout).
// Hooks of yours that share its group are kept.
function upsertHook(list, script, matcher, entry) {
  const g = list.find(h => hasWeshHook(h, script));
  if (!g) return list.push({ matcher, hooks: [entry] });
  g.hooks = g.hooks.map(x => (isWeshHook(x, script) ? entry : x));
  if (g.hooks.length === 1) g.matcher = matcher;
}
// Remove only wesh's hook; a group, event list or hooks object that only held it goes too.
function dropHook(s, event, script) {
  const list = s.hooks?.[event];
  if (!Array.isArray(list) || !list.some(g => hasWeshHook(g, script))) return;
  s.hooks[event] = list.map(g => (hasWeshHook(g, script) ? { ...g, hooks: g.hooks.filter(x => !isWeshHook(x, script)) } : g))
    .filter(g => !Array.isArray(g?.hooks) || g.hooks.length);
  if (!s.hooks[event].length) delete s.hooks[event];
  if (!Object.keys(s.hooks).length) delete s.hooks;
}
// Source files may have been checked out with CRLF: every frontmatter regex below expects LF.
const srcText = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n');

// An existing opencode.jsonc is the config (edited if it is plain JSON, else the change is printed): never a second file.
const jsonOrJsonc = f => (!fs.existsSync(f) && fs.existsSync(f + 'c') ? f + 'c' : f);
const log = (...a) => console.log(...a);
let DRY = false;
// Written to a temporary file next to the target, then renamed over it: a crash or a full disk never leaves a
// half-written settings.json or ~/.claude.json behind.
function write(file, text) {
  if (DRY) return log(`  would write ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.wesh-tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
function backup(file) { // first pre-wesh copy, for manual recovery only: never overwritten, never restored automatically
  if (DRY || !fs.existsSync(file) || fs.existsSync(file + '.wesh-bak')) return;
  fs.copyFileSync(file, file + '.wesh-bak');
}
function remove(p) {
  if (!fs.existsSync(p)) return;
  if (DRY) return log(`  would remove ${p}`);
  fs.rmSync(p, { recursive: true, force: true });
  log(`  removed ${p}`);
}
function removeIfEmpty(dir) { // only ever deletes an empty folder
  try { if (!DRY && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
}
function copyDir(src, dst) {
  if (DRY) return log(`  would copy ${src} -> ${dst}`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}

const skillNames = () => fs.readdirSync(path.join(SRC, 'skills')).filter(n => fs.existsSync(path.join(SRC, 'skills', n, 'SKILL.md')));
const readSkill = n => srcText('skills', n, 'SKILL.md');
const frontField = (text, key) => (text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim() || '';

// What wesh added to shared files, so uninstall removes exactly that. One state file per host folder.
function loadState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { return { files: {} }; }
}
function saveState(dir, state) { if (!DRY) write(path.join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n'); }
// Keyed by file name (unique per state folder), so a moved home or a short/long Windows path still matches.
function fileState(state, file) {
  const k = path.basename(file);
  const legacy = Object.keys(state.files).find(x => x !== k && path.basename(x.replace(/\\/g, '/')) === k);
  if (legacy) { state.files[k] ??= state.files[legacy]; delete state.files[legacy]; }
  return (state.files[k] ??= { created: false, containers: [], added: {} });
}

function coreBlock(level, codegraph, alreadyGuided = false) {
  let core = srcText('core', 'CORE.md').replace('Level: `full`', `Level: \`${level}\``).trim();
  // codegraph's own installer writes its guidance into the instruction file; a second copy is noise.
  if (codegraph && !alreadyGuided) core += '\n\n' + srcText('core', 'CODEGRAPH.md').trim();
  return `${BEGIN}\n${core}\n${END}`;
}

// codegraph: an existing CLI is used as is; otherwise the pinned package is installed with npm (and removed on uninstall).
// Windows runs .cmd shims through cmd.exe: pass one command line, bare names unquoted. A quoted "npm" makes npm's
// shim resolve itself against the current folder and fail.
const winArg = s => (/[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const run = (cmd, args, cwd, env) => (process.platform === 'win32'
  ? spawnSync([cmd, ...args].map(winArg).join(' '), { encoding: 'utf8', shell: true, timeout: 300000, ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) })
  : spawnSync(cmd, args, { encoding: 'utf8', timeout: 300000, ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) }));
const cliWorks = cmd => { const r = run(cmd, ['--version']); return r.status === 0 && /\d+\.\d+/.test(r.stdout || ''); };
const cliVersion = cmd => { const r = run(cmd, ['--version']); return (r.stdout || '').trim().match(/\d+\.\d+\.\d+/)?.[0] || ''; };
// What the user chose for codegraph telemetry before wesh touched it.
const telemetryState = cmd => {
  const r = run(cmd, ['telemetry', 'status']);
  return (r.stdout || '').match(/Telemetry:\s*(enabled|disabled)/i)?.[1]?.toLowerCase() || '';
};
// One line from the terminal (the installer is synchronous). Unreadable stdin counts as "no".
function ask(question) {
  process.stdout.write(question);
  const buf = Buffer.alloc(256);
  let n = 0;
  try { n = fs.readSync(0, buf, 0, buf.length, null); } catch { return 'n'; }
  return buf.toString('utf8', 0, n).trim();
}
function codegraphCli(o, states) {
  const given = o.codegraphCli || states.map(s => s.options?.codegraphCli).find(Boolean) || '';
  const cmd = given || 'codegraph';
  if (DRY) return { cmd, installed: false };
  if (cliWorks(cmd)) {
    const v = cliVersion(cmd);
    if (v && !/^1\.6\./.test(v)) log(`  codegraph: ${v} on PATH; wesh is tested with 1.6.x`);
    return { cmd, installed: false };
  }
  if (given) { log(`  codegraph: ${cmd} does not run; codegraph wiring skipped`); return null; }
  if (process.env.WESH_NO_NPM) { log('  codegraph: CLI not found and npm installs are disabled (WESH_NO_NPM); skipped'); return null; }
  // npm -g changes the machine: ask first, and never do it silently in a script.
  if (!process.stdin.isTTY) {
    log(`  codegraph: not found on PATH, and this is not a terminal. Install it yourself: npm i -g ${CODEGRAPH_PKG} (or re-run with --codegraph-cli <path>)`);
    return null;
  }
  const answer = ask(`  codegraph: not found on PATH. Install ${CODEGRAPH_PKG} globally with npm (removed again by --uninstall)? [Y/n] `);
  if (/^n/i.test(answer)) { log(`  codegraph: skipped. Install it later with npm i -g ${CODEGRAPH_PKG}, then re-run with --codegraph`); return null; }
  log(`  codegraph: installing ${CODEGRAPH_PKG} with npm`);
  const r = run('npm', ['install', '-g', '--no-audit', '--no-fund', CODEGRAPH_PKG]);
  if (r.status !== 0 || !cliWorks(cmd)) {
    log(`  codegraph: install failed. Install it yourself (npm i -g ${CODEGRAPH_PKG}) and re-run with --codegraph; skipped for now`);
    return null;
  }
  for (const st of states) { st.codegraphCliInstalled = true; st.codegraphCliVersion = cliVersion(cmd); }
  return { cmd, installed: true };
}
function opencodeMajor(o, p) {
  if (o.opencodeVersion) return Number(o.opencodeVersion);
  // The config already there says which OpenCode reads it (V1 lists MCP servers under mcp, V2 under mcp.servers).
  try {
    const c = JSON.parse(fs.readFileSync(p.ocConfig, 'utf8').replace(/^﻿/, ''));
    if (isObj(c.mcp?.servers)) return 2;
    if (isObj(c.mcp) && Object.values(c.mcp).some(v => isObj(v) && v.type)) return 1;
  } catch {}
  // Ask in a throwaway home: the version probe must not touch the user's config folders.
  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'wesh-oc-version-'));
  try {
    const r = run('opencode', ['--version'], undefined, { ...process.env, HOME: iso, USERPROFILE: iso,
      XDG_CONFIG_HOME: path.join(iso, 'config'), XDG_DATA_HOME: path.join(iso, 'data'), XDG_STATE_HOME: path.join(iso, 'state'), XDG_CACHE_HOME: path.join(iso, 'cache') });
    const m = /(\d+)\.\d+/.exec(`${r.stdout || ''}`);
    return m ? Number(m[1]) : 2; // not on PATH: assume the current OpenCode 2
  } finally { fs.rmSync(iso, { recursive: true, force: true }); }
}
const scoutForClaude = codegraph => {
  const text = srcText('agents', 'wesh-scout.md');
  return codegraph ? text.replace(/^tools: (.*)$/m, `tools: $1, ${CODEGRAPH_TOOL}`) : text;
};

const AUTOINDEX_FILES = ['autoindex.mjs'];
// node: the background index jobs run on this Node, also from inside OpenCode (whose own runtime is not Node).
function writeAutoindex(dir, cmd) {
  for (const f of AUTOINDEX_FILES) write(path.join(dir, f), srcText('hooks', f));
  write(path.join(dir, 'codegraph.json'), JSON.stringify({ cmd, node: process.execPath }, null, 2) + '\n');
}
// Indexes wesh built (listed by the auto-indexer) go away with codegraph; ones you built yourself stay.
// A root that failed (index in use) stays listed, so a later --no-codegraph or uninstall can try again.
function removeAutoIndexes(dirs, cmd) {
  const roots = new Set();
  for (const d of dirs) { try { for (const l of fs.readFileSync(path.join(d, 'autoindex.log'), 'utf8').split('\n')) if (l.trim()) roots.add(l.trim()); } catch {} }
  const left = [];
  for (const r of roots) {
    if (forbidden(r)) { log(`  skipped ${r}: wesh never removes a code graph from a home, temp or drive-root folder`); continue; }
    if (!fs.existsSync(path.join(r, '.codegraph'))) continue;
    if (DRY) { log(`  would remove the code graph wesh built in ${r}`); continue; }
    const res = run(cmd, ['uninit', '--force', r]);
    if (res.status === 0) log(`  removed the code graph wesh built in ${r}`);
    else { left.push(r); log(`  could not remove ${path.join(r, '.codegraph')} (in use? close the agent first); run later: codegraph uninit --force "${r}"`); }
  }
  if (DRY) return;
  for (const d of dirs) { try { if (fs.existsSync(path.join(d, 'autoindex.log'))) fs.rmSync(path.join(d, 'autoindex.log'), { force: true }); } catch {} }
  if (left.length) { const d = dirs.find(x => fs.existsSync(x)); if (d) fs.writeFileSync(path.join(d, 'autoindex.log'), left.join('\n') + '\n'); }
}
// codegraph's CLI, its telemetry switch and the project indexes are shared by both hosts: they go only when no host
// that stays installed still uses codegraph.
const otherHostKeepsCodegraph = (o, p) => (o.target === 'claude' && fs.existsSync(path.join(p.ocWesh, 'codegraph.json')))
  || (o.target === 'opencode' && fs.existsSync(path.join(p.claudeWesh, 'codegraph.json')));
function releaseSharedCodegraph(o, p, states) {
  if (otherHostKeepsCodegraph(o, p)) {
    // The indexes this host listed are handed to the host that stays, so its uninstall still cleans them up.
    const [from, to] = o.target === 'claude' ? [p.claudeWesh, p.ocWesh] : [p.ocWesh, p.claudeWesh];
    try {
      const mine = fs.readFileSync(path.join(from, 'autoindex.log'), 'utf8').split('\n').filter(Boolean);
      const theirs = fs.existsSync(path.join(to, 'autoindex.log')) ? fs.readFileSync(path.join(to, 'autoindex.log'), 'utf8').split('\n').filter(Boolean) : [];
      if (!DRY) fs.writeFileSync(path.join(to, 'autoindex.log'), [...new Set([...theirs, ...mine])].join('\n') + '\n');
    } catch {}
    return log(`  codegraph: still used by ${o.target === 'claude' ? 'OpenCode' : 'Claude Code'}; CLI, telemetry and indexes kept`);
  }
  removeAutoIndexes([p.claudeWesh, p.ocWesh], states.map(s => s.options?.codegraphCli).find(Boolean) || 'codegraph');
  restoreTelemetry(states); // before the CLI goes: it is what sets the switch back
  removeCodegraphCli(states);
}

// MCP wiring. Entries that already exist (the user's own, or codegraph's installer) are left alone and never removed;
// the entry wesh wrote itself is brought up to date (a new --codegraph-cli path, a new OpenCode config shape).
const weshAdded = (fsx, key) => (fsx.added[key] || []).includes('codegraph');
function wireClaudeCodegraph(p, st, cmd) {
  editJson(p.claudeMcp, st, (c, fsx) => {
    const servers = ensure(c, ['mcpServers'], 'object', fsx);
    if (servers.codegraph && !weshAdded(fsx, 'mcpServers')) return;
    servers.codegraph = { type: 'stdio', command: cmd, args: ['serve', '--mcp'], alwaysLoad: true, env: { CODEGRAPH_TELEMETRY: '0' } };
    addTo(fsx, 'mcpServers', 'codegraph');
  }, `  "mcpServers": { "codegraph": { "type": "stdio", "command": "${cmd.replace(/\\/g, '/')}", "args": ["serve", "--mcp"], "alwaysLoad": true } }`);
  editJson(p.claudeSettings, st, (s, fsx) => {
    const allow = ensure(s, ['permissions', 'allow'], 'array', fsx);
    if (!allow.includes(CODEGRAPH_ALLOW)) { allow.push(CODEGRAPH_ALLOW); addTo(fsx, 'permissions.allow', CODEGRAPH_ALLOW); }
    // startup and resume sync what changed since the last session; clear and compact keep it current mid-day.
    upsertHook(ensure(s, ['hooks', 'SessionStart'], 'array', fsx), 'claude-autoindex.mjs', 'startup|resume|clear|compact', p.autoindexHook);
  }, `  "permissions": { "allow": ["${CODEGRAPH_ALLOW}"] }, "hooks": { "SessionStart": [{ "hooks": [${JSON.stringify(p.autoindexHook)}] }] }`);
  writeAutoindex(p.claudeWesh, cmd);
  write(path.join(p.claudeWesh, 'claude-autoindex.mjs'), srcText('hooks', 'claude-autoindex.mjs'));
}
const hasAdded = (st, file, keys) => keys.some(k => (st.files[path.basename(file)]?.added?.[k] || []).length);
function unwireClaudeCodegraph(p, st) {
  if (fs.existsSync(p.claudeMcp) && hasAdded(st, p.claudeMcp, ['mcpServers'])) editJson(p.claudeMcp, st, (c, fsx) => {
    if (isObj(c.mcpServers)) for (const k of fsx.added.mcpServers || []) delete c.mcpServers[k];
    fsx.added.mcpServers = [];
    dropEmptyContainers(c, fsx);
  }, '');
  if (fs.existsSync(p.claudeSettings)) editJson(p.claudeSettings, st, (s, fsx) => {
    const added = fsx.added['permissions.allow'] || [];
    if (Array.isArray(s.permissions?.allow)) s.permissions.allow = s.permissions.allow.filter(r => !added.includes(r));
    dropHook(s, 'SessionStart', 'claude-autoindex.mjs');
    delete fsx.added['permissions.allow'];
    dropEmptyContainers(s, fsx);
  }, '');
  for (const f of [...AUTOINDEX_FILES, 'claude-autoindex.mjs', 'codegraph.json']) remove(path.join(p.claudeWesh, f));
}
// The squeeze hook and the guard rules are remembered like codegraph: turning one off removes what wesh added.
function unwireClaudeSqueeze(p, st) {
  if (fs.existsSync(p.claudeSettings)) editJson(p.claudeSettings, st, (s, fsx) => {
    dropHook(s, 'PostToolUse', 'claude-squeeze.mjs');
    dropEmptyContainers(s, fsx);
  }, '');
  for (const f of ['squeeze.mjs', 'claude-squeeze.mjs']) remove(path.join(p.claudeWesh, f));
}
function unwireOpencodeSqueeze(p) {
  remove(p.ocPlugin);
  remove(path.join(p.ocWesh, 'squeeze.mjs'));
}
function unwireClaudeGuard(p, st) {
  if (!fs.existsSync(p.claudeSettings)) return;
  editJson(p.claudeSettings, st, (s, fsx) => {
    const ask = fsx.added['permissions.ask'] || [];
    if (Array.isArray(s.permissions?.ask)) s.permissions.ask = s.permissions.ask.filter(r => !ask.includes(r));
    delete fsx.added['permissions.ask']; // a rule you add later is yours
    dropEmptyContainers(s, fsx);
  }, '');
}
function unwireOpencodeGuard(p, st) {
  if (!fs.existsSync(p.ocConfig)) return;
  editJson(p.ocConfig, st, (c, fsx) => {
    const list = fsx.added['permission.bash'] || [];
    if (isObj(c.permission?.bash)) for (const k of list) delete c.permission.bash[k];
    delete fsx.added['permission.bash']; // a rule you add later is yours
    dropEmptyContainers(c, fsx);
  }, '');
}
function wireOpencodeCodegraph(p, st, cmd, major, schema) {
  editJson(p.ocConfig, st, (c, fsx) => {
    schema(c, fsx);
    const mineV2 = weshAdded(fsx, 'mcp.servers'), mineV1 = weshAdded(fsx, 'mcp');
    if ((c.mcp?.servers?.codegraph && !mineV2) || (c.mcp?.codegraph && !mineV1)) return;
    // wesh's own entry in the other shape (OpenCode was upgraded, or downgraded): moved, not duplicated.
    if (major >= 2 && mineV1 && isObj(c.mcp)) { delete c.mcp.codegraph; fsx.added.mcp = (fsx.added.mcp || []).filter(k => k !== 'codegraph'); }
    if (major < 2 && mineV2 && isObj(c.mcp?.servers)) { delete c.mcp.servers.codegraph; fsx.added['mcp.servers'] = (fsx.added['mcp.servers'] || []).filter(k => k !== 'codegraph'); dropEmptyContainers(c, fsx); }
    if (major >= 2) {
      ensure(c, ['mcp', 'servers'], 'object', fsx).codegraph = { type: 'local', command: [cmd, 'serve', '--mcp'], disabled: false, codemode: false, environment: { CODEGRAPH_TELEMETRY: '0' } };
      addTo(fsx, 'mcp.servers', 'codegraph');
    } else {
      ensure(c, ['mcp'], 'object', fsx).codegraph = { type: 'local', command: [cmd, 'serve', '--mcp'], enabled: true, environment: { CODEGRAPH_TELEMETRY: '0' } };
      addTo(fsx, 'mcp', 'codegraph');
    }
  }, major >= 2 ? '  "mcp": { "servers": { "codegraph": { "type": "local", "command": ["codegraph", "serve", "--mcp"], "codemode": false } } }'
    : '  "mcp": { "codegraph": { "type": "local", "command": ["codegraph", "serve", "--mcp"], "enabled": true } }');
  writeAutoindex(p.ocWesh, cmd);
  write(p.ocCgPlugin, srcText('hooks', 'opencode-codegraph.js'));
}
function unwireOpencodeCodegraph(p, st) {
  if (fs.existsSync(p.ocConfig) && hasAdded(st, p.ocConfig, ['mcp.servers', 'mcp'])) editJson(p.ocConfig, st, (c, fsx) => {
    for (const k of fsx.added['mcp.servers'] || []) if (isObj(c.mcp?.servers)) delete c.mcp.servers[k];
    for (const k of fsx.added.mcp || []) if (isObj(c.mcp)) delete c.mcp[k];
    fsx.added['mcp.servers'] = []; fsx.added.mcp = [];
    dropEmptyContainers(c, fsx);
  }, '');
  remove(p.ocCgPlugin);
  for (const f of [...AUTOINDEX_FILES, 'codegraph.json']) remove(path.join(p.ocWesh, f));
}
function removeCodegraphCli(states) {
  if (!states.some(s => s.codegraphCliInstalled) || DRY) return;
  // Only take away the exact version wesh installed: an upgraded CLI is the user's now.
  const cmd = states.map(s => s.options?.codegraphCli).find(Boolean) || 'codegraph';
  const version = cliVersion(cmd);
  const installed = states.map(s => s.codegraphCliVersion).find(Boolean) || '';
  if (installed && version && installed !== version) {
    log(`  codegraph: ${version} is not the ${installed} wesh installed; leaving the CLI alone`);
  } else {
    log('  codegraph: removing the CLI wesh installed');
    run('npm', ['uninstall', '-g', CODEGRAPH_PKG.replace(/@[\d.]+$/, '')]);
  }
  for (const st of states) delete st.codegraphCliInstalled;
  log('  codegraph: project indexes (.codegraph/ folders) are yours; remove one with `codegraph uninit`');
}
// Give the user back the telemetry setting wesh found.
function restoreTelemetry(states) {
  const prev = states.map(s => s.options?.telemetry).find(Boolean);
  if (prev !== 'enabled') return;
  const cmd = states.map(s => s.options?.codegraphCli).find(Boolean) || 'codegraph';
  if (DRY || !cliWorks(cmd)) return;
  run(cmd, ['telemetry', 'on']);
  for (const st of states) if (st.options) delete st.options.telemetry;
  log('  codegraph: telemetry back on (as it was before wesh)');
}
function installedLevel(p, target) {
  for (const f of target === 'opencode' ? [p.ocCore, p.claudeRules] : [p.claudeRules, p.ocCore]) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      const i = text.indexOf(BEGIN);
      const m = /Level: `(lite|full|ultra)`/.exec(i >= 0 ? text.slice(i) : f === p.ocCore ? text : '');
      if (m) return m[1];
    } catch {}
  }
  return '';
}
function upsertBlock(file, block, st) {
  const fsx = fileState(st, file);
  const exists = fs.existsSync(file);
  const old = exists ? fs.readFileSync(file, 'utf8') : '';
  const i = old.indexOf(BEGIN), j = old.indexOf(END, Math.max(0, i)); // the end marker that follows the begin one
  if (i >= 0 && j < i) return log(`  ${file}: wesh begin marker without end marker; fix the file by hand, skipped`);
  const next = i >= 0 ? old.slice(0, i) + block + old.slice(j + END.length)
    : old ? old + (old.endsWith('\n') ? '\n' : '\n\n') + block + '\n' : block + '\n';
  if (!exists) fsx.created = true;
  if (next === old) return;
  if (!fsx.created) backup(file);
  write(file, next);
  log(`  ${file}: wesh block ${i >= 0 ? 'updated' : 'added'}`);
}
function stripBlock(file, st) {
  if (!fs.existsSync(file)) return;
  const old = fs.readFileSync(file, 'utf8');
  const i = old.indexOf(BEGIN), j = old.indexOf(END, Math.max(0, i));
  if (i < 0) return;
  if (j < i) return log(`  ${file}: wesh begin marker without end marker; remove the block by hand`);
  let start = i, end = j + END.length;
  if (old[end] === '\n') end++;
  if (old.slice(start - 2, start) === '\n\n') start--; // the blank line wesh inserted before the block
  const next = old.slice(0, start) + old.slice(end);
  if (!next.trim() && fileState(st, file).created) remove(file);
  else { write(file, next); log(`  ${file}: wesh block removed`); }
}

// JSON config edit. JSONC (comments) or unexpected shapes are never rewritten: the change is printed instead.
class Manual extends Error {}
function editJson(file, st, mutate, manual) {
  const fsx = fileState(st, file);
  let obj = {}, indent = 2;
  const exists = fs.existsSync(file);
  if (!exists) fsx.created = true;
  if (exists) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    try { obj = raw.trim() ? JSON.parse(raw) : {}; } catch { obj = undefined; }
    indent = (raw.match(/^([ \t]+)"/m) || [])[1] || 2;
  }
  const say = why => { if (manual) log(`  ${file}: ${why}. Change it by hand:\n${manual}`); };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return say('not plain JSON (comments?)');
  const before = JSON.stringify(obj);
  try { mutate(obj, fsx); } catch (e) { if (e instanceof Manual) return say(e.message); throw e; }
  if (JSON.stringify(obj) === before) return; // unchanged: nothing to report
  if (!Object.keys(obj).length && fsx.created) { remove(file); return; }
  if (exists && !fsx.created) backup(file);
  write(file, JSON.stringify(obj, null, indent) + '\n');
  log(`  ${file}: updated`);
}
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
// Get or create a container at a dotted path, recording the ones wesh creates.
function ensure(obj, keys, kind, fsx) {
  let cur = obj;
  keys.forEach((k, n) => {
    const last = n === keys.length - 1;
    if (cur[k] === undefined) { cur[k] = last && kind === 'array' ? [] : {}; fsx.containers.push(keys.slice(0, n + 1).join('.')); }
    if (last ? (kind === 'array' ? !Array.isArray(cur[k]) : !isObj(cur[k])) : !isObj(cur[k])) throw new Manual(`"${keys.slice(0, n + 1).join('.')}" has an unexpected type`);
    cur = cur[k];
  });
  fsx.containers = [...new Set(fsx.containers)];
  return cur;
}
const addTo = (fsx, key, v) => { const a = (fsx.added[key] ??= []); if (!a.includes(v)) a.push(v); };
// Uninstall: delete containers wesh created once they are empty again (deepest first).
function dropEmptyContainers(obj, fsx) {
  for (const c of [...fsx.containers].sort((a, b) => b.split('.').length - a.split('.').length)) {
    const keys = c.split('.'), parent = keys.slice(0, -1).reduce((o, k) => (isObj(o) ? o[k] : undefined), obj);
    const v = parent?.[keys.at(-1)];
    if (isObj(parent) && ((Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length))) delete parent[keys.at(-1)];
  }
}

// OpenCode rejects a tools array and provider-less model ids; without a model the scout inherits the caller's.
// The scout only reads: everything is denied first, then the read tools are allowed back.
function opencodeAgent(text, model, { codegraph = false } = {}) {
  const perms = ['  "*": deny', '  read: allow', '  glob: allow', '  grep: allow'];
  if (codegraph) perms.push(`  ${CODEGRAPH_OC_TOOL}: allow`);
  return text.replace(/^tools:.*\n/m, '').replace(/^model:.*\n/m, model ? `model: ${model}\n` : '')
    .replace(/^---\n([\s\S]*?)\n---/, (m, fm) => {
      // Without a cheap model the scout runs on the caller's: it must not claim to be cheap.
      const head = model ? fm : fm.replace(/^description: Cheap /m, 'description: Read-only ');
      return `---\n${head}\nmode: subagent\npermission:\n${perms.join('\n')}\n---`;
    });
}

// The cheap model the scout should run on: what the user asked for, then what the last install used,
// then the config's small_model. Without one the scout would run on the main model, which is not cheap.
function scoutModel(o, st, p) {
  if (o.scoutModel) return o.scoutModel;
  if (st.options?.scoutModel) return st.options.scoutModel;
  try {
    const cfg = JSON.parse(fs.readFileSync(p.ocConfig, 'utf8'));
    if (typeof cfg.small_model === 'string' && /^[\w.-]+\/[\w.:-]+$/.test(cfg.small_model)) return cfg.small_model;
  } catch {}
  return '';
}

// OpenCode ignores disable-model-invocation, so user-only skills become commands carrying the whole skill text.
function opencodeCommand(name) {
  const text = readSkill(name).replace(/\r\n/g, '\n');
  const desc = frontField(text, 'description').replace(/"/g, "'");
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return `---\ndescription: "${desc}"\n---\n${body}\n\nArguments: $ARGUMENTS\n`;
}

function install(o, p) {
  const both = o.target === 'both';
  const claudeFallback = both && !process.env.OPENCODE_DISABLE_CLAUDE_CODE;
  const stC = loadState(p.claudeWesh), stO = loadState(p.ocWesh);
  // codegraph is on by default. An explicit --codegraph / --no-codegraph is remembered; WESH_CODEGRAPH=0 turns the default off.
  const saved = [stC, stO].map(s => s.options?.codegraph).find(v => v !== undefined);
  const wantCg = o.codegraph ?? saved ?? (process.env.WESH_CODEGRAPH !== '0');
  const cg = wantCg ? codegraphCli(o, [stC, stO]) : null;
  if (cg && !DRY) {
    // The global switch is the user's setting: remember it and give it back on uninstall. Only the first install's
    // reading counts: on a re-install the switch reads "disabled" because wesh turned it off.
    const kept = [stC, stO].map(s => s.options?.telemetry).find(Boolean);
    const prev = kept || telemetryState(cg.cmd) || undefined;
    run(cg.cmd, ['telemetry', 'off']);
    for (const st of [stC, stO]) st.options = { ...st.options, telemetry: prev };
    log('  codegraph: CLI ready, telemetry off (your previous setting is restored on uninstall)');
  }
  if (o.codegraph === false) {
    releaseSharedCodegraph(o, p, [stC, stO]);
  }
  // Without a --level: the level in the installed block (the last install's, or a hand edit), else full.
  o.level ||= installedLevel(p, o.target) || 'full';
  for (const st of [stC, stO]) st.options = { ...st.options, codegraph: o.codegraph ?? saved,
    codegraphCli: wantCg ? (cg && cg.cmd !== 'codegraph' ? cg.cmd : st.options?.codegraphCli) : undefined };
  // Squeeze and guard are remembered too: turning one off takes away what the last install added.
  const savedSqueeze = [stC, stO].map(s => s.options?.squeeze).find(v => v !== undefined);
  const wantSqueeze = o.squeeze ?? savedSqueeze ?? true;
  const savedGuard = [stC, stO].map(s => s.options?.guard).find(v => v !== undefined);
  const wantGuard = o.guard ?? savedGuard ?? false;
  for (const st of [stC, stO]) st.options = { ...st.options, squeeze: wantSqueeze, guard: wantGuard };
  // The names this install put on disk: uninstall removes them even if a later wesh renames them.
  for (const st of [stC, stO]) st.options = { ...st.options, skills: [...new Set([...(st.options?.skills || []), ...skillNames()])] };
  if (o.target !== 'opencode') {
    log('Claude Code:');
    const st = stC;
    for (const n of skillNames()) copyDir(path.join(SRC, 'skills', n), path.join(p.claudeSkills, n));
    log(`  ${skillNames().length} skills -> ${p.claudeSkills}`);
    write(path.join(p.claudeAgents, 'wesh-scout.md'), scoutForClaude(!!cg));
    log(`  agent wesh-scout -> ${p.claudeAgents}`);
    upsertBlock(p.claudeRules, coreBlock(o.level, !!cg, fs.existsSync(p.claudeRules) && fs.readFileSync(p.claudeRules, 'utf8').includes('CODEGRAPH_START')), st);
    if (cg) { wireClaudeCodegraph(p, st, cg.cmd); log(`  codegraph MCP server -> ${p.claudeMcp}`); } else unwireClaudeCodegraph(p, st);
    if (wantSqueeze) {
      for (const f of ['squeeze.mjs', 'claude-squeeze.mjs']) write(path.join(p.claudeWesh, f), srcText('hooks', f));
      editJson(p.claudeSettings, st, (s, fsx) => {
        upsertHook(ensure(s, ['hooks', 'PostToolUse'], 'array', fsx), 'claude-squeeze.mjs', 'Bash|PowerShell', p.squeezeHook);
      }, JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Bash|PowerShell', hooks: [p.squeezeHook] }] } }, null, 2));
      log(`  squeeze hook (PostToolUse Bash|PowerShell) -> ${p.claudeWesh}`);
    } else { unwireClaudeSqueeze(p, st); log('  squeeze hook removed (--no-squeeze)'); }
    if (wantGuard) editJson(p.claudeSettings, st, (s, fsx) => {
      const ask = ensure(s, ['permissions', 'ask'], 'array', fsx);
      for (const r of GUARD_CLAUDE) if (!ask.includes(r)) { ask.push(r); addTo(fsx, 'permissions.ask', r); }
    }, JSON.stringify({ permissions: { ask: GUARD_CLAUDE } }, null, 2));
    else { unwireClaudeGuard(p, st); log('  git guard rules removed (--no-guard)'); }
    saveState(p.claudeWesh, st);
  }
  if (o.target !== 'claude') {
    log('OpenCode / OpenChamber:');
    const st = stO;
    const modelSkills = skillNames().filter(n => !USER_ONLY.includes(n));
    if (claudeFallback) {
      // Copies an earlier --target opencode install left would be listed a second time, and go stale.
      for (const n of skillNames()) if (fs.existsSync(path.join(p.ocSkills, n, 'SKILL.md'))) remove(path.join(p.ocSkills, n));
      log(`  skills: OpenCode reads ${p.claudeSkills} directly; not duplicated`);
    } else {
      for (const n of modelSkills) copyDir(path.join(SRC, 'skills', n), path.join(p.ocSkills, n));
      log(`  ${modelSkills.length} skills -> ${p.ocSkills}`);
    }
    const scout = scoutModel(o, st, p);
    st.options = { ...st.options, scoutModel: scout || undefined };
    write(path.join(p.ocAgents, 'wesh-scout.md'), opencodeAgent(srcText('agents', 'wesh-scout.md'), scout, { codegraph: !!cg }));
    log(scout ? `  agent wesh-scout (subagent, model: ${scout}) -> ${p.ocAgents}`
      : '  agent wesh-scout (subagent, model: the caller\'s — set small_model or pass --scout-model to make it cheap) -> ' + p.ocAgents);
    for (const n of USER_ONLY) write(path.join(p.ocCommands, `${n}.md`), opencodeCommand(n));
    log(`  commands /${USER_ONLY.join(' /')} -> ${p.ocCommands}`);
    if (wantSqueeze) {
      write(path.join(p.ocWesh, 'squeeze.mjs'), srcText('hooks', 'squeeze.mjs'));
      write(p.ocPlugin, srcText('hooks', 'opencode-squeeze.js'));
      log(`  squeeze plugin (bash output) -> ${p.ocPlugin}`);
    } else { unwireOpencodeSqueeze(p); log('  squeeze plugin removed (--no-squeeze)'); }
    const schema = (c, fsx) => { if (fsx.created || !fs.existsSync(p.ocConfig)) c.$schema ??= 'https://opencode.ai/config.json'; };
    // OpenCode also sees ~/.claude/skills: hide the user-only ones from the model (the commands carry their text).
    // Always: OpenCode may read ~/.claude/skills at run time even if the installer's shell had it switched off.
    editJson(p.ocConfig, st, (c, fsx) => {
      schema(c, fsx);
      const skill = ensure(c, ['permission', 'skill'], 'object', fsx);
      for (const n of USER_ONLY) if (skill[n] === undefined) { skill[n] = 'deny'; addTo(fsx, 'permission.skill', n); }
    }, `  "permission": { "skill": { ${USER_ONLY.map(n => `"${n}": "deny"`).join(', ')} } }`);
    // Core rules through `instructions`, which OpenCode 1 and 2 both read. OpenCode 2 has no CLAUDE.md fallback;
    // on OpenCode 1 with that fallback active the rules would load twice (cached, ~850 tokens).
    const majorForRules = claudeFallback ? opencodeMajor(o, p) : 2;
    const doubleRules = claudeFallback && majorForRules < 2;
    write(p.ocCore, coreBlock(o.level, !!cg).split('\n').slice(1, -1).join('\n') + '\n');
    editJson(p.ocConfig, st, (c, fsx) => {
      schema(c, fsx);
      if (doubleRules) {
        if (Array.isArray(c.instructions)) {
          const i = c.instructions.indexOf(p.ocCoreRef);
          if (i >= 0) c.instructions.splice(i, 1);
          fsx.added.instructions = (fsx.added.instructions || []).filter(x => x !== p.ocCoreRef);
        }
        return;
      }
      const ins = ensure(c, ['instructions'], 'array', fsx);
      if (!ins.includes(p.ocCoreRef)) { ins.push(p.ocCoreRef); addTo(fsx, 'instructions', p.ocCoreRef); }
    }, `  "instructions": ["${p.ocCoreRef.replace(/\\/g, '/')}"]`);
    log(doubleRules ? `  core rules -> ${p.claudeRules} (OpenCode 1 reads CLAUDE.md too; no second copy)` : `  core rules -> ${p.ocCore} (via "instructions")`);
    if (cg) {
      const major = opencodeMajor(o, p);
      wireOpencodeCodegraph(p, st, cg.cmd, major, schema);
      log(`  codegraph MCP server -> ${p.ocConfig} (OpenCode ${major} format)`);
    } else unwireOpencodeCodegraph(p, st);
    if (wantGuard) editJson(p.ocConfig, st, (c, fsx) => {
      schema(c, fsx);
      const bash = ensure(c, ['permission', 'bash'], 'object', fsx);
      if (bash['*'] === 'deny') return log('  guard: bash is already deny-by-default; nothing added');
      for (const g of GUARD_OPENCODE) if (bash[g] === undefined) { bash[g] = 'ask'; addTo(fsx, 'permission.bash', g); }
    }, `  "permission": { "bash": { ${GUARD_OPENCODE.map(g => `"${g}": "ask"`).join(', ')} } }`);
    else { unwireOpencodeGuard(p, st); log('  git guard rules removed (--no-guard)'); }
    saveState(p.ocWesh, st);
  }
  log(`\nDone. Restart Claude Code / OpenCode / OpenChamber. Level: ${o.level}. Try /wesh help.`);
  if (cg) log('codegraph: on. Each project gets its code graph automatically the first time a session opens it (set WESH_AUTOINDEX=0 to stop that).');
}

function uninstall(o, p) {
  const shipped = skillNames();
  const stC = loadState(p.claudeWesh), stO = loadState(p.ocWesh);
  // Skills that an older wesh installed under another name are still ours to remove.
  const all = st => [...new Set([...shipped, ...(st.options?.skills || [])])];
  releaseSharedCodegraph(o, p, [stC, stO]);
  if (o.target !== 'opencode') {
    const st = stC;
    for (const n of all(st)) remove(path.join(p.claudeSkills, n));
    remove(path.join(p.claudeAgents, 'wesh-scout.md'));
    stripBlock(p.claudeRules, st);
    unwireClaudeCodegraph(p, st);
    if (fs.existsSync(p.claudeSettings)) editJson(p.claudeSettings, st, (s, fsx) => {
      const ask = fsx.added['permissions.ask'] || [];
      if (Array.isArray(s.permissions?.ask)) s.permissions.ask = s.permissions.ask.filter(r => !ask.includes(r));
      dropHook(s, 'PostToolUse', 'claude-squeeze.mjs');
      dropEmptyContainers(s, fsx);
    }, '');
    remove(p.claudeWesh);
  }
  if (o.target !== 'claude') {
    const st = stO;
    unwireOpencodeCodegraph(p, st);
    for (const n of all(st)) remove(path.join(p.ocSkills, n));
    remove(path.join(p.ocAgents, 'wesh-scout.md'));
    for (const n of USER_ONLY) remove(path.join(p.ocCommands, `${n}.md`));
    remove(p.ocPlugin);
    stripBlock(p.ocRules, st); // older installs
    if (fs.existsSync(p.ocConfig)) editJson(p.ocConfig, st, (c, fsx) => {
      const added = fsx.added;
      if (Array.isArray(c.instructions)) c.instructions = c.instructions.filter(x => !(added.instructions || []).includes(x));
      for (const [key, list] of [['bash', added['permission.bash']], ['skill', added['permission.skill']]])
        if (isObj(c.permission?.[key])) for (const k of list || []) delete c.permission[key][k];
      dropEmptyContainers(c, fsx);
      if (fsx.created && Object.keys(c).every(k => k === '$schema')) delete c.$schema;
    }, '');
    remove(p.ocWesh);
  }
  // Folders wesh may have created, deepest first; non-empty ones (your files) stay.
  for (const dir of [p.claudeSkills, p.claudeAgents, p.ocSkills, p.ocAgents, p.ocCommands, path.dirname(p.ocPlugin), path.dirname(p.ocWesh)])
    removeIfEmpty(dir);
  if (o.scope === 'project') removeIfEmpty(path.dirname(p.claudeSkills));
  // The squeeze's saved raw outputs (they can hold secrets) go with the last wesh install of this user. A --home
  // sandbox never touches the real folder.
  if (o.scope === 'user' && !o.homeGiven && !fs.existsSync(p.claudeWesh) && !fs.existsSync(p.ocWesh))
    remove(process.platform === 'win32' ? path.join(os.tmpdir(), 'wesh-squeeze') : path.join(os.homedir(), '.cache', 'wesh-squeeze'));
  log('wesh uninstalled. The *.wesh-bak files are the copies taken before wesh first changed each file (they may be old); restore one only by hand.');
}

// Default target: the agents found on this machine; both when neither is found (e.g. installing before the agents).
function detectTarget(o, p) {
  const onPath = cmd => run(cmd, ['--version']).status === 0;
  const claude = fs.existsSync(path.dirname(p.claudeSkills)) || (!o.homeGiven && onPath('claude'));
  const opencode = fs.existsSync(path.dirname(p.ocSkills)) || (!o.homeGiven && onPath('opencode'));
  return claude && !opencode ? 'claude' : opencode && !claude ? 'opencode' : 'both';
}

try {
  const o = parseArgs(process.argv.slice(2));
  DRY = o.dryRun;
  const p = paths(o);
  if (!o.target) {
    o.target = o.uninstall ? 'both' : detectTarget(o, p);
    if (!o.uninstall) log(`Installing for: ${o.target === 'both' ? 'Claude Code and OpenCode' : o.target === 'claude' ? 'Claude Code' : 'OpenCode / OpenChamber'} (change with --target)`);
  }
  (o.uninstall ? uninstall : install)(o, p);
} catch (e) {
  console.error(`wesh install: ${e.message}`);
  process.exit(1);
}
