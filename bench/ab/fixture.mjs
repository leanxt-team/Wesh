// The A/B fixture: a small but realistic Node shop (about 60 files, a long node:test suite) with planted defects that
// the tasks in tasks.mjs ask an agent to fix or extend. Every run gets a fresh copy, committed to git, so the agent's
// diff can be measured afterwards.
import fs from 'node:fs';
import path from 'node:path';

const files = {};
const add = (p, text) => { files[p] = text.replace(/^\n/, ''); };

add('package.json', `{
  "name": "shop",
  "version": "1.4.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test --test-reporter=spec" }
}
`);
add('README.md', `# shop

Order, pricing, refunds and reporting core of the shop backend. Money is always integer cents.

- \`src/money.js\`: cents helpers
- \`src/orders/\`: orders, refunds, installments
- \`src/pricing/\`: discounts and coupons
- \`src/users/\`: accounts
- \`src/reports/\`: sales and daily reports, exports
- \`src/files/\`: customer downloads

Run the tests with \`npm test\`.
`);

// --- money (task money-split: splitCents drops the remainder) ---
add('src/money.js', `
// All amounts are integer cents.
export const toCents = euros => Math.round(Number(euros) * 100);
export const fromCents = cents => (cents / 100).toFixed(2);
export const formatMoney = cents => \`€\${fromCents(cents)}\`;

// Split a total into n shares of whole cents.
export function splitCents(total, n) {
  if (!Number.isInteger(total) || !Number.isInteger(n) || n <= 0) throw new RangeError('splitCents: integer total and n > 0');
  const share = Math.floor(total / n);
  return Array.from({ length: n }, () => share);
}

export const sumCents = list => list.reduce((a, b) => a + b, 0);
`);

// --- orders (task rename: calcTotal -> computeOrderTotal) ---
add('src/orders/order.js', `
import { sumCents } from '../money.js';
import { priceOrder } from '../pricing/pricing.js';

let nextId = 1000;

export function createOrder(items, user, coupon = null) {
  if (!items?.length) throw new Error('an order needs items');
  const order = { id: nextId++, customerId: user.id, items, coupon, date: new Date().toISOString(), status: 'open' };
  order.total = calcTotal(order, user);
  return order;
}

// Total in cents after discounts.
export function calcTotal(order, user) {
  const gross = sumCents(order.items.map(i => i.unitCents * i.qty));
  return priceOrder(gross, user, order.coupon);
}
`);
add('src/orders/refunds.js', `
import { splitCents } from '../money.js';

// Refund an order in \`parts\` equal transfers.
export function refundOrder(order, parts = 1) {
  if (order.status !== 'paid') throw new Error('only paid orders can be refunded');
  return splitCents(order.total, parts).map((cents, i) => ({ orderId: order.id, seq: i + 1, cents }));
}
`);
add('src/orders/installments.js', `
import { splitCents } from '../money.js';

// Monthly installments for an order total.
export function planInstallments(total, months) {
  return splitCents(total, months).map((cents, i) => ({ month: i + 1, cents }));
}
`);
add('src/orders/status.js', `
const FLOW = { open: ['paid', 'cancelled'], paid: ['shipped', 'refunded'], shipped: ['delivered'], delivered: [], cancelled: [], refunded: [] };
export function transition(order, to) {
  if (!FLOW[order.status]?.includes(to)) throw new Error(\`cannot go from \${order.status} to \${to}\`);
  return { ...order, status: to };
}
`);
add('src/orders/invoice.js', `
import { calcTotal } from './order.js';
import { formatMoney } from '../money.js';

export function invoiceText(order, user) {
  const lines = order.items.map(i => \`\${i.sku} x\${i.qty}  \${formatMoney(i.unitCents * i.qty)}\`);
  return [\`Invoice #\${order.id}\`, ...lines, \`Total: \${formatMoney(calcTotal(order, user))}\`].join('\\n');
}
`);

