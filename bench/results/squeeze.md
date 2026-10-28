# Tool-output squeeze (approx chars/3.8 (run `npm i` in bench/ for o200k))

| output                               | tokens before | after | saved | needed lines kept |
|--------------------------------------|--------------:|------:|------:|------------------:|
| npm install                          |          6353 |   163 |   97% |               4/4 |
| vitest, 1 failure in 401 files       |          5246 |   269 |   95% |               4/4 |
| pytest -v, 1 failure                 |          5281 |   300 |   94% |               4/4 |
| tsc, 40 type errors (all signal)     |          1047 |  1047 |    0% |               3/3 |
| cargo build, 1 error                 |          2114 |   164 |   92% |               4/4 |
| docker build progress redraws        |         10421 |   609 |   94% |               2/2 |
| jest toEqual diff                    |          2301 |   192 |   92% |               5/5 |
| go test got/want                     |          2732 |   522 |   81% |               4/4 |
| cargo with OSC hyperlinks            |          2088 |    99 |   95% |               2/2 |
| errors redrawn with carriage returns |          1872 |  1872 |    0% |               4/4 |
| script data output (npm run report)  |          2277 |  2277 |    0% |               2/2 |
| npm ls tree (listing = payload)      |          1629 |  1629 |    0% |               2/2 |
| small output (control)               |            19 |    19 |    0% |               1/1 |
| cat of a big file (payload)          |          2573 |  2573 |    0% |               1/1 |
| docker logs with timestamps          |          4191 |   102 |   98% |               1/1 |
| npm deprecation spam                 |          3805 |   116 |   97% |               2/2 |
| total (squeezable)                   |         47451 |  5455 |   89% |               all |
