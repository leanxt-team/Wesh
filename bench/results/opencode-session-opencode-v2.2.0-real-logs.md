# OpenCode session benchmark (opencode v2.2.0, o200k (js-tiktoken), real captured logs)

## 1 fix/test/build cycle(s): grep, read, then 1 x (npm test, edit, npm test, npm run build)

| arm               | requests | fix applied | first request | system prompt | tool results (last req) | tokens sent (sum) | cost $ | vs no wesh |
|-------------------|---------:|------------:|--------------:|--------------:|------------------------:|------------------:|-------:|------------:|
| no wesh          |      7/7 |         yes |          5619 |          2525 |                   15464 |            63,130 | 0.1413 |        0.0% |
| wesh             |      7/7 |         yes |          6599 |          3415 |                    6304 |            60,072 | 0.0979 |      -30.8% |
| wesh, no squeeze |      7/7 |         yes |          6608 |          3424 |                   15468 |            70,077 | 0.1475 |       +4.4% |

## 5 fix/test/build cycle(s): grep, read, then 5 x (npm test, edit, npm test, npm run build)

| arm               | requests | fix applied | first request | system prompt | tool results (last req) | tokens sent (sum) | cost $ | vs no wesh |
|-------------------|---------:|------------:|--------------:|--------------:|------------------------:|------------------:|-------:|------------:|
| no wesh          |    23/23 |         yes |          5615 |          2521 |                   75463 |           891,634 | 0.6649 |        0.0% |
| wesh             |    23/23 |         yes |          6593 |          3409 |                   29677 |           468,314 | 0.3472 |      -47.8% |
| wesh, no squeeze |    23/23 |         yes |          6602 |          3418 |                   75468 |           914,423 | 0.6742 |       +1.4% |

Same scripted agent in every arm: this isolates what wesh changes mechanically (rules and skill overhead, squeezed
tool output). Behaviour gains (fewer turns, less code) are not in these numbers.
