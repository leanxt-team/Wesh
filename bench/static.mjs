// Stress test 1: fixed token overhead per turn and per skill load.
// node bench/static.mjs --originals <dir with caveman-main, skills-main, ponytail-main>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens, TOKENIZER, findSkills, parseSkill, listingLine, modelInvocable, table } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--originals');
const ORIG = arg > 0 ? path.resolve(process.argv[arg + 1]) : null;

function arm(name, alwaysOn, skills, agents = []) {
  const listed = skills.filter(modelInvocable);
  const listing = listed.map(listingLine).join('\n') + agents.map(a => `\n- ${a}`).join('');
  const bodies = listed.map(s => tokens(s.body));
  return {
    name, skills: skills.length, listed: listed.length,
    alwaysOn: tokens(alwaysOn), listing: tokens(listing),
    perTurn: tokens(alwaysOn) + tokens(listing),
    avgLoad: Math.round(bodies.reduce((a, b) => a + b, 0) / Math.max(1, bodies.length)),
    maxLoad: Math.max(0, ...bodies),
  };
}

const weshSkills = findSkills(path.join(ROOT, 'skills'));
const scout = parseSkill(path.join(ROOT, 'agents', 'wesh-scout.md'));
const wesh = arm('wesh', fs.readFileSync(path.join(ROOT, 'core', 'CORE.md'), 'utf8'), weshSkills,
  [`wesh-scout: ${scout.front.description}`]);
const arms = [wesh];

if (ORIG) {
  const cm = path.join(ORIG, 'caveman', 'caveman-main');
  const mp = path.join(ORIG, 'mattpocock', 'skills-main');
  const pt = path.join(ORIG, 'ponytail', 'ponytail-main');
  const caveSkills = findSkills(path.join(cm, 'skills'));
  const caveCore = parseSkill(path.join(cm, 'skills', 'caveman', 'SKILL.md')).body;
  const mpManifest = JSON.parse(fs.readFileSync(path.join(mp, '.claude-plugin', 'plugin.json'), 'utf8'));
  const mpSkills = mpManifest.skills.map(s => parseSkill(path.join(mp, s, 'SKILL.md')));
  const ptSkills = findSkills(path.join(pt, 'skills'));
  const ptCore = fs.readFileSync(path.join(pt, 'AGENTS.md'), 'utf8');
  const caveAgents = ['cavecrew-investigator', 'cavecrew-builder', 'cavecrew-reviewer']
    .map(a => parseSkill(path.join(cm, 'agents', a + '.md'))).map(a => `${a.front.name}: ${a.front.description}`);
  arms.push(arm('caveman (plugin)', caveCore, caveSkills, caveAgents));
  arms.push(arm('ponytail (plugin)', ptCore, ptSkills));
  arms.push(arm('mattpocock (plugin)', '', mpSkills));
  arms.push(arm('all 3 installed', caveCore + ptCore, [...caveSkills, ...ptSkills, ...mpSkills], caveAgents));
}

const rows = [['setup', 'skills', 'listed', 'always-on', 'listing', 'per-turn fixed', 'avg skill load', 'max skill load']];
for (const a of arms) rows.push([a.name, a.skills, a.listed, a.alwaysOn, a.listing, a.perTurn, a.avgLoad, a.maxLoad]);
let md = `# Static overhead (tokens, ${TOKENIZER})\n\n${table(rows)}\n`;
const all = arms.find(a => a.name === 'all 3 installed');
if (all) {
  const pct = (a, b) => `${Math.round((1 - a / b) * 100)}%`;
  md += `\nwesh vs all 3 installed: per-turn fixed -${pct(wesh.perTurn, all.perTurn)}, ` +
    `listed skills ${wesh.listed} vs ${all.listed}, avg skill load -${pct(wesh.avgLoad, all.avgLoad)}.\n`;
}
console.log(md);
fs.mkdirSync(path.join(ROOT, 'bench', 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench', 'results', 'static.json'), JSON.stringify({ tokenizer: TOKENIZER, arms }, null, 2));
fs.writeFileSync(path.join(ROOT, 'bench', 'results', 'static.md'), md);
