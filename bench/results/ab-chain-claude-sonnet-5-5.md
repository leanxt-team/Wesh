# Long sessions: Claude Code, claude-sonnet-5-5

6 real sessions; each asks the 8 tasks one after another in one conversation on one repo (mean per session).

| per session | no wesh | wesh | wesh + codegraph |
|---|--:|--:|--:|
| sessions | 2 | 2 | 2 |
| tasks solved at the end | 8.0 / 8 | 8.0 / 8 | 8.0 / 8 |
| earlier fixes broken by later turns | 0.0 | 0.0 | 0.0 |
| turns that errored | 0 | 0 | 0 |
| cost | $1.410 | $2.191 (+55%) | $2.411 (+71%) |
| wall time (s) | 106 | 127 (+20%) | 151 (+42%) |
| model steps | 47.5 | 62.5 (+32%) | 61.5 (+29%) |
| tokens processed | 1,048,728 | 1,511,533 (+44%) | 1,866,305 (+78%) |
| cache reads | 1,008,364 | 1,449,838 (+44%) | 1,802,394 (+79%) |
| output tokens | 10,159 | 12,310 (+21%) | 13,335 (+31%) |
| code lines changed | 61.0 | 59.0 (-3%) | 65.0 (+7%) |
| test lines added | 32.0 | 61.5 (+92%) | 55.0 (+72%) |

## Cost per turn as the session grows (mean $)

| turn | task | no wesh | wesh | wesh + codegraph |
|--:|---|--:|--:|--:|
| 1 | money-split | $0.048 | $0.092 | $0.114 |
| 2 | member-coupon | $0.082 | $0.140 | $0.169 |
| 3 | csv-export | $0.116 | $0.197 | $0.215 |
| 4 | user-validation | $0.143 | $0.255 | $0.271 |
| 5 | rename | $0.184 | $0.297 | $0.308 |
| 6 | sales-perf | $0.233 | $0.344 | $0.376 |
| 7 | path-traversal | $0.282 | $0.401 | $0.443 |
| 8 | daily-utc | $0.323 | $0.465 | $0.516 |
