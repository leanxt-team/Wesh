// Shell-output squeezer shared by the Claude Code hook and the OpenCode plugin.
// Lossless for the agent: noise is dropped from what it sees, the full output is saved to a file it can grep.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LIMIT = Number(process.env.WESH_SQUEEZE_LIMIT) || 4000; // chars; smaller outputs pass untouched
const HEAD = 30, TAIL = 40, CONTEXT = 2, BLOCK = 12, MAX_KEEP = 400;

// Which command produced the output: split it into segments and look at each segment's leading executable.
// A pattern that happens to name a tool ("grep -rn pytest .") is a search, not a build.
const PAYLOAD_CMDS = new Set(['cat', 'type', 'gc', 'get-content', 'head', 'tail', 'less', 'more', 'bat', 'jq', 'yq',
  'xxd', 'base64', 'awk', 'grep', 'rg', 'ag', 'ack', 'ripgrep', 'find', 'fd', 'ls', 'dir', 'tree', 'select-string',
  'sls', 'wc', 'sort', 'uniq']);
const GIT_PAYLOAD = new Set(['diff', 'show', 'log', 'blame', 'cat-file', 'grep', 'status', 'ls-files', 'shortlog']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PM_NOISY = new Set(['i', 'install', 'ci', 'add', 'update', 'test', 'audit']);
const PM_RUN_NOISY = new Set(['build', 'test', 'lint', 'typecheck', 'check', 'ci']);
const PIP_NOISY = new Set(['install', 'sync', 'add']);
const NOISY_CMDS = new Set(['pytest', 'jest', 'vitest', 'mocha', 'tsc', 'eslint', 'ruff', 'mypy', 'make', 'cmake',
  'ninja', 'gradle', 'gradlew', 'mvn', 'mvnw', 'webpack', 'tox', 'nox', 'rspec', 'phpunit', 'unittest', 'pylint', 'flake8',
  'playwright', 'cypress', 'msbuild']);
// Prefixes that only wrap the real command: "sudo npm install", "npx vitest run", "env FOO=1 pytest".
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'time', 'nohup', 'command', 'exec', 'builtin', 'xargs', 'stdbuf',
  'npx', 'pnpx', 'bunx', 'uvx', 'pipx', 'setsid', 'nice', 'ionice']);

