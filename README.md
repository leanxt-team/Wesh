# wesh

One skill library for coding fast, reliably and cheaply in **Claude Code** and **OpenCode / OpenChamber**.
It merges the best parts of [caveman](https://github.com/JuliusBrussee/caveman) (terse voice, compressed rules),
[ponytail](https://github.com/dietrichgebert/ponytail) (smallest complete change) and
[mattpocock/skills](https://github.com/mattpocock/skills) (debug loop, TDD, planning, review discipline), adds a
local code graph and an output squeezer, and drops everything that costs tokens without paying them back.

## What it does

- **Codes like ponytail.** Smallest complete change, reuse before writing, root-cause fixes, no speculative code,
  minimal diffs, and a never-cut list (validation, auth, security, data-loss guards, error handling, accessibility,
  migration safety). Tests are added when you ask, or for risky logic (money, security, parsing, data writes).
- **Talks like a caveman.** The always-on rules are written caveman-style and the default voice is caveman: answer
  first, no filler, exact numbers, code and paths. Full sentences for security warnings, irreversible actions,
  questions to you and anything written to files. `/wesh-level lite` switches to normal prose.
- **Debugs, tests and reviews like Matt Pocock, on demand.** `wesh-debug`, `wesh-tdd`, `wesh-refactor` and
  `wesh-review` load only when the situation calls for them, so plain tasks stay cheap.
- **Searches with a code graph.** On repositories of 200 tracked files or more, each project gets a local
  [codegraph](https://github.com/colbymchenry/codegraph) index, built and kept in sync automatically. Cross-file
  questions go to `codegraph_explore` first; grep remains for exact strings, config and confirming that something is
  unused.
- **Reads less.** Long build, test and install output reaches the model as head, tail and error lines with their
  context; the raw output is kept in a private file the agent can grep.

## What's inside

| | Name | From | Purpose |
|---|---|---|---|
| always on | core rules (`core/CORE.md`, ~600 tokens; ~130 more with the code graph rules) | ponytail + caveman | scope, smallest complete change, never-cut list, token thrift, voice levels |
| auto | `wesh-debug` | diagnosing-bugs | reproduce-first loop, ranked hypotheses, fix at the owning layer |
| auto | `wesh-tdd` | tdd | red-to-green slices at public seams, when you ask for TDD |
| auto | `wesh-refactor` | safe-refactor + migration | behavior proven before and after, rollback for migrations |
| auto | `wesh-review` | ponytail review + caveman-review | diff, PR or repo review with numbered findings |
| auto | `wesh-commit` | caveman-commit | Conventional Commits message |
| `/` only | `/wesh-level` | ponytail levels | `lite` / `full` / `ultra` / `off` / `help` |
| `/` only | `/wesh-plan` | grilling + to-spec | questions with recommended answers, then a short spec |
| `/` only | `/wesh-handoff` | handoff | compress a long session into a handoff file for a fresh one |
| `/` only | `/wesh-slim` | caveman-compress | shrink `CLAUDE.md` / `AGENTS.md`, every fact kept |
| `/` only | `/wesh-debt` | ponytail-debt | ledger of `shortcut:` comments |
| subagent | `wesh-scout` | caveman-explore | cheap read-only locator, `path:line` output |
| hook | squeeze | caveman "read less" | trims long build/test/install output |
| built in | codegraph | colbymchenry/codegraph | local code graph per project, built and synced automatically |

Left out on purpose (cost more than they save): caveman's cloud/proxy/MCP products and builder subagent, ponytail's
dashboards, mattpocock's issue-tracker workflows, teaching and writing skills. Each extra listed skill costs tokens on
every request.

## Install

Needs Node.js 18+. From this folder:

```bash
node install.mjs
```

On Windows `.\install.ps1`, on macOS/Linux `sh install.sh` (same options). Then restart Claude Code, OpenCode or
OpenChamber. Nothing else to set up. The installer finds which agents you have and installs for those (both if it
finds neither); `node install.mjs --help` lists every option.

| flag | default | |
|---|---|---|
| `--target claude\|opencode\|both` | the agents found | |
| `--scope user\|project` | `user` | `project` writes `.claude/`, `.opencode/`, `CLAUDE.md`, `opencode.json` in the current folder (commit them to share with a team) |
| `--level lite\|full\|ultra` | `full` | default voice; remembered, and a hand-edited `Level:` line is kept |
| `--scout-model provider/model` | none | OpenCode only: run `wesh-scout` on a cheap model, e.g. `anthropic/claude-haiku-5-5` |
| `--no-squeeze` / `--squeeze` | on | the output squeeze |
| `--no-codegraph` / `--codegraph` | on | the code graph (uses `codegraph` on PATH, else offers to install the pinned `@colbymchenry/codegraph@1.6.2` with npm) |
| `--codegraph-cli <path>` | | a codegraph binary that is not on PATH |
| `--opencode-version 1\|2` | detected | MCP entry shape for OpenCode |
| `--guard` / `--no-guard` | off | ask before `git push`, `reset --hard`, `clean`, `branch -D`, `checkout -- .`, `restore .`, `rm -rf` |
| `--dry-run`, `--uninstall` | | |

PowerShell flags mirror these: `-Target`, `-Scope`, `-Project`, `-Level`, `-Codegraph`, `-NoCodegraph`,
`-CodegraphCli`, `-OpencodeVersion`, `-ScoutModel`, `-Squeeze`, `-NoSqueeze`, `-Guard`, `-NoGuard`, `-Uninstall`,
`-DryRun`.

Environment: `WESH_CODEGRAPH=0` makes the code graph off by default; `WESH_AUTOINDEX=0` keeps codegraph but stops
automatic indexing; `WESH_AUTOINDEX_MIN_FILES` (200) and `WESH_AUTOINDEX_MAX_FILES` (20,000) bound the repositories
indexed automatically, `WESH_AUTOINDEX_FORCE=1` overrides both; `WESH_RAW=1 <cmd>` (PowerShell:
`$env:WESH_RAW=1; <cmd>`) shows one command's output untrimmed; `WESH_SQUEEZE=0` turns trimming off;
`WESH_SQUEEZE_SAVE=0` keeps no raw copies.

### What goes where

| | Claude Code | OpenCode / OpenChamber |
|---|---|---|
| core rules | marked block in `~/.claude/CLAUDE.md` | `~/.config/opencode/wesh/CORE.md`, listed in `instructions` of `opencode.json` |
| skills | `~/.claude/skills/wesh*` | read from `~/.claude/skills`; copied to `~/.config/opencode/skills` for `--target opencode` or when `OPENCODE_DISABLE_CLAUDE_CODE` is set |
| scout | `~/.claude/agents/wesh-scout.md` (Haiku) | `~/.config/opencode/agents/wesh-scout.md` (read-only subagent) |
| `/` commands | skills with `disable-model-invocation` | `~/.config/opencode/commands/wesh*.md` |
| squeeze | `PostToolUse` hook on `Bash\|PowerShell` in `settings.json`, scripts in `~/.claude/wesh/` | plugin `~/.config/opencode/plugins/wesh-squeeze.js` |
| guard | `permissions.ask` in `settings.json` | `permission.bash` in `opencode.json` |
| codegraph | MCP server in `~/.claude.json` (project scope: `.mcp.json`), `SessionStart` auto-index hook | `mcp.servers.codegraph` (OpenCode 2) or `mcp.codegraph` (OpenCode 1), plugin `plugins/wesh-codegraph.js` |

In `CLAUDE.md` the installer touches only its marked block. In JSON configs it records every entry it adds and
uninstall removes exactly those; config files are written atomically, a file with comments is never rewritten (the
change is printed instead), and one `*.wesh-bak` copy of each file is kept from before wesh first changed it.

**OpenChamber** runs on the OpenCode server and uses the same `~/.config/opencode` config: install with
`--target opencode` (or `both`), then restart OpenChamber.

## Code graph

When a session opens a project with 200 or more tracked files and no graph yet, wesh starts `codegraph init` in the
background; the session starts at once and the agent uses grep/Read until the index exists. At every session start it
then syncs the index if files changed while no codegraph server was watching, and rebuilds it if a run was killed or
a codegraph upgrade asks for it; a build that fails is retried after a day, not at every session. Everything stays
local (SQLite in each repository's self-gitignored `.codegraph/`), telemetry is turned off and your previous setting
is restored on uninstall.

Guards: only real projects (a `.git` folder or a project manifest), never your home folder, a drive root or the temp
folder (also when the home folder is itself a git repository), one build at a time per project, no repository over
20,000 files unless you force it. The index lives at the git top level, so a monorepo subfolder uses the root's graph.
An existing codegraph setup is left alone; indexes you built yourself are never removed by wesh.

| question | command | returns |
|---|---|---|
| how does X work / what breaks if I change it | `codegraph_explore "<query>"` (MCP tool) | relevant source, call paths, blast radius |
| what is relevant to this task | `codegraph context "<task>"` | entry points, related symbols |
| who calls X | `codegraph callers X` | caller list |
| what breaks if I change X | `codegraph impact X` | affected symbols |
| does X already exist | `codegraph query X` | symbol hits |
| which test files cover this change | `codegraph affected <files>` | test file list |
| is the graph there and fresh | `codegraph status` | index stats |

The CLI reads the index as of the last sync: before deleting, renaming or calling something unused, the agent runs
`codegraph sync` and confirms an empty result with grep. codegraph does not see string or dynamic references, config
or fixtures; grep still does. Known limit of codegraph 1.6.2 on Windows: its file watcher fails when a project is
opened through an 8.3 short path (`C:\Users\ABCDEF~1\...`).

## Squeeze

Only output of known build, test, install and lint commands is trimmed (npm/pnpm/yarn/bun install, test and build
scripts, pytest, jest, vitest, tsc, eslint, cargo, go test, dotnet, gradle, maven, make, docker build, and the same
commands behind `npx`, `uv run`, `poetry run`, `pnpm exec`, `python -m`, test scripts such as `node test/run.mjs`, or
Windows shims such as `npm.cmd`). Listings, searches, file views, `git diff/show/log` and anything under ~4,000
characters pass untouched. Error lines keep their context. The raw output is saved under `%TEMP%\wesh-squeeze\` on
Windows or `~/.cache/wesh-squeeze/` elsewhere (private, last 50 kept, removed on uninstall); in OpenCode, which keeps
the full output itself, no second copy is written.

Limit: in Claude Code a command that exits non-zero is reported through `PostToolUseFailure`, which cannot replace
output, so failing runs reach the model untrimmed.

## Use

Just work as usual. `/wesh-level help` prints the map; `/wesh-level lite` for normal prose, `/wesh-level ultra` for
even fewer words and scope push-back, `/wesh-level off` to pause it. Say "review", "debug" or "TDD" to pull in those
skills; `/wesh-plan` for a fuzzy or large request. Long session? `/wesh-handoff`, then continue in a fresh one.

## Uninstall

```bash
node install.mjs --uninstall
```

Removes everything wesh added, the code graphs it built and the codegraph CLI if wesh installed it. Uninstalling from
one host (`--target claude` or `--target opencode`) keeps codegraph while the other host still uses it.

## Development

`npm test` in `bench/` runs the test suites; CI runs them on Linux, macOS and Windows with Node 20 and 24. The
end-to-end harnesses and benchmarks are described in [`bench/README.md`](bench/README.md).

## License

MIT, with Apache-2.0/MIT attribution for upstream material in `NOTICE`.
