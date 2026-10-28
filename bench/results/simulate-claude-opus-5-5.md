# Session cost model (claude-opus-5-5, $4/$20 in/out, cache read $0.2)

## quick Q&A (3 requests, 800 new input + 400 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |        3 |             66,000 |      1,200 |  0.149 |          0% |
| all 3 installed         |        2 |             49,982 |        424 |  0.141 |       -5.2% |
| wesh, overhead only    |        3 |             69,669 |      1,200 |  0.155 |       +4.4% |
| wesh low               |        3 |             69,429 |        960 |  0.150 |       +0.7% |
| wesh central           |        2 |             44,826 |        440 |  0.128 |      -14.1% |
| wesh high              |        2 |             44,446 |        400 |  0.125 |      -15.5% |
| wesh central + squeeze |        2 |             44,475 |        440 |  0.126 |      -14.9% |

## bug fix (25 requests, 2500 new input + 350 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |       25 |          1,417,500 |      8,750 |  0.895 |          0% |
| all 3 installed         |       20 |          1,044,825 |      3,710 |  0.655 |      -26.8% |
| wesh, overhead only    |       25 |          1,459,350 |      8,750 |  0.911 |       +1.8% |
| wesh low               |       23 |          1,259,342 |      6,440 |  0.790 |      -11.7% |
| wesh central           |       20 |            925,230 |      3,850 |  0.592 |      -33.8% |
| wesh high              |       18 |            709,958 |      3,150 |  0.472 |      -47.2% |
| wesh central + squeeze |       20 |            855,359 |      3,850 |  0.546 |      -38.9% |

## feature (60 requests, 3000 new input + 500 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |       60 |          7,575,000 |     30,000 |  3.217 |          0% |
| all 3 installed         |       47 |          4,795,867 |     12,455 |  2.053 |      -36.2% |
| wesh, overhead only    |       60 |          7,702,049 |     30,000 |  3.252 |       +1.1% |
| wesh low               |       54 |          6,221,699 |     21,600 |  2.662 |      -17.2% |
| wesh central           |       47 |          4,243,555 |     12,925 |  1.857 |      -42.3% |
| wesh high              |       42 |          2,979,397 |     10,500 |  1.374 |      -57.3% |
| wesh central + squeeze |       47 |          3,793,187 |     12,925 |  1.677 |      -47.9% |

## exploration-heavy (40 requests, 5000 new input + 300 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |       40 |          5,134,000 |     12,000 |  2.379 |          0% |
| all 3 installed         |       31 |          3,076,719 |      4,929 |  1.530 |      -35.7% |
| wesh, overhead only    |       40 |          5,200,960 |     12,000 |  2.400 |       +0.9% |
| wesh low               |       36 |          4,261,464 |      8,640 |  2.033 |      -14.5% |
| wesh central           |       31 |          2,638,379 |      5,115 |  1.328 |      -44.2% |
| wesh high              |       28 |          1,778,042 |      4,200 |  0.938 |      -60.6% |
| wesh central + squeeze |       31 |          2,340,965 |      5,115 |  1.180 |      -50.4% |

## long session (stress) (200 requests, 3000 new input + 450 output tok/request)

| arm                     | requests | input tok (billed) | output tok | cost $ | vs no skill |
|-------------------------|---------:|-------------------:|-----------:|-------:|------------:|
| no skill                |      200 |         73,255,000 |     90,000 | 19.857 |          0% |
| all 3 installed         |      156 |         43,242,995 |     37,206 | 11.910 |        -40% |
| wesh, overhead only    |      200 |         73,946,090 |     90,000 | 20.012 |       +0.8% |
| wesh low               |      180 |         58,891,130 |     64,800 | 16.088 |        -19% |
| wesh central           |      156 |         38,208,275 |     38,610 | 10.646 |      -46.4% |
| wesh high              |      140 |         25,532,435 |     31,500 |  7.373 |      -62.9% |
| wesh central + squeeze |      156 |         33,318,906 |     38,610 |  9.369 |      -52.8% |

Calibration: ponytail's published agentic run measured -26% cost (95% CI -36..-16) with these turn/output multipliers. The "all 3 installed" bug-fix row should land in that band if the model is sane.