// Split on shell separators, ignoring separators inside quotes.
function segments(command) {
  const out = [];
  let cur = '', quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if ((c === '&' || c === '|') && command[i + 1] === c) { out.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '|' || c === '&') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// Runners whose next word is the real command: "uv run pytest", "pnpm exec vitest", "python -m pytest".
const RUNNERS = { uv: 'run', poetry: 'run', pdm: 'run', hatch: 'run', pipenv: 'run', rye: 'run', npm: 'exec', pnpm: 'exec', yarn: 'dlx', bun: 'x' };
const PYTHONS = /^(python[\d.]*|py)$/;

// The executable a segment runs, with wrappers, env assignments (also PowerShell's `$env:X=1;` prefix, which
// segments() splits off), paths and Windows extensions stripped: "./node_modules/.bin/jest", "npm.cmd", "& 'C:\x\npx.cmd'".
function commandOf(segment) {
  let toks = (segment.replace(/^[(&\s]+/, '').match(/'[^']*'|"[^"]*"|\S+/g) || []).filter(t => !/^[A-Za-z_]\w*=/.test(t));
  const clean = t => (t || '').replace(/^['"&]+|['"]$/g, '').toLowerCase();
  const exe = t => clean(t).split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1)$/, '');
  for (;;) {
    const cmd = exe(toks[0]);
    if (WRAPPERS.has(cmd) && toks.length > 1) { toks = toks.slice(1); continue; }
    if (RUNNERS[cmd] && clean(toks[1]) === RUNNERS[cmd] && toks.length > 2) { toks = toks.slice(2); continue; }
    if (PYTHONS.test(cmd) && clean(toks[1]) === '-m' && toks.length > 2) { toks = toks.slice(2); continue; }
    break;
  }
  const cmd = exe(toks[0]);
  // Leading options are not the subcommand: "npm --prefix app test", "node --import ./hooks.mjs --test a.mjs".
  // Options that take a value also skip that value.
  let rest = toks.slice(1).map(clean);
  const withValue = /^(--prefix|-c|--workspace|-w|--filter|--dir|--cwd|--import|-r|--require|--loader|--experimental-loader|--env-file)$/;
  const flags = [];
  while (rest.length && rest[0].startsWith('-')) { flags.push(rest[0]); rest = rest.slice(withValue.test(rest[0]) ? 2 : 1); }
  return { cmd, sub: rest[0] || '', third: rest[1] || '', flags, segment };
}

// Output the user asked to see is payload, even inside a noisy pipeline.
function isPayload({ cmd, sub, segment }) {
  if (PAYLOAD_CMDS.has(cmd)) return true;
  if (cmd === 'sed' && /(^|\s)-(n|p)\b/.test(segment)) return true;
  if (cmd === 'git' && GIT_PAYLOAD.has(sub)) return true;
  if (cmd === 'npm' && sub === 'ls') return true;
  return false;
}

// Only known noisy build/test/install runs are squeezed; listings, searches and script output are payload.
// A script whose path names a test, build, lint or check run: "node test/run.mjs", "tsx scripts/build.ts".
const RUNNER_SCRIPT = /(^|[\\/])(tests?|spec|__tests__)[\\/]|(^|[\\/])(run[-_]?)?(tests?|build|lint|check|ci)[\w.-]*\.(m?[jt]s|c?js)$/;
function isNoisy({ cmd, sub, third, flags = [] }) {
  if (['node', 'tsx', 'ts-node', 'deno'].includes(cmd)) return flags.includes('--test') || sub === '--test' || sub === 'test' || RUNNER_SCRIPT.test(sub);
  // A script name counts by its first part: "test:unit", "build:prod".
  const script = s => PM_RUN_NOISY.has((s || '').split(':')[0]);
  if (PACKAGE_MANAGERS.has(cmd)) {
    if (PM_NOISY.has(sub) || NOISY_CMDS.has(sub)) return true; // "pnpm vitest", "yarn jest"
    if (sub === 'run' || sub === 'run-script') return script(third);
    return cmd !== 'npm' && script(sub); // yarn/pnpm/bun run scripts without "run"
  }
  if (cmd === 'uv' && sub === 'pip') return PIP_NOISY.has(third);
  if (['pip', 'pip3', 'poetry', 'uv', 'pdm'].includes(cmd)) return PIP_NOISY.has(sub);
  if (cmd === 'cargo') return ['build', 'test', 'check', 'clippy', 'nextest'].includes(sub);
  if (cmd === 'go') return ['build', 'test', 'vet'].includes(sub);
  if (cmd === 'dotnet') return ['build', 'test', 'restore'].includes(sub);
  if (cmd === 'docker') return ['build', 'compose', 'pull'].includes(sub);
  if (cmd === 'terraform') return ['plan', 'apply', 'init'].includes(sub);
  if (['vite', 'next', 'nuxt', 'ng'].includes(cmd)) return sub === 'build';
  if (cmd === 'bundle' || cmd === 'composer') return sub === 'install';
  if (['apt-get', 'apt', 'brew'].includes(cmd)) return sub === 'install';
  return NOISY_CMDS.has(cmd);
}
const WORDS = /error|fail|exception|traceback|panic|fatal|assert|expected|received|warn|denied|not found|cannot|can't|unable|undefined|refused|timed? ?out|segfault|abort|mismatch|\bgot\b.*\bwant|\bwant\b.*\bgot|✗|✖|×|❌|^\s+at \S|\S+\.\w+:\d+:\d+|^\s*File "|^E\s|^\s*[-+]\s/i;
const CODES = /\b(E|TS|CS|ERR|SQLSTATE)\d{3,5}\b/; // case-sensitive: TS2322, E0308, CS0103
// A deprecated package is noise, not a warning: it says the same thing for every package.
const NOISE = /^npm warn deprecated/i;
const SIGNAL = { test: l => !NOISE.test(l) && (WORDS.test(l) || CODES.test(l)) };
// Same shape = same first 40 chars once numbers and hashes are masked (e.g. one line per fetched package).
// Signal lines never collapse, so this only folds noise.
const shape = l => l.slice(0, 200).replace(/\d+/g, '0').replace(/\b[0-9a-f]{7,}\b/gi, 'h').replace(/\s+/g, ' ').trim().slice(0, 40);

// fullPath: the file that already holds the complete output (OpenCode saves it and shows a preview).
// Then the note points at that file instead of writing a second copy.
export function squeeze(raw, { command = '', id = '', fullPath = '' } = {}) {
  if (typeof raw !== 'string' || raw.length <= LIMIT || process.env.WESH_SQUEEZE === '0' || /WESH_RAW/.test(command)) return { text: raw, changed: false };
  const segs = segments(String(command)).map(commandOf);
  if (!segs.length || segs.some(isPayload) || !segs.some(isNoisy)) return { text: raw, changed: false };
  // 1. Clean: ANSI/OSC codes; a carriage-return redraw keeps its last frame plus any frame that carries a signal.
  const lines = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').split('\n').flatMap(l => {
    const segs = l.split('\r').filter(s => s.trim());
    if (segs.length < 2) return [(segs[0] ?? '').trimEnd()];
    const last = segs.pop();
    return [...segs.filter(s => SIGNAL.test(s)), last].map(s => s.trimEnd());
  });
  // 2. Collapse runs of identical lines and of same-shape noise (progress, counters, fetched packages).
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    if (j - i > 1) { out.push(`${lines[i]}  [x${j - i}]`); i = j; continue; }
    const s = shape(lines[i]);
    while (s && j < lines.length && shape(lines[j]) === s && !SIGNAL.test(lines[j])) j++;
    if (j - i >= 4 && !SIGNAL.test(lines[i])) { out.push(lines[i], `  [... ${j - i - 2} similar lines]`, lines[j - 1]); i = j; continue; }
    out.push(lines[i]); i++;
  }
  let text = out.join('\n');
  // 3. Still long: keep head, tail, and every signal line with context and the block that follows it.
  if (text.length > LIMIT && out.length > HEAD + TAIL) {
    const keep = new Set();
    for (let i = 0; i < HEAD; i++) keep.add(i);
    for (let i = out.length - TAIL; i < out.length; i++) keep.add(i);
    const hits = out.flatMap((l, i) => (SIGNAL.test(l) ? [i] : []));
    const chosen = hits.length > MAX_KEEP ? [...hits.slice(0, MAX_KEEP - 100), ...hits.slice(-100)] : hits;
    for (const h of chosen) {
      for (let k = h - CONTEXT; k <= h + CONTEXT; k++) if (k >= 0 && k < out.length) keep.add(k);
      for (let k = h + 1; k < Math.min(out.length, h + 1 + BLOCK) && out[k].trim(); k++) keep.add(k);
    }
    const parts = [];
    let gap = 0;
    for (let i = 0; i < out.length; i++) {
      if (keep.has(i)) { if (gap) parts.push(`  [... ${gap} lines omitted]`); gap = 0; parts.push(out[i]); } else gap++;
    }
    if (hits.length > chosen.length) parts.push(`  [${hits.length - chosen.length} more error/warning lines in the full output]`);
    text = parts.join('\n');
  }
  if (text.length >= raw.length * 0.9) return { text: raw, changed: false }; // not worth the indirection
  const keep = fullPath || process.env.WESH_SQUEEZE_SAVE === '0' ? '' : save(raw, id); // the host already kept it
  const file = fullPath || keep;
  const before = raw.split('\n').length, after = text.split('\n').length;
  text += `\n[wesh squeeze: ${before} -> ${after} lines.${file ? ` Full output: ${file} (grep it)`
    : keep === '' && process.env.WESH_SQUEEZE_SAVE === '0' ? ' Full output not saved (WESH_SQUEEZE_SAVE=0).' : ' Full output could not be saved.'} Raw output: rerun with WESH_RAW=1 <cmd> (PowerShell: $env:WESH_RAW=1; <cmd>).]`;
  return { text, changed: true, before: raw.length, after: text.length };
}

// Per-user location: %TEMP% is per-user on Windows; elsewhere a private dir under the home folder, not shared /tmp.
const DIR = process.platform === 'win32' ? path.join(os.tmpdir(), 'wesh-squeeze') : path.join(os.homedir(), '.cache', 'wesh-squeeze');

function save(raw, id) {
  let file;
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const name = (id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).replace(/[^\w-]/g, '');
    file = path.join(DIR, `${name}.log`);
    fs.writeFileSync(file, raw, { mode: 0o600 });
  } catch { return ''; }
  try { // keep the newest 50; other processes may prune at the same time
    const files = fs.readdirSync(DIR).flatMap(f => { try { return [[path.join(DIR, f), fs.statSync(path.join(DIR, f)).mtimeMs]]; } catch { return []; } });
    for (const [f] of files.sort((a, b) => b[1] - a[1]).slice(50)) if (f !== file) fs.rmSync(f, { force: true });
  } catch {}
  return file;
}
