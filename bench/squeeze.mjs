// Stress test 5: tool-output squeeze. Token reduction per fixture, and every needed line kept.
// node bench/squeeze.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens, TOKENIZER, table } from './lib.mjs';
import { squeeze } from '../hooks/squeeze.mjs';
import FIXTURES from './squeeze-fixtures.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const rows = [['output', 'tokens before', 'after', 'saved', 'needed lines kept']];
let tb = 0, ta = 0, lost = 0;
for (const f of FIXTURES) {
  const r = squeeze(f.text, { command: f.command, id: 'bench' });
  const before = tokens(f.text), after = tokens(r.text);
  const kept = f.must.filter(m => r.text.includes(m)).length;
  lost += f.must.length - kept;
  if (!f.untouched) { tb += before; ta += after; }
  rows.push([f.name, before, after, `${Math.round((1 - after / before) * 100)}%`, `${kept}/${f.must.length}`]);
}
rows.push(['total (squeezable)', tb, ta, `${Math.round((1 - ta / tb) * 100)}%`, lost ? `${lost} LOST` : 'all']);
const md = `# Tool-output squeeze (${TOKENIZER})\n\n${table(rows)}\n`;
console.log(md);
fs.mkdirSync(path.join(DIR, 'results'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'results', 'squeeze.md'), md);
process.exit(lost ? 1 : 0);
