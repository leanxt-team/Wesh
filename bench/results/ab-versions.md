# wesh versions compared (Claude Code, Sonnet 5.5, real runs)

Cost and time are means per run (single tasks) or per session (long sessions); % is against the pooled no-wesh baseline of the same benchmark. Solved = tasks with every hidden check and the full suite passing. n = runs or sessions behind each cell.

## Small repo (60 files), single tasks

| version | n | cost | vs no wesh | time | vs no wesh | steps | solved | code lines | test lines |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| no wesh | 32 | $0.048 |  | 13 s |  | 5.2 | 32/32 | 8.2 | 4.2 |
| v1 | 16 | $0.070 | +44% | 16 s | +24% | 7.2 | 16/16 | 7.8 | 6.3 |
| v1 + codegraph | 16 | $0.076 | +58% | 19 s | +43% | 6.4 | 16/16 | 7.4 | 6.1 |
| v2 | 16 | $0.065 | +35% | 12 s | -8% | 5.9 | 16/16 | 7.9 | 4.9 |
| caveman | 16 | $0.058 | +21% | 11 s | -14% | 5.1 | 16/16 | 7.6 | 4.2 |
| caveman + codegraph | 16 | $0.062 | +29% | 13 s | -2% | 4.9 | 16/16 | 7.8 | 4.4 |

## Small repo (60 files), long session (8 tasks)

| version | n | cost | vs no wesh | time | vs no wesh | steps | solved | code lines | test lines |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| no wesh | 4 | $1.354 |  | 102 s |  | 43.5 | 32/32 | 61.5 | 35.5 |
| v1 | 2 | $2.191 | +62% | 127 s | +25% | 62.5 | 16/16 | 59.0 | 61.5 |
| v1 + codegraph | 2 | $2.411 | +78% | 151 s | +48% | 61.5 | 16/16 | 65.0 | 55.0 |
| v2 | 2 | $1.670 | +23% | 99 s | -3% | 48.5 | 16/16 | 61.0 | 37.5 |
| v3 | 2 | $1.407 | +4% | 98 s | -4% | 43.0 | 16/16 | 61.0 | 34.5 |
| caveman | 2 | $1.256 | -7% | 81 s | -21% | 40.0 | 16/16 | 61.0 | 33.5 |
| caveman + codegraph | 2 | $1.293 | -5% | 501 s | +392% | 38.5 | 16/16 | 62.0 | 34.0 |
