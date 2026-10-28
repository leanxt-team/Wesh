# A/B: OpenCode 2.2, opencode/big-pickle

41 real runs: 8 tasks x 3 arms x up to 2 repeats, 2026-10-28. Every run: a fresh committed copy of the fixture repo, the same prompt, hidden checks the agent never sees, and the visible test suite. Arms differ only by a project-scoped wesh install. Token counts come from the host's own records; free models report no price, so cost is the same tokens priced at Sonnet 5.5 and Opus 5.5 rates.

## Overall (mean per run unless noted)

| | no wesh | wesh | wesh + codegraph |
|---|--:|--:|--:|
| tasks fully solved (all hidden checks + visible suite) | 13/14 | 14/14 | 12/13 |
| hidden checks passed | 97.8% | 100% | 97.7% |
| visible suite passes after | 100% | 100% | 100% |
| run errors | 0 | 1 | 0 |
| wall time, median (s) | 38.1 | 37.9 (0%) | 42.3 (+11%) |
| wall time, mean (s) | 50.1 | 90.7 (+81%) | 52.6 (+5%) |
| model steps | 7.0 | 16.0 (+129%) | 7.1 (+1%) |
| tool calls | 10.6 | 18.6 (+76%) | 7.5 (-29%) |
| input tokens, uncached | 9,762 | 10,053 (+3%) | 16,079 (+65%) |
| input tokens, cache read | 48,263 | 262,298 (+443%) | 61,229 (+27%) |
| output tokens (incl. reasoning) | 2,096 | 2,983 (+42%) | 1,933 (-8%) |
| tokens processed, total | 60,120 | 275,333 (+358%) | 79,240 (+32%) |
| cost if priced as Sonnet 5.5 | $0.075 | $0.154 (+104%) | $0.096 (+27%) |
| cost if priced as Opus 5.5 | $0.125 | $0.256 (+104%) | $0.159 (+27%) |
| code lines changed | 13.4 | 12.6 (-6%) | 14.8 (+10%) |
| test lines added | 6.1 | 6.5 (+6%) | 5.7 (-7%) |
| files touched | 1.6 | 1.6 (+5%) | 1.7 (+8%) |

## Paired by task (median of per-task ratios vs no wesh; robust to one hard task dominating the means)

| metric | wesh | wesh + codegraph | tasks where wesh is lower |
|---|--:|--:|--:|
| wall time | +25% | +6% | 4/8 , 3/7 |
| tokens processed | +24% | +96% | 3/8 , 3/7 |
| cost (Sonnet rates) | +26% | +41% | 4/8 , 2/7 |
| model steps | -4% | +11% | 4/8 , 3/7 |
| code lines changed | +4% | -9% | 4/8 , 4/7 |

## Per task

| task | kind | arm | solved | hidden | time med (s) | steps | tokens processed | cost (Sonnet) | code lines | test lines |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| money-split | bug, shared helper | no wesh | 2/2 | 8/8 | 73.2 | 14.0 | 165,001 | $0.148 | 9.0 | 10.0 |
| money-split | bug, shared helper | wesh | 2/2 | 8/8 | 41.7 | 8.5 | 86,254 | $0.084 | 4.5 | 6.0 |
| money-split | bug, shared helper | wesh + codegraph | 2/2 | 8/8 | 46.4 | 10.0 | 131,037 | $0.114 | 4.5 | 3.5 |
| member-coupon | bug, cross-file | no wesh | 2/2 | 10/10 | 37.1 | 6.5 | 52,519 | $0.077 | 5.5 | 1.0 |
| member-coupon | bug, cross-file | wesh | 2/2 | 10/10 | 34.5 | 6.0 | 57,928 | $0.064 | 6.5 | 0.5 |
| member-coupon | bug, cross-file | wesh + codegraph | 2/2 | 10/10 | 49.0 | 12.0 | 146,827 | $0.129 | 9.0 | 1.5 |
| csv-export | feature | no wesh | 2/2 | 8/8 | 34.9 | 7.5 | 64,813 | $0.070 | 20.0 | 0.0 |
| csv-export | feature | wesh | 2/2 | 8/8 | 23.6 | 5.0 | 42,325 | $0.051 | 17.0 | 7.0 |
| csv-export | feature | wesh + codegraph | 2/2 | 8/8 | 33.4 | 4.0 | 32,926 | $0.065 | 21.0 | 0.0 |
| user-validation | feature, reuse | no wesh | 2/2 | 6/6 | 33.0 | 4.5 | 22,469 | $0.033 | 15.5 | 0.0 |
| user-validation | feature, reuse | wesh | 2/2 | 6/6 | 51.5 | 9.5 | 66,096 | $0.056 | 9.5 | 0.0 |
| user-validation | feature, reuse | wesh + codegraph | 2/2 | 6/6 | 34.9 | 5.0 | 44,048 | $0.071 | 12.0 | 0.0 |
| rename | refactor across callers | no wesh | 1/2 | 5/6 | 93.0 | 5.5 | 46,563 | $0.103 | 9.0 | 32.0 |
| rename | refactor across callers | wesh | 2/2 | 6/6 | 151.4 | 16.5 | 207,553 | $0.183 | 8.0 | 32.0 |
| rename | refactor across callers | wesh + codegraph | 2/2 | 6/6 | 106.2 | 9.5 | 113,940 | $0.146 | 8.0 | 32.0 |
| sales-perf | performance | no wesh | 2/2 | 4/4 | 52.5 | 5.5 | 32,502 | $0.053 | 28.5 | 0.0 |
| sales-perf | performance | wesh | 2/2 | 4/4 | 34.1 | 3.0 | 19,192 | $0.039 | 34.0 | 0.0 |
| sales-perf | performance | wesh + codegraph | 1/2 | 3/4 | 47.7 | 3.0 | 25,609 | $0.060 | 36.5 | 0.0 |
| path-traversal | security | no wesh | 1/1 | 2/2 | 17.6 | 4.0 | 18,662 | $0.024 | 11.0 | 0.0 |
| path-traversal | security | wesh | 1/1 | 2/2 | 50.4 | 4.0 | 25,778 | $0.054 | 14.0 | 0.0 |
| path-traversal | security | wesh + codegraph | 1/1 | 2/2 | 48.1 | 5.0 | 41,356 | $0.073 | 10.0 | 0.0 |
| daily-utc | failing test | no wesh | 1/1 | 2/2 | 36.3 | 7.0 | 55,286 | $0.059 | 2.0 | 0.0 |
| daily-utc | failing test | wesh | 1/1 | 2/2 | 545.8 | 123.0 | 2,870,194 | $1.140 | 4.0 | 0.0 |

## Runs that did not fully solve the task

- rename / no wesh #1: hidden 2/3, visible pass
- sales-perf / wesh + codegraph #2: hidden 1/2, visible pass
