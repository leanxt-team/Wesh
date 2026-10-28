# wesh tests and benchmarks

Everything here runs locally. Nothing in the test suites calls a model, needs the codegraph CLI or an agent host.

## Test suites

```bash
cd bench && npm test
```

`reliability.test.mjs` (skill validity, installer safety and exact uninstall, hooks and plugins end to end),
`squeeze-p0.test.mjs` (command classification, OpenCode preview handling) and `autoindex-p0.test.mjs` (build, sync,
repair, locks, back-off, safety guards). The codegraph CLI is replaced by a Node fake in a folder whose name has a
space; tests that need `git` skip without it. CI runs them on Linux, macOS and Windows with Node 20 and 24.

## End-to-end harnesses (real host, mock model)

```bash
node bench/claude-e2e.mjs <claude binary> [install flags] [--e2e-twice] [--e2e-powershell] [--e2e-push]
node bench/opencode-e2e.mjs <opencode binary> [install flags] [--e2e-twice] [--e2e-uninstall]
```

Each installs wesh into a sandbox, runs the real host against a local mock model (no API key, nothing leaves the
machine) and checks what the host sends: rules and level, listed and hidden skills, the scout, squeezed output with
its signal lines, the session-start hook, codegraph answering from an index built by wesh, and (`--e2e-twice`) an edit
made between two sessions reaching the index. `--guard` with `--e2e-push` as its control proves the guard stops
`git push`. Skills and agents are installed from a copy whose descriptions carry a random tag, because on Windows both
hosts resolve the home folder through the OS and would otherwise also see the real `~/.claude/skills`.

## A/B with real models

```bash
node bench/ab/run.mjs --selftest                                # hidden checks fail on the fixture, pass on reference fixes
node bench/ab/run.mjs --claude <claude binary> [--model claude-sonnet-5-5] [--reps 2] [--arms none,wesh,wesh-cg]
node bench/ab/run.mjs --chain --claude <claude binary> ...      # long sessions: all tasks in one conversation
node bench/ab/run.mjs --host opencode --opencode <binary> ...   # OpenCode 2.2 with its free models
node bench/ab/run.mjs --variant <dir> ...                       # install from a copy with candidate files laid over it
node bench/ab/report.mjs <results.jsonl>                        # summary of one results file
node bench/ab/compare.mjs                                       # one table across wesh versions
```

The fixture (`ab/fixture.mjs`) is a ~60-file Node shop with a long test suite; `ab/tasks.mjs` holds 8 tasks phrased
as a developer would (a shared-helper bug, a cross-file pricing bug, a CSV export, input validation, a rename across
callers, a performance fix, a path traversal, a failing test) with hidden checks the agent never sees. Every run gets a
fresh committed copy. The no-wesh arm keeps the user's own configuration out (`--setting-sources project,local`,
`--strict-mcp-config`, `claudeMdExcludes`), so arms differ only by a project-scoped wesh install. Claude Code runs need
a logged-in `claude` CLI and cost real usage.

Latest results, Claude Code + Sonnet 5.5, cost against no wesh (`results/ab-versions.md`; 2 runs or sessions per
wesh cell, differences under ~15% are noise):

| benchmark | v1 | current |
|---|--:|--:|
| single tasks | +44% | +21% |
| long session (8 tasks) | +62% | -7% |

Every task was solved by every arm.

## Other scripts

| script | measures |
|---|---|
| `static.mjs` | fixed overhead per request (rules, skill listing) |
| `squeeze.mjs` | squeeze on fixture logs, with the lines that must survive |
| `simulate.mjs` | a session cost model (modelled, not measured; real A/B runs above supersede it) |
| `opencode-session.mjs` | squeeze's mechanical effect in a scripted OpenCode 2.2 session (fixed agent behaviour) |
| `codegraph-impact.mjs`, `codegraph-overhead.mjs` | codegraph cost model and its per-request overhead |
| `live.mjs` | rules-only A/B through the API (needs `ANTHROPIC_API_KEY`) |

Results of every script are in `results/`.