// --- pricing (task member-coupon: the member discount is applied twice when a coupon is used) ---
add('src/pricing/discounts.js', `
export const MEMBER_RATE = 0.05;

export function applyMemberDiscount(cents, user) {
  return user?.member ? Math.round(cents * (1 - MEMBER_RATE)) : cents;
}

// Coupons: { type: 'percent', value: 10 } or { type: 'fixed', value: 500 } (cents).
export function applyCoupon(cents, coupon, user) {
  if (!coupon) return cents;
  const base = applyMemberDiscount(cents, user);
  if (coupon.type === 'percent') return Math.round(base * (1 - coupon.value / 100));
  if (coupon.type === 'fixed') return Math.max(0, base - coupon.value);
  throw new Error(\`unknown coupon type \${coupon.type}\`);
}
`);
add('src/pricing/pricing.js', `
import { applyMemberDiscount, applyCoupon } from './discounts.js';

// Member discount first, then at most one coupon.
export function priceOrder(grossCents, user, coupon) {
  const afterMember = applyMemberDiscount(grossCents, user);
  return applyCoupon(afterMember, coupon, user);
}
`);
add('src/pricing/tax.js', `
export const VAT = { FR: 0.2, DE: 0.19, ES: 0.21, IT: 0.22 };
export const vatOf = (cents, country) => Math.round(cents * (VAT[country] ?? 0.2));
`);

// --- users (task validation: createUser accepts anything; ValidationError exists and is unused here) ---
add('src/users/errors.js', `
export class ValidationError extends Error {
  constructor(field, message) { super(message); this.name = 'ValidationError'; this.field = field; }
}
export class NotFoundError extends Error {
  constructor(what) { super(\`\${what} not found\`); this.name = 'NotFoundError'; }
}
`);
add('src/users/users.js', `
import { NotFoundError } from './errors.js';

const users = new Map();
let nextId = 1;

export function createUser({ email, age, member = false }) {
  const user = { id: nextId++, email, age, member };
  users.set(user.id, user);
  return user;
}
export function getUser(id) {
  const u = users.get(id);
  if (!u) throw new NotFoundError(\`user \${id}\`);
  return u;
}
export const allUsers = () => [...users.values()];
`);
add('src/users/address.js', `
import { ValidationError } from './errors.js';
export function normalizePostcode(country, code) {
  const c = String(code).replace(/\\s+/g, '').toUpperCase();
  if (country === 'FR' && !/^\\d{5}$/.test(c)) throw new ValidationError('postcode', 'French postcodes have 5 digits');
  return c;
}
`);

// --- reports (task perf: O(n^2) lookup; task daily: local-date bug; task csv: new export) ---
add('src/reports/sales.js', `
// Revenue per customer, sorted by revenue, highest first. Ties keep customer order.
export function salesByCustomer(orders, users) {
  const rows = [];
  for (const user of users) {
    let total = 0, count = 0;
    for (const o of orders) {
      if (o.customerId === user.id && o.status !== 'cancelled') { total += o.total; count++; }
    }
    if (count) rows.push({ customerId: user.id, email: users.find(u => u.id === user.id).email, orders: count, total });
  }
  return rows.sort((a, b) => b.total - a.total);
}
`);
add('src/reports/daily.js', `
// Totals per calendar day (UTC), as [{ day: 'YYYY-MM-DD', total }], oldest first.
export function dailyTotals(orders) {
  const byDay = new Map();
  for (const o of orders) {
    const d = new Date(o.date);
    const day = \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`;
    byDay.set(day, (byDay.get(day) || 0) + o.total);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, total]) => ({ day, total }));
}
`);
add('src/reports/export.js', `
// Export helpers for the back office.
export function ordersToJson(orders) {
  return JSON.stringify(orders.map(o => ({ id: o.id, customer: o.customerId, total: o.total, date: o.date })));
}
`);

// --- files (task traversal: resolveDownload trusts the name) ---
add('src/files/download.js', `
import path from 'node:path';

