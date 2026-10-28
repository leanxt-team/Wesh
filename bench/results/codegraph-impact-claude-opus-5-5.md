# codegraph on top of wesh (claude-opus-5-5, OpenCode 2.2 prompt sizes)

| project                         |                   repo | sessions x requests | exploration calls: grep / codegraph | cost wesh | cost wesh + codegraph | codegraph adds |                          source |
|---------------------------------|-----------------------:|--------------------:|------------------------------------:|----------:|----------------------:|---------------:|--------------------------------:|
| short project                   | small (~100-300 files) |              1 x 40 |                              10 / 4 |     $1.01 |                 $0.94 |          -7.3% | scaled from codegraph benchmark |
| long project                    |   medium (~1-3k files) |              5 x 96 |                            180 / 80 |    $17.67 |                $14.88 |         -15.8% |         measured (8 agent runs) |
| very long project               |    large (~10k+ files) |            20 x 200 |                          2400 / 360 |   $223.41 |                $93.19 |         -58.3% | scaled from codegraph benchmark |
| very long, half the exploration |    large (~10k+ files) |            20 x 140 |                          1200 / 180 |   $126.89 |                $74.44 |         -41.3% | scaled from codegraph benchmark |
