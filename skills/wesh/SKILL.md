---
name: wesh
description: Switch wesh level for this session (lite, full, ultra, off) or show the skill map. Use for /wesh, "wesh ultra", "be lazier", "normal mode".
argument-hint: "[lite|full|ultra|off|help]"
disable-model-invocation: true
---

The wesh core rules are already loaded (Claude Code: the wesh block in `CLAUDE.md`; OpenCode: `wesh/CORE.md` via `instructions`). This command only changes the level.

- `/wesh lite|full|ultra`: follow that level from now until changed. Confirm in one line: `wesh: <level>`.
- `/wesh off` or "normal mode": stop the voice and lean-code rules; keep the safety rules. Confirm in one line.
- `/wesh` alone: reply with the current level.
- `/wesh help`: print this map, nothing else:

```
wesh levels   lite = clear prose · full = caveman (default) · ultra = fewer words + push back on scope
auto skills    wesh-plan     fuzzy/large request → frontier questions → spec
               wesh-debug    bug, failure, regression → feedback loop first
               wesh-tdd      test-first, red → green at agreed seams
               wesh-refactor restructure or migration, behavior preserved
               wesh-review   diff/PR/repo review, numbered findings
               wesh-commit   Conventional Commit message
user only      /wesh-handoff /wesh-compress /wesh-debt
subagent       wesh-scout    cheap read-only locator, path:line output
automatic      code graph    built on first use, synced at every session start; codegraph_explore for cross-file questions, codegraph CLI callers/impact/affected for cheap facts
               squeeze       long build/test/install output trimmed to what matters (raw: WESH_RAW=1 <cmd>; PowerShell: $env:WESH_RAW=1; <cmd>)
```

Levels persist only in this conversation, and a compaction drops them: run `/wesh` again after one. For a different default in new sessions, re-run the installer with `--level <level>` (editing the `Level:` line in the wesh block of `~/.claude/CLAUDE.md` or `~/.config/opencode/wesh/CORE.md` also works; later installs keep it).
