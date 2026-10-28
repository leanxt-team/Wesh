// The A/B tasks: what the developer types, an optional setup, and the hidden checks (run afterwards, never shown
// to the agent). Hidden checks import the agent's code from process.env.WORK.
import fs from 'node:fs';
import path from 'node:path';
import { DAILY_TEST } from './fixture.mjs';

export const TASKS = [
  {
    id: 'money-split',
    kind: 'bug, shared helper',
    prompt: 'Customers report that when an order is refunded in several parts, or paid in installments, the parts do not add up to the order total: cents go missing. Fix it.',
    hidden: `
import { splitCents } from 'W/src/money.js';
import { refundOrder } from 'W/src/orders/refunds.js';
import { planInstallments } from 'W/src/orders/installments.js';
test('shares always add up and differ by at most one cent', () => {
  for (const [t, n] of [[100, 3], [1001, 7], [5, 9], [0, 4], [99999, 12], [1, 1]]) {
    const s = splitCents(t, n);
    assert.equal(s.length, n); assert.equal(s.reduce((a, b) => a + b, 0), t);
    assert.ok(Math.max(...s) - Math.min(...s) <= 1);
  }
});
test('refunds add up', () => assert.equal(refundOrder({ id: 1, status: 'paid', total: 1000 }, 3).reduce((a, r) => a + r.cents, 0), 1000));
test('installments add up', () => assert.equal(planInstallments(1000, 3).reduce((a, r) => a + r.cents, 0), 1000));
test('bad input still rejected', () => assert.throws(() => splitCents(10, 0)));
`,
  },
  {
    id: 'member-coupon',
    kind: 'bug, cross-file',
    prompt: 'Members who also use a coupon get a bigger discount than they should. The member discount is 5% and is applied once, then at most one coupon. Find and fix the bug.',
    hidden: `
import { priceOrder } from 'W/src/pricing/pricing.js';
test('member + percent coupon', () => assert.equal(priceOrder(10000, { member: true }, { type: 'percent', value: 10 }), 8550));
test('member + fixed coupon', () => assert.equal(priceOrder(10000, { member: true }, { type: 'fixed', value: 500 }), 9000));
test('member only', () => assert.equal(priceOrder(10000, { member: true }, null), 9500));
test('coupon only', () => assert.equal(priceOrder(10000, { member: false }, { type: 'percent', value: 10 }), 9000));
test('fixed coupon never negative', () => assert.equal(priceOrder(300, { member: false }, { type: 'fixed', value: 500 }), 0));
`,
  },
  {
    id: 'csv-export',
    kind: 'feature',
    prompt: 'Add ordersToCsv(orders) to src/reports/export.js. It returns a CSV string with the header id,customer,total,date and one line per order; total is in euros with 2 decimals (orders store integer cents in total, customerId is the customer). It must open correctly in Excel: fields containing a comma, a double quote or a line break must be quoted, with inner quotes doubled.',
    hidden: `
import { ordersToCsv } from 'W/src/reports/export.js';
const rows = s => s.replace(/\\r\\n/g, '\\n').replace(/\\n$/, '').split('\\n');
test('header and simple rows', () => {
  const r = rows(ordersToCsv([{ id: 1, customerId: 7, total: 1234, date: '2026-01-02' }, { id: 2, customerId: 8, total: 5, date: '2026-01-03' }]));
  assert.equal(r[0], 'id,customer,total,date'); assert.equal(r[1], '1,7,12.34,2026-01-02'); assert.equal(r[2], '2,8,0.05,2026-01-03');
});
test('comma and quote are quoted, quotes doubled', () => {
  const out = ordersToCsv([{ id: 3, customerId: 'Doe, "J"', total: 100, date: 'x' }]);
  assert.ok(out.includes('"Doe, ""J"""'));
});
test('line breaks are quoted', () => assert.ok(ordersToCsv([{ id: 4, customerId: 'a\\nb', total: 100, date: 'x' }]).includes('"a\\nb"')));
test('empty list gives the header only', () => assert.deepEqual(rows(ordersToCsv([])), ['id,customer,total,date']));
`,
  },
  {
    id: 'user-validation',
    kind: 'feature, reuse',
    prompt: 'createUser should reject bad input: the email must look like an email address and age must be an integer between 13 and 120. Use the error type this project already has for invalid input, with a clear message.',
    hidden: `
import { createUser } from 'W/src/users/users.js';
import { ValidationError } from 'W/src/users/errors.js';
const bad = (input, field) => assert.throws(() => createUser(input), e => e instanceof ValidationError && (e.field === field || new RegExp(field, 'i').test(e.message)));
test('bad email', () => { bad({ email: 'nope', age: 30 }, 'email'); bad({ email: '', age: 30 }, 'email'); bad({ age: 30 }, 'email'); });
test('bad age', () => { bad({ email: 'a@b.co', age: 12 }, 'age'); bad({ email: 'a@b.co', age: 121 }, 'age'); bad({ email: 'a@b.co', age: 20.5 }, 'age'); bad({ email: 'a@b.co', age: '30' }, 'age'); });
test('good users still created', () => { assert.equal(createUser({ email: 'x@y.fr', age: 13 }).age, 13); assert.equal(createUser({ email: 'x@y.fr', age: 120 }).age, 120); });
`,
  },
  {
    id: 'rename',
    kind: 'refactor across callers',
    prompt: 'Rename calcTotal to computeOrderTotal everywhere: it is exported and used in several places. Behaviour must not change.',
    hidden: `
import { computeOrderTotal } from 'W/src/orders/order.js';
import { invoiceText } from 'W/src/orders/invoice.js';
import fs from 'node:fs'; import path from 'node:path';
test('new name works', () => assert.equal(computeOrderTotal({ items: [{ unitCents: 1000, qty: 1 }] }, { member: true }), 950));
test('callers still work', () => assert.match(invoiceText({ id: 1, items: [{ sku: 'a', unitCents: 500, qty: 2 }] }, {}), /Total: €10.00/));
test('old name gone from code and tests', () => {
  const hits = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', '.codegraph', '.claude'].includes(e.name)) walk(p); }
    else if (/\\.m?js$/.test(e.name) && /\\bcalcTotal\\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(p); } };
  walk(process.env.WORK); assert.deepEqual(hits, []);
});
`,
  },
  {
    id: 'sales-perf',
    kind: 'performance',
    prompt: 'salesByCustomer in src/reports/sales.js is far too slow on real data (100k orders, 20k customers). Make it fast without changing its output.',
    hidden: `
import { salesByCustomer } from 'W/src/reports/sales.js';
function reference(orders, users) {
  const rows = [];
  for (const user of users) { let total = 0, count = 0;
    for (const o of orders) if (o.customerId === user.id && o.status !== 'cancelled') { total += o.total; count++; }
    if (count) rows.push({ customerId: user.id, email: user.email, orders: count, total }); }
  return rows.sort((a, b) => b.total - a.total);
}
let seed = 7; const rnd = n => (seed = (seed * 48271) % 2147483647) % n;
const users = Array.from({ length: 20000 }, (_, i) => ({ id: i + 1, email: 'u' + i + '@x' }));
const orders = Array.from({ length: 100000 }, () => ({ customerId: rnd(25000) + 1, total: rnd(5) * 1000, status: rnd(10) ? 'paid' : 'cancelled' }));
test('same output as before, ties included', () => {
  const small = orders.slice(0, 3000), su = users.slice(0, 600);
  assert.deepEqual(salesByCustomer(small, su), reference(small, su));
});
test('fast on 100k orders', () => { const t = performance.now(); salesByCustomer(orders, users); assert.ok(performance.now() - t < 1500, 'under 1.5 s'); });
`,
  },
  {
    id: 'path-traversal',
    kind: 'security',
    prompt: 'A security review found that resolveDownload in src/files/download.js can let a customer read files outside the downloads folder. Fix it.',
    hidden: `
import path from 'node:path';
import { resolveDownload } from 'W/src/files/download.js';
const base = path.resolve(process.env.WORK, 'dl');
const blocked = name => { let out; try { out = resolveDownload(base, name); } catch { return true; } return out === null || out === undefined || out === false; };
test('normal and nested files allowed', () => {
  assert.equal(resolveDownload(base, 'invoice-1.pdf'), path.join(base, 'invoice-1.pdf'));
  assert.equal(resolveDownload(base, 'a/b.pdf'), path.join(base, 'a', 'b.pdf'));
});
test('escapes blocked', () => {
  for (const n of ['../secret.txt', '../../etc/passwd', 'a/../../x', path.join('..', 'x'), path.resolve('/etc/passwd'), '../dl-evil/x', '..']) assert.ok(blocked(n), n);
});
`,
  },
  {
    id: 'daily-utc',
    kind: 'failing test',
    prompt: 'The test suite fails (npm test). Make it pass. Do not change the tests.',
    setup: dir => fs.writeFileSync(path.join(dir, 'test', 'daily.test.js'), DAILY_TEST),
    hidden: `
import fs from 'node:fs'; import path from 'node:path';
import { dailyTotals } from 'W/src/reports/daily.js';
test('UTC days, any time zone', () => {
  assert.deepEqual(dailyTotals([{ date: '2026-12-31T23:59:59.000Z', total: 1 }, { date: '2027-01-01T00:00:00.000Z', total: 2 }]),
    [{ day: '2026-12-31', total: 1 }, { day: '2027-01-01', total: 2 }]);
});
test('the test file was not edited', () => assert.equal(fs.readFileSync(path.join(process.env.WORK, 'test', 'daily.test.js'), 'utf8'), process.env.DAILY_TEST));
`,
  },
];
