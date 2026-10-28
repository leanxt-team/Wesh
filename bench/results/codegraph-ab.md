# codegraph A/B: 4 cross-file questions, real agents (2026-10-27)

Opus 5.5 subagents in Claude Code, one run per arm. Repos: codegraph's own source (TypeScript, ~1,200 source files)
and caveman (JS/TS/Python/Go, ~1,200 source files), both indexed with codegraph 1.6.2 (90 s and 39 s, telemetry off).
Arm A: Glob/Grep/Read only. Arm B: `codegraph explore` first (CLI, same output as the MCP tool), Read only for gaps.
All 8 answers were correct; arm A was sometimes a little more complete (extra call sites).

| question | A: final context / tool calls / time | B: final context / tool calls / time |
|---|--:|--:|
| Q1 OpenCode MCP entry (mostly one file) | 71.1k / 3 / 20 s | 73.8k / 3 / 26 s |
| Q2 staleness banner (cross-file flow) | 82.5k / 10 / 35 s | 74.3k / 3 / 27 s |
| Q3 skill install for a provider (cross-file) | 90.5k / 15 / 47 s | 84.0k / 3 / 32 s |
| Q4 agent frontmatter transform (one file + callers) | 73.3k / 7 / 27 s | 77.5k / 5 / 35 s |
| **total** | **317k / 35 / 129 s** | **310k / 14 / 120 s** |

Final context is nearly the same (-2.4%), but every tool call is one more model request that re-reads the whole
context. Billed per request (Opus 5.5, prompt caching, ~62k starting context), arm B costs about **40% less** per
question (~$1.03 vs ~$0.61 for the four), close to codegraph's published "44% cheaper". Broad questions win big;
a question about one known file can cost slightly more with codegraph (each call returns ~6k tokens of source).
wesh's rule follows this: `codegraph_explore` for cross-file questions, plain Read for a file you already know.
