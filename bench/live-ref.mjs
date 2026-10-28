// Reference solutions: `node live.mjs --selftest` proves every hidden check passes on correct code.
export default {
  'csv-sum': `export function csvSum(text, column) {
  const rows = [];
  for (const line of text.split(/\\r?\\n/)) {
    if (!line.trim()) continue;
    const f = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { f.push(cur); cur = ''; } else cur += c;
    }
    rows.push([...f, cur]);
  }
  const i = rows[0].indexOf(column);
  return rows.slice(1).reduce((s, r) => s + Number(r[i]), 0);
}`,
  'safe-join': `import path from 'node:path';
export function safeJoin(base, p) {
  const b = path.resolve(base), r = path.resolve(b, p);
  if (path.isAbsolute(p) || (r !== b && !r.startsWith(b + path.sep))) throw new Error('escape');
  return r;
}`,
  'split-bill': `export function splitBill(t, n) {
  if (!Number.isInteger(t) || !Number.isInteger(n) || n < 1) throw new Error('bad input');
  const q = Math.floor(t / n), r = t - q * n;
  return Array.from({ length: n }, (_, i) => q + (i < r ? 1 : 0));
}`,
  'rate-limit': `export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return { allow(key) {
    const t = now(), h = (hits.get(key) || []).filter(x => x > t - windowMs);
    for (const [k, v] of hits) if (!v.length || v[v.length - 1] <= t - windowMs) hits.delete(k);
    if (h.length >= limit) { hits.set(key, h); return false; }
    h.push(t); hits.set(key, h); return true;
  } };
}`,
  'parse-duration': `const U = { d: 864e5, h: 36e5, m: 6e4, s: 1e3, ms: 1 };
export function parseDuration(s) {
  const t = s.replace(/\\s+/g, '');
  if (!/^(\\d+(ms|d|h|m|s))+$/.test(t)) throw new Error('bad duration');
  return [...t.matchAll(/(\\d+)(ms|d|h|m|s)/g)].reduce((a, [, n, u]) => a + n * U[u], 0);
}`,
  'group-by': `export const groupBy = (items, f) => items.reduce((m, x) => {
  const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); return m; }, new Map());`,
};
