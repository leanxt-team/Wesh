---
name: wesh-handoff
description: Compress the current session into a handoff file so a fresh, cheap session can continue. Use for /wesh-handoff when context is long or the topic changes.
argument-hint: "[what the next session will do]"
disable-model-invocation: true
---

Long sessions re-bill the whole history on every turn. A fresh session that reads a 300-token handoff is far cheaper than turn 80 of this one.

Write `wesh-handoff-<yyyymmdd-hhmm>.md` (mode 600) to a private folder: `$WESH_CACHE_DIR`, else `~/.cache/wesh` (mode 700), else the OS temp dir (`$TMPDIR`, else `/tmp`; `%TEMP%` on Windows). Not the repo. Under ~40 lines:

```
Goal: <one line; tailored to the argument if given>
State: done / in progress / not started (bullets)
Decisions: settled choices and why (one line each)
Pointers: files with line ranges, branch, commits, specs, issues, PRs (reference, never paste)
Proof: commands that pass/fail now
Next: ordered steps
Risks/unknowns:
Skills: which wesh skills to load first
```

Never duplicate content that already lives in a spec, issue, commit or diff: point to it. Redact secrets and personal data. Reply with the file path and the one-line command to start the next session with it.
