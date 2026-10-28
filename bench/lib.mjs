import fs from 'node:fs';
import path from 'node:path';

// o200k (same tokenizer caveman publishes with) when js-tiktoken is installed (`npm i` in bench/),
// else chars/3.8. Claude's own tokenizer runs ~1.0-1.35x o200k; ratios between arms are what matter.
let enc = null;
try { const { getEncoding } = await import('js-tiktoken'); enc = getEncoding('o200k_base'); } catch {}
export const TOKENIZER = enc ? 'o200k (js-tiktoken)' : 'approx chars/3.8 (run `npm i` in bench/ for o200k)';
export const tokens = s => enc ? enc.encode(s).length : Math.round(s.length / 3.8);

export function parseSkill(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { file, front: {}, body: text, text, ok: false };
  const front = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) { key = kv[1]; front[key] = kv[2].replace(/^>-?\s*$/, '').replace(/^["']|["']$/g, ''); }
    else if (key && /^\s+/.test(line)) front[key] = (front[key] + ' ' + line.trim()).trim();
  }
  return { file, front, body: m[2], text, ok: true };
}

export function findSkills(root) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || ['node_modules', '.git', 'generated', 'tests'].includes(e.name)) continue;
      const f = path.join(d, e.name, 'SKILL.md');
      if (fs.existsSync(f)) out.push(parseSkill(f));
      walk(path.join(d, e.name));
    }
  };
  walk(root);
  return out;
}

// What a host lists every turn for a model-invocable skill.
export const listingLine = s => `- ${s.front.name}: ${s.front.description}`;
export const modelInvocable = s => String(s.front['disable-model-invocation']) !== 'true';

// A copy of wesh whose skill and agent descriptions carry a random tag. On Windows, Claude Code and OpenCode find the
// home folder through the OS, not HOME/USERPROFILE, so an end-to-end sandbox also sees the real ~/.claude/skills: only
// tagged entries prove that what the model is offered came from the install under test.
export function stageSource(dir, root) {
  const tag = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  for (const d of ['core', 'skills', 'agents', 'hooks']) fs.cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(root, 'install.mjs'), path.join(dir, 'install.mjs'));
  const files = [path.join(dir, 'agents', 'wesh-scout.md'), ...fs.readdirSync(path.join(dir, 'skills')).map(n => path.join(dir, 'skills', n, 'SKILL.md'))];
  for (const f of files.filter(f => fs.existsSync(f)))
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/^description: (.*)$/m, `description: $1 [${tag}]`));
  return { install: path.join(dir, 'install.mjs'), tag };
}

export function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  return rows.map((r, k) => {
    const line = '| ' + r.map((c, i) => String(c)[i ? 'padStart' : 'padEnd'](w[i])).join(' | ') + ' |';
    return k === 0 ? line + '\n|' + w.map((x, i) => (i ? '-'.repeat(x + 1) + ':' : '-'.repeat(x + 2))).join('|') + '|' : line;
  }).join('\n');
}
