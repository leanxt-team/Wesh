# Practical runs (2026-10-27)

## A/B: wesh rules vs default style, Opus 5.5 subagents in Claude Code

6 tasks, 1 run per arm (n=1: indicative, not significant). Same prompt; the wesh arm read `core/CORE.md` first
(one extra tool call that a real install avoids, since the rules are preloaded). Graded afterwards with hidden checks
the agents never saw. Baseline caveat: subagents may also load `~/.claude/CLAUDE.md`, which holds the wesh block;
the baseline arm was told to ignore it, and its replies and code show default behavior (no `Skipped/unchecked` line,
extra features).

| task | hidden checks wesh / base | code lines wesh / base | test lines wesh / base | tokens wesh / base | tool calls | time s |
|---|---|--:|--:|--:|--:|--:|
| csv-sum | pass / pass | 39 / 54 | 9 / 10 | 65,058 / 64,884 | 5 / 5 | 32 / 72 |
| safe-join (security) | pass / pass | 14 / 49 | 18 / 21 | 65,896 / 66,526 | 5 / 6 | 49 / 90 |
| rate-limit (scale) | pass / pass | 33 / 47 | 36 / 23 | 66,409 / 65,995 | 5 / 4 | 74 / 88 |
| parse-duration | pass / pass | 18 / 38 | 19 / 0 | 66,548 / 64,419 | 6 / 3 | 53 / 34 |
| shop bug fix (shared helper, 2 callers) | pass / pass | 1 / 1, root cause fixed in both | 5 / 14 | 68,284 / 67,147 | 12 / 9 | 91 / 72 |
| todo CSV feature (Excel) | pass / pass | 9 / 14 | 19 / 0 | 66,820 / 66,435 | 9 / 8 | 73 / 88 |
| **total** | **12/12** | **114 / 203 (-44%)** | tests left: **6/6 vs 4/6** | 399,015 / 395,406 (+0.9%) | 42 / 35 | **372 / 444 (-16%)** |

Reading:
- Less code with the same correctness: -44% lines, all hidden checks pass in both arms (ponytail's large benchmark: -53%).
- More reliable tests: wesh left a test for every non-trivial change; default skipped tests on 2 of 6.
- Default overbuilt where it was free to: `safe-join` added an async `safeJoinReal`, an error class and NTFS
  stream rules (49 lines vs 14), `rate-limit` added a `size` getter.
- Tokens: flat. On tasks this small, ~60k of each run is the host's fixed system prompt and tools; the work itself is
  a few thousand tokens. The extra CORE.md read (~1k tokens, 1 call per run) also only exists in this test setup.
  Savings show up on long sessions, where re-read context dominates (see simulate.md), not on one-shot functions.
- Both arms found the root cause of the shop bug in the shared helper and left the refund workaround in place.

## Squeeze on real command output captured on this machine

| real log | lines | tokens before | after | saved | needed lines kept |
|---|--:|--:|--:|--:|--:|
| `npm install --loglevel http` (3 packages) | 444 | 12,976 | 2,543 | 80% | 1/1 |
| `npx vitest run` (61 files, 1 failure) | 99 | 1,399 | 658 | 53% | 4/4 |
| `npx tsc --noEmit` (25 errors, all signal) | 26 | 700 | 700 | 0% | 3/3 |
| `npm ls --all` (listing = payload) | 260 | 4,545 | 4,545 | 0% | 2/2 |
| `node --test` (small, passing) | 31 | 469 | 469 | 0% | n/a |

Real noisy output shrinks 53-80% (synthetic fixtures: 93%). The first real run found a defect: `npm ls` lines were
collapsed as "similar" and hid a dependency. Squeeze is now limited to known build/test/install commands, so listings,
searches and file views are never touched.
