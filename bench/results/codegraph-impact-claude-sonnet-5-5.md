# codegraph on top of wesh (claude-sonnet-5-5, OpenCode 2.2 prompt sizes)

| project                         |                   repo | sessions x requests | exploration calls: grep / codegraph | cost wesh | cost wesh + codegraph | codegraph adds |                          source |
|---------------------------------|-----------------------:|--------------------:|------------------------------------:|----------:|----------------------:|---------------:|--------------------------------:|
| short project                   | small (~100-300 files) |              1 x 40 |                              10 / 4 |     $0.70 |                 $0.63 |          -9.5% | scaled from codegraph benchmark |
| long project                    |   medium (~1-3k files) |              5 x 96 |                            180 / 80 |    $14.11 |                $11.50 |         -18.5% |         measured (8 agent runs) |
| very long project               |    large (~10k+ files) |            20 x 200 |                          2400 / 360 |   $196.18 |                $74.99 |         -61.8% | scaled from codegraph benchmark |
| very long, half the exploration |    large (~10k+ files) |            20 x 140 |                          1200 / 180 |   $106.71 |                $58.76 |         -44.9% | scaled from codegraph benchmark |
