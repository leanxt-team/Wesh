// Realistic shell outputs. `must`: lines the agent needs; squeezing must keep every one of them verbatim.
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

export default [
  {
    name: 'npm install', command: 'npm install',
    text: range(320, i => `npm http fetch GET 200 https://registry.npmjs.org/pkg-${i} ${20 + (i % 70)}ms (cache hit)`) +
      '\nnpm WARN deprecated inflight@1.0.6: This module is not supported, and leaks memory.' +
      '\nnpm WARN deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported' +
      '\n\nadded 812 packages, and audited 813 packages in 14s\n\n3 high severity vulnerabilities\n',
    must: ['npm WARN deprecated inflight@1.0.6', 'npm WARN deprecated glob@7.2.3', 'added 812 packages', '3 high severity vulnerabilities'],
  },
  {
    name: 'vitest, 1 failure in 401 files', command: 'npx vitest run',
    text: '\x1b[1m RUN \x1b[22m v3.2.4 /repo\n\n' + range(200, i => ` \x1b[32m✓\x1b[39m src/mod${i}.test.ts (${1 + (i % 9)} tests) ${3 + (i % 40)}ms`) +
      '\n \x1b[31m❯\x1b[39m src/billing/split.test.ts (4 tests | 1 failed) 12ms\n   × splitBill > keeps the total exact 5ms\n     → expected [ 34, 33, 32 ] to deeply equal [ 34, 33, 33 ]\n' +
      range(200, i => ` \x1b[32m✓\x1b[39m src/feature${i}.test.ts (${1 + (i % 7)} tests) ${2 + (i % 30)}ms`) +
      '\n\n⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  src/billing/split.test.ts > splitBill > keeps the total exact\nAssertionError: expected [ 34, 33, 32 ] to deeply equal [ 34, 33, 33 ]\n' +
      ' ❯ src/billing/split.test.ts:14:30\n     12|   it("keeps the total exact", () => {\n     13|     const r = splitBill(100, 3);\n     14|     expect(r).toEqual([34, 33, 33]);\n' +
      '\n Test Files  1 failed | 400 passed (401)\n      Tests  1 failed | 2003 passed (2004)\n   Duration  9.81s\n',
    must: ['AssertionError: expected [ 34, 33, 32 ] to deeply equal [ 34, 33, 33 ]', 'src/billing/split.test.ts:14:30', 'Tests  1 failed | 2003 passed (2004)', '× splitBill > keeps the total exact'],
  },
  {
    name: 'pytest -v, 1 failure', command: 'pytest -v',
    text: '============ test session starts ============\nplatform linux -- Python 3.12.4, pytest-8.3.2\ncollected 301 items\n\n' +
      range(150, i => `tests/test_api.py::test_case_${i} PASSED${' '.repeat(20)}[${String(Math.floor(i / 3)).padStart(3)}%]`) +
      '\ntests/test_money.py::test_round_half_even FAILED                    [ 50%]\n' +
      range(150, i => `tests/test_db.py::test_case_${i} PASSED${' '.repeat(20)}[${String(50 + Math.floor(i / 3)).padStart(3)}%]`) +
      '\n\n================= FAILURES =================\n___________ test_round_half_even ___________\n\n    def test_round_half_even():\n>       assert round_money(Decimal("2.675")) == Decimal("2.68")\n' +
      'E       AssertionError: assert Decimal(\'2.67\') == Decimal(\'2.68\')\n\ntests/test_money.py:9: AssertionError\n' +
      '========= short test summary info =========\nFAILED tests/test_money.py::test_round_half_even - AssertionError\n======= 1 failed, 300 passed in 4.21s =======\n',
    must: ["E       AssertionError: assert Decimal('2.67') == Decimal('2.68')", 'tests/test_money.py:9: AssertionError', '1 failed, 300 passed in 4.21s', 'assert round_money(Decimal("2.675")) == Decimal("2.68")'],
  },
  {
    name: 'tsc, 40 type errors (all signal)', command: 'npx tsc --noEmit',
    text: range(40, i => `src/module${i}.ts(${10 + i},5): error TS2322: Type 'string | undefined' is not assignable to type 'string'.`) + '\n\nFound 40 errors in 40 files.\n',
    must: ['src/module0.ts(10,5): error TS2322', 'src/module39.ts(49,5): error TS2322', 'Found 40 errors in 40 files.'],
  },
  {
    name: 'cargo build, 1 error', command: 'cargo build',
    text: range(260, i => `   Compiling crate-${i} v0.${i % 9}.${i % 4}`) +
      '\nwarning: unused variable: `tmp`\n --> src/main.rs:12:9\n   |\n12 |     let tmp = 5;\n   |         ^^^ help: prefix it with an underscore: `_tmp`\n' +
      '\nerror[E0308]: mismatched types\n --> src/lib.rs:40:20\n   |\n40 |     let n: u32 = "5";\n   |            ---   ^^^ expected `u32`, found `&str`\n\nerror: could not compile `app` (lib) due to 1 previous error\n',
    must: ['error[E0308]: mismatched types', ' --> src/lib.rs:40:20', 'error: could not compile `app` (lib) due to 1 previous error', 'warning: unused variable: `tmp`'],
  },
  {
    name: 'docker build progress redraws', command: 'docker build .',
    text: range(60, i => range(20, k => `\r#${i} downloading ${'='.repeat(k)}> ${k * 5}%`) + `\r#${i} DONE ${i / 10}s`) + '\n#61 ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1\n',
    must: ['#61 ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1', '#59 DONE 5.9s'],
  },
  {
    name: 'jest toEqual diff', command: 'npx jest',
    text: range(300, i => `PASS src/feature${i}.test.js`) +
      '\n FAIL  src/order.test.js\n  ● order total › applies discount\n\n    expect(received).toEqual(expected) // deep equality\n\n' +
      '    - Expected  - 1\n    + Received  + 1\n\n      Object {\n    -   "total": 1050,\n    +   "total": 1049,\n      }\n\n' +
      '      12 |   const o = applyDiscount(order, 0.05);\n    > 13 |   expect(o).toEqual({ total: 1050 });\n         |             ^\n\n' +
      '      at Object.<anonymous> (src/order.test.js:13:13)\n\nTests:       1 failed, 300 passed, 301 total\n',
    must: ['"total": 1050', '"total": 1049', 'src/order.test.js:13:13', 'Tests:       1 failed, 300 passed, 301 total', '● order total › applies discount'],
  },
  {
    name: 'go test got/want', command: 'go test ./...',
    text: range(200, i => `=== RUN   TestCase${i}\n--- PASS: TestCase${i} (0.00s)`) +
      '\n--- FAIL: TestAdd (0.00s)\n' + range(4, i => `    add_test.go:14: got ${8 + 2 * i}, want ${9 + 2 * i}`) + '\nFAIL\nFAIL\texample.com/calc\t0.012s\n',
    must: ['add_test.go:14: got 8, want 9', 'add_test.go:14: got 14, want 15', 'FAIL\texample.com/calc', '--- FAIL: TestAdd'],
  },
  {
    name: 'cargo with OSC hyperlinks', command: 'cargo build',
    text: range(260, i => `   Compiling crate-${i} v0.1.0`) + '\nerror[E0308]: mismatched types\n --> \x1b]8;;file:///x/src/lib.rs\x1b\\src/lib.rs:40:20\x1b]8;;\x1b\\\n' +
      range(20, i => `note ${i}`) + '\n\x07done\n',
    must: ['error[E0308]: mismatched types', 'src/lib.rs:40:20'],
  },
  {
    name: 'errors redrawn with carriage returns', command: 'make',
    text: range(300, i => `Error: thing ${i} failed`).replace(/\n/g, '\r') + '\nmake: *** [all] Error 1\n',
    must: ['Error: thing 0 failed', 'Error: thing 150 failed', 'Error: thing 299 failed', 'make: *** [all] Error 1'],
  },
  {
    name: 'script data output (npm run report)', command: 'npm run report',
    text: range(400, i => `user ${i}: balance ${(i * 37) % 1000}`), must: ['user 7: balance 259', 'user 399: balance 763'], untouched: true,
  },
  {
    name: 'npm ls tree (listing = payload)', command: 'npm ls --all',
    text: range(300, i => `${'│ '.repeat(i % 4)}├── pkg-${i}@${i % 9}.${i % 5}.0`), must: ['├── pkg-299@2.4.0', '├── pkg-150@6.0.0'], untouched: true,
  },
  {
    name: 'small output (control)', command: 'git status',
    text: 'On branch main\nChanges not staged for commit:\n  modified:   src/app.ts\n', must: ['modified:   src/app.ts'], untouched: true,
  },
  {
    name: 'cat of a big file (payload)', command: 'cat src/big.ts',
    text: range(400, i => `export const v${i} = ${i};`), must: ['export const v399 = 399;'], untouched: true,
  },
  {
    name: 'docker logs with timestamps', command: 'docker compose logs',
    text: range(300, i => `2026-01-0${(i % 9) + 1}T12:${String(i % 60).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}Z app-${i % 4} | request handled in ${i % 90}ms`) +
      '\n2026-01-09T12:00:00Z app-1 | ERROR upstream refused the request\n',
    must: ['ERROR upstream refused the request'], untouched: false,
  },
  {
    name: 'npm deprecation spam', command: 'npm install',
    text: range(200, i => `npm WARN deprecated pkg-${i}@1.0.${i % 10}: no longer supported, use pkg-${i}-next`) +
      '\nnpm WARN config production Use `npm ci --omit=dev`\n\nadded 812 packages in 14s\n',
    must: ['npm WARN config production', 'added 812 packages'],
  },
];
