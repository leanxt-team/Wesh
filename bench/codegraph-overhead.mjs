// What the code graph costs in the prompt, measured on the real OpenCode request (stress test 7's mock).
// node bench/codegraph-overhead.mjs <opencode binary> [codegraph binary]
// Runs the end-to-end run twice, with and without codegraph, and compares the first request the model receives.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tokens, TOKENIZER, table } from './lib.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const [bin, cg] = process.argv.slice(2);
if (!bin) { console.error('usage: node bench/codegraph-overhead.mjs <opencode binary> [codegraph binary]'); process.exit(2); }

const run = args => {
  const out = execFileSync(process.execPath, [path.join(DIR, 'opencode-e2e.mjs'), bin, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const sb = out.match(/sandbox \(first request saved as first-request\.json\): (.+)/)?.[1]?.trim();
  if (!sb) throw new Error(`no sandbox in the output:\n${out}`);
  return sb;
};

// What the model receives: the system prompt (the rules, the skill list) plus the tool definitions.
// The system prompt comes from the first request; the tools from the last one, because OpenCode 2 connects
// its MCP servers after the first request, so only then is the code graph tool in the list.
const cost = sb => {
  const first = JSON.parse(fs.readFileSync(path.join(sb, 'first-request.json'), 'utf8'));
  const last = JSON.parse(fs.readFileSync(path.join(sb, 'last-request.json'), 'utf8'));
  const system = (first.messages || []).filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const tools = JSON.stringify(last.tools || []);
  return { system, tools, systemTokens: tokens(system), toolTokens: tokens(tools), total: tokens(system) + tokens(tools) };
};

const withCg = cost(run(cg ? ['--codegraph-cli', cg, '--opencode-version', '2'] : ['--codegraph-cli', process.execPath, '--opencode-version', '2']));
const without = cost(run(['--no-codegraph', '--opencode-version', '2']));

const rows = [
  ['what the model reads', 'tokens without codegraph', 'with codegraph', 'codegraph adds'],
  ['system prompt (rules, skills)', without.systemTokens, withCg.systemTokens, `+${withCg.systemTokens - without.systemTokens}`],
  ['tool definitions', without.toolTokens, withCg.toolTokens, `+${withCg.toolTokens - without.toolTokens}`],
  ['total per request', without.total, withCg.total, `+${withCg.total - without.total}`],
];
const md = `# Code graph overhead in the prompt (${TOKENIZER})\n\n${table(rows)}\n\n`
  + `Measured on the real OpenCode ${execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()} request the mock model receives (stress test 7),\n`
  + `with and without codegraph wired. The tool definitions include codegraph's own server instructions.\n`;
console.log(md);
fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'results', 'codegraph-overhead.md'), md);
