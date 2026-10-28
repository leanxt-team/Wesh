# Session cost model (claude-sonnet-5-5, $2/$10 in/out, cache read $0.2)

## quick Q&A (3 requests, 800 new input + 400 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |        3 |             66,000 |      1,200 |  0.079 |          0% |
| all 3 installed         |        2 |             49,982 |        424 |  0.073 |       -7.2% |
| wesh, overhead only    |        3 |             69,669 |      1,200 |  0.082 |       +4.5% |
| wesh low               |        3 |             69,429 |        960 |  0.079 |       +0.9% |
| wesh central           |        2 |             44,826 |        440 |  0.066 |        -16% |
| wesh high              |        2 |             44,446 |        400 |  0.065 |      -17.4% |
| wesh central + squeeze |        2 |             44,475 |        440 |  0.065 |      -16.8% |

## bug fix (25 requests, 2500 new input + 350 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |       25 |          1,417,500 |      8,750 |  0.580 |          0% |
| all 3 installed         |       20 |          1,044,825 |      3,710 |  0.425 |      -26.8% |
| wesh, overhead only    |       25 |          1,459,350 |      8,750 |  0.592 |       +2.1% |
| wesh low               |       23 |          1,259,342 |      6,440 |  0.513 |      -11.6% |
| wesh central           |       20 |            925,230 |      3,850 |  0.382 |      -34.1% |
| wesh high              |       18 |            709,958 |      3,150 |  0.302 |      -47.9% |
| wesh central + squeeze |       20 |            855,359 |      3,850 |  0.353 |      -39.2% |

## feature (60 requests, 3000 new input + 500 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |       60 |          7,575,000 |     30,000 |  2.343 |          0% |
| all 3 installed         |       47 |          4,795,867 |     12,455 |  1.489 |      -36.4% |
| wesh, overhead only    |       60 |          7,702,049 |     30,000 |  2.373 |       +1.3% |
| wesh low               |       54 |          6,221,699 |     21,600 |  1.933 |      -17.5% |
| wesh central           |       47 |          4,243,555 |     12,925 |  1.338 |      -42.9% |
| wesh high              |       42 |          2,979,397 |     10,500 |  0.974 |      -58.4% |
| wesh central + squeeze |       47 |          3,793,187 |     12,925 |  1.205 |      -48.6% |

## exploration-heavy (40 requests, 5000 new input + 300 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |       40 |          5,134,000 |     12,000 |  1.680 |          0% |
| all 3 installed         |       31 |          3,076,719 |      4,929 |  1.057 |      -37.1% |
| wesh, overhead only    |       40 |          5,200,960 |     12,000 |  1.697 |         +1% |
| wesh low               |       36 |          4,261,464 |      8,640 |  1.422 |      -15.4% |
| wesh central           |       31 |          2,638,379 |      5,115 |  0.915 |      -45.5% |
| wesh high              |       28 |          1,778,042 |      4,200 |  0.639 |        -62% |
| wesh central + squeeze |       31 |          2,340,965 |      5,115 |  0.813 |      -51.6% |

## long session (stress) (200 requests, 3000 new input + 450 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |      200 |         73,255,000 |     90,000 | 17.183 |          0% |
| all 3 installed         |      156 |         43,242,995 |     37,206 | 10.229 |      -40.5% |
| wesh, overhead only    |      200 |         73,946,090 |     90,000 | 17.329 |       +0.9% |
| wesh low               |      180 |         58,891,130 |     64,800 | 13.870 |      -19.3% |
| wesh central           |      156 |         38,208,275 |     38,610 |  9.100 |        -47% |
| wesh high              |      140 |         25,532,435 |     31,500 |  6.210 |      -63.9% |
| wesh central + squeeze |      156 |         33,318,906 |     38,610 |  7.979 |      -53.6% |

Calibration: ponytail's published agentic run measured -26% cost (95% CI -36..-16) with these turn/output multipliers. The "all 3 installed" bug-fix row should land in that band if the model is sane.