// Absolute path of a customer download inside baseDir.
export function resolveDownload(baseDir, name) {
  return path.join(baseDir, name);
}
`);

// --- filler: catalog, inventory, shipping, notifications (realistic, not touched by any task) ---
const categories = ['books', 'music', 'garden', 'kitchen', 'toys', 'sports', 'office', 'pets', 'beauty', 'tools', 'games', 'baby'];
for (const c of categories) {
  add(`src/catalog/${c}.js`, `
// Catalog rules for ${c}.
export const CATEGORY = '${c}';
export function ${c}Price(baseCents, { promo = 0 } = {}) {
  return Math.max(0, Math.round(baseCents * (1 - promo)));
}
export function ${c}Searchable(product) {
  return [product.name, product.brand, ...(product.tags || [])].filter(Boolean).join(' ').toLowerCase();
}
`);
}
add('src/catalog/index.js', `${categories.map(c => `export * as ${c} from './${c}.js';`).join('\n')}\n`);
for (const w of ['paris', 'lyon', 'lille', 'nantes']) {
  add(`src/inventory/${w}.js`, `
const stock = new Map();
export const WAREHOUSE = '${w}';
export const restock = (sku, qty) => stock.set(sku, (stock.get(sku) || 0) + qty);
export function reserve(sku, qty) {
  const have = stock.get(sku) || 0;
  if (have < qty) return false;
  stock.set(sku, have - qty);
  return true;
}
export const available = sku => stock.get(sku) || 0;
`);
}
add('src/shipping/rates.js', `
export const ZONES = { FR: 1, BE: 2, DE: 2, ES: 2, IT: 2, US: 4 };
export function shippingCents(country, weightGrams) {
  const zone = ZONES[country] ?? 5;
  return 490 + zone * 150 + Math.ceil(weightGrams / 500) * 120;
}
`);
add('src/shipping/tracking.js', `
export const trackingUrl = (carrier, code) => carrier === 'colissimo' ? \`https://track.example/c/\${code}\` : \`https://track.example/o/\${code}\`;
`);
add('src/notifications/email.js', `
export function orderConfirmation(order, user) {
  return { to: user.email, subject: \`Order #\${order.id} confirmed\`, body: \`Thanks! Total \${(order.total / 100).toFixed(2)} EUR\` };
}
`);
add('src/notifications/sms.js', `
export const shortMessage = (order) => \`Order \${order.id}: \${order.status}\`;
`);

