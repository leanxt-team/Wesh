# A/B: Claude Code, claude-sonnet-5-5

48 real runs: 8 tasks x 3 arms x up to 2 repeats, 2026-10-28. Every run: a fresh committed copy of the fixture repo, the same prompt, hidden checks the agent never sees, and the visible test suite. Arms differ only by a project-scoped wesh install. Token counts come from the host's own records; free models report no price, so cost is the same tokens priced at Sonnet 5.5 and Opus 5.5 rates.

## Overall (mean per run unless noted)

| | no wesh | wesh | wesh + codegraph |
|---|--:|--:|--:|
| tasks fully solved (all hidden checks + visible suite) | 16/16 | 16/16 | 16/16 |
| hidden checks passed | 100% | 100% | 100% |
| visible suite passes after | 100% | 100% | 100% |
| run errors | 0 | 0 | 0 |
| wall time, median (s) | 12.0 | 15.6 (+30%) | 18.8 (+57%) |
| wall time, mean (s) | 12.9 | 16.0 (+24%) | 18.5 (+43%) |
| model steps | 5.1 | 7.2 (+40%) | 6.4 (+24%) |
| tool calls | 0.0 | 0.0 (-) | 0.0 (-) |
| input tokens, uncached | 9 | 10 (+16%) | 9 (+4%) |
| input tokens, cache read | 77,491 | 101,698 (+31%) | 99,929 (+29%) |
| output tokens (incl. reasoning) | 976 | 1,220 (+25%) | 1,076 (+10%) |
| tokens processed, total | 86,110 | 114,719 (+33%) | 114,841 (+33%) |
| cost if priced as Sonnet 5.5 | $0.067 | $0.093 (+40%) | $0.098 (+47%) |
| cost if priced as Opus 5.5 | $0.111 | $0.155 (+40%) | $0.163 (+47%) |
| code lines changed | 8.0 | 7.8 (-3%) | 7.4 (-7%) |
| test lines added | 4.0 | 6.3 (+56%) | 6.1 (+53%) |
| files touched | 1.4 | 1.9 (+41%) | 1.9 (+36%) |

## Paired by task (median of per-task ratios vs no wesh; robust to one hard task dominating the means)

| metric | wesh | wesh + codegraph | tasks where wesh is lower |
|---|--:|--:|--:|
| wall time | +37% | +37% | 2/8 , 0/8 |
| tokens processed | +28% | +49% | 2/8 , 1/8 |
| cost (Sonnet rates) | +35% | +56% | 0/8 , 0/8 |
| model steps | +33% | +17% | 0/8 , 0/8 |
| code lines changed | -3% | -7% | 4/8 , 5/8 |

## Per task

| task | kind | arm | solved | hidden | time med (s) | steps | tokens processed | cost (Sonnet) | code lines | test lines |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| money-split | bug, shared helper | no wesh | 2/2 | 8/8 | 13.2 | 7.0 | 88,863 | $0.069 | 3.5 | 0.0 |
| money-split | bug, shared helper | wesh | 2/2 | 8/8 | 18.1 | 10.5 | 164,548 | $0.119 | 3.0 | 3.5 |
| money-split | bug, shared helper | wesh + codegraph | 2/2 | 8/8 | 18.3 | 7.0 | 132,090 | $0.108 | 3.0 | 3.5 |
| member-coupon | bug, cross-file | no wesh | 2/2 | 10/10 | 11.1 | 5.5 | 70,291 | $0.061 | 6.0 | 0.0 |
| member-coupon | bug, cross-file | wesh | 2/2 | 10/10 | 15.6 | 7.5 | 131,643 | $0.102 | 7.0 | 1.0 |
| member-coupon | bug, cross-file | wesh + codegraph | 2/2 | 10/10 | 19.2 | 6.5 | 131,076 | $0.105 | 5.5 | 1.0 |
| csv-export | feature | no wesh | 2/2 | 8/8 | 20.7 | 7.5 | 147,971 | $0.105 | 13.0 | 0.0 |
| csv-export | feature | wesh | 2/2 | 8/8 | 20.1 | 10.0 | 129,079 | $0.112 | 12.0 | 5.0 |
| csv-export | feature | wesh + codegraph | 2/2 | 8/8 | 20.9 | 8.0 | 128,244 | $0.108 | 11.0 | 2.5 |
| user-validation | feature, reuse | no wesh | 2/2 | 6/6 | 9.2 | 6.0 | 78,437 | $0.063 | 8.0 | 0.0 |
| user-validation | feature, reuse | wesh | 2/2 | 6/6 | 14.4 | 8.0 | 111,789 | $0.091 | 6.0 | 4.0 |
| user-validation | feature, reuse | wesh + codegraph | 2/2 | 6/6 | 20.6 | 8.0 | 125,029 | $0.103 | 8.0 | 5.0 |
| rename | refactor across callers | no wesh | 2/2 | 6/6 | 8.9 | 3.0 | 61,406 | $0.052 | 8.0 | 32.0 |
| rename | refactor across callers | wesh | 2/2 | 6/6 | 12.2 | 3.0 | 68,852 | $0.065 | 8.0 | 32.0 |
| rename | refactor across callers | wesh + codegraph | 2/2 | 6/6 | 12.2 | 3.5 | 78,180 | $0.078 | 8.0 | 32.0 |
| sales-perf | performance | no wesh | 2/2 | 4/4 | 16.1 | 3.0 | 58,502 | $0.056 | 16.0 | 0.0 |
| sales-perf | performance | wesh | 2/2 | 4/4 | 14.5 | 4.0 | 66,198 | $0.069 | 15.0 | 0.0 |
| sales-perf | performance | wesh + codegraph | 2/2 | 4/4 | 18.5 | 5.5 | 87,401 | $0.088 | 15.0 | 0.0 |
| path-traversal | security | no wesh | 2/2 | 4/4 | 7.7 | 3.0 | 57,317 | $0.047 | 7.5 | 0.0 |
| path-traversal | security | wesh | 2/2 | 4/4 | 15.6 | 8.0 | 121,469 | $0.090 | 8.0 | 4.5 |
| path-traversal | security | wesh + codegraph | 2/2 | 4/4 | 20.0 | 6.0 | 98,373 | $0.085 | 6.5 | 5.0 |
| daily-utc | failing test | no wesh | 2/2 | 4/4 | 16.6 | 6.0 | 126,092 | $0.079 | 2.0 | 0.0 |
| daily-utc | failing test | wesh | 2/2 | 4/4 | 17.3 | 6.5 | 124,178 | $0.096 | 3.0 | 0.0 |
| daily-utc | failing test | wesh + codegraph | 2/2 | 4/4 | 18.5 | 6.5 | 138,340 | $0.110 | 2.5 | 0.0 |
