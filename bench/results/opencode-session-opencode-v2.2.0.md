# OpenCode session benchmark (opencode v2.2.0, o200k (js-tiktoken))

## 1 fix/test/build cycle(s): grep, read, then 1 x (npm test, edit, npm test, npm run build)

| arm               | requests | fix applied | first request | system prompt | tool results (last req) | tokens sent (sum) | cost $ | vs no wesh |
|-------------------|---------:|------------:|--------------:|--------------:|------------------------:|------------------:|-------:|------------:|
| no wesh          |      7/7 |         yes |          5615 |          2521 |                   20194 |            86,927 | 0.1659 |        0.0% |
| wesh             |      7/7 |         yes |          6596 |          3412 |                     698 |            50,393 | 0.0683 |      -58.8% |
| wesh, no squeeze |      7/7 |         yes |          6605 |          3421 |                   20203 |            93,911 | 0.1721 |       +3.7% |

## 5 fix/test/build cycle(s): grep, read, then 5 x (npm test, edit, npm test, npm run build)

| arm               | requests | fix applied | first request | system prompt | tool results (last req) | tokens sent (sum) | cost $ | vs no wesh |
|-------------------|---------:|------------:|--------------:|--------------:|------------------------:|------------------:|-------:|------------:|
| no wesh          |    23/23 |         yes |          5615 |          2521 |                   99653 |         1,181,143 | 0.8246 |        0.0% |
| wesh             |    23/23 |         yes |          6593 |          3409 |                    2171 |           195,166 | 0.1572 |      -80.9% |
| wesh, no squeeze |    23/23 |         yes |          6605 |          3421 |                   99662 |         1,204,111 | 0.8340 |       +1.1% |

Same scripted agent in every arm: this isolates what wesh changes mechanically (rules and skill overhead, squeezed
tool output). Behaviour gains (fewer turns, less code) are not in these numbers.