// --- visible tests: a long suite, passing at baseline ---
add('test/money.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, fromCents, formatMoney, sumCents } from '../src/money.js';
${Array.from({ length: 40 }, (_, i) => `test('toCents/fromCents round trip ${i}', () => assert.equal(fromCents(toCents('${i}.${String(i * 7 % 100).padStart(2, '0')}')), '${i}.${String(i * 7 % 100).padStart(2, '0')}'));`).join('\n')}
test('formatMoney', () => assert.equal(formatMoney(1234), '€12.34'));
test('sumCents', () => assert.equal(sumCents([1, 2, 3]), 6));
`);
add('test/orders.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, calcTotal } from '../src/orders/order.js';
import { transition } from '../src/orders/status.js';
import { invoiceText } from '../src/orders/invoice.js';
const user = { id: 1, member: false }, member = { id: 2, member: true };
${Array.from({ length: 30 }, (_, i) => `test('order total ${i}', () => assert.equal(calcTotal({ items: [{ sku: 'a', unitCents: ${100 + i * 37}, qty: ${1 + (i % 4)} }] }, user), ${(100 + i * 37) * (1 + (i % 4))}));`).join('\n')}
test('member order total', () => assert.equal(calcTotal({ items: [{ sku: 'a', unitCents: 1000, qty: 1 }] }, member), 950));
test('createOrder sets total', () => assert.equal(createOrder([{ sku: 'a', unitCents: 500, qty: 2 }], user).total, 1000));
test('status flow', () => assert.equal(transition({ status: 'open' }, 'paid').status, 'paid'));
test('invoice', () => assert.match(invoiceText({ id: 7, items: [{ sku: 'a', unitCents: 500, qty: 2 }] }, user), /Total: €10.00/));
`);
add('test/pricing.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceOrder } from '../src/pricing/pricing.js';
import { vatOf } from '../src/pricing/tax.js';
${Array.from({ length: 25 }, (_, i) => `test('no discount ${i}', () => assert.equal(priceOrder(${1000 + i * 113}, { member: false }, null), ${1000 + i * 113}));`).join('\n')}
test('member only', () => assert.equal(priceOrder(10000, { member: true }, null), 9500));
test('coupon only', () => assert.equal(priceOrder(10000, { member: false }, { type: 'percent', value: 10 }), 9000));
test('vat FR', () => assert.equal(vatOf(1000, 'FR'), 200));
`);
add('test/catalog.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../src/catalog/index.js';
${categories.map(c => `test('${c} price with promo', () => assert.equal(catalog.${c}.${c}Price(1000, { promo: 0.1 }), 900));
test('${c} searchable', () => assert.equal(catalog.${c}.${c}Searchable({ name: 'A', brand: 'B', tags: ['C'] }), 'a b c'));`).join('\n')}
`);
add('test/inventory.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
${['paris', 'lyon', 'lille', 'nantes'].map(w => `import * as ${w} from '../src/inventory/${w}.js';
test('${w} reserve', () => { ${w}.restock('x', 3); assert.equal(${w}.reserve('x', 2), true); assert.equal(${w}.reserve('x', 2), false); });`).join('\n')}
`);
add('test/shipping.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shippingCents } from '../src/shipping/rates.js';
${Array.from({ length: 30 }, (_, i) => `test('shipping ${i}', () => assert.equal(shippingCents('FR', ${i * 250}), ${490 + 150 + Math.ceil((i * 250) / 500) * 120}));`).join('\n')}
`);
add('test/reports.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesByCustomer } from '../src/reports/sales.js';
import { ordersToJson } from '../src/reports/export.js';
test('sales by customer', () => {
  const users = [{ id: 1, email: 'a@x' }, { id: 2, email: 'b@x' }];
  const orders = [{ customerId: 1, total: 100, status: 'paid' }, { customerId: 2, total: 300, status: 'paid' }, { customerId: 1, total: 50, status: 'cancelled' }];
  assert.deepEqual(salesByCustomer(orders, users), [{ customerId: 2, email: 'b@x', orders: 1, total: 300 }, { customerId: 1, email: 'a@x', orders: 1, total: 100 }]);
});
test('json export', () => assert.equal(JSON.parse(ordersToJson([{ id: 1, customerId: 2, total: 3, date: 'd' }]))[0].customer, 2));
`);
add('test/users.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUser, getUser } from '../src/users/users.js';
import { normalizePostcode } from '../src/users/address.js';
test('create and get', () => { const u = createUser({ email: 'a@b.co', age: 30 }); assert.equal(getUser(u.id).email, 'a@b.co'); });
test('postcode', () => assert.equal(normalizePostcode('FR', '75 001'), '75001'));
`);
add('test/files.test.js', `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDownload } from '../src/files/download.js';
test('download path', () => assert.equal(resolveDownload(path.resolve('/srv/dl'), 'invoice-1.pdf'), path.join(path.resolve('/srv/dl'), 'invoice-1.pdf')));
`);

// Task daily-utc adds this failing test: dailyTotals uses local time, the contract is UTC.
export const DAILY_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTotals } from '../src/reports/daily.js';
test('orders are grouped by UTC day', () => {
  const orders = [
    { date: '2026-03-01T23:30:00.000Z', total: 100 },
    { date: '2026-03-02T00:30:00.000Z', total: 200 },
    { date: '2026-03-02T22:59:00.000Z', total: 300 },
  ];
  assert.deepEqual(dailyTotals(orders), [{ day: '2026-03-01', total: 100 }, { day: '2026-03-02', total: 500 }]);
});
`;

export function writeFixture(dir) {
  for (const [p, text] of Object.entries(files)) {
    const f = path.join(dir, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return Object.keys(files).length;
}
