---
name: wesh-debt
description: List every `shortcut:` comment (deferred limits) as a debt ledger. Use for /wesh-debt.
argument-hint: "[marker word]"
disable-model-invocation: true
---

Scan tracked files, skipping ignored paths:
`git grep -nE '(#|//|/\*|<!--|;|--|REM|%) ?(shortcut|ponytail):'` (outside git: the Grep tool with the same pattern, skipping `.git node_modules dist build .venv`). A user-given marker word (e.g. `TODO`) replaces `shortcut`.

One row per hit, grouped by file:
`<file>:<line> <what was simplified>. ceiling: <limit>. upgrade: <trigger>.`
Tag `no-trigger` when the comment names no upgrade condition: those rot silently. Skip hits that are not deferrals.

End: `<N> markers, <M> no-trigger.` Nothing found: `No shortcut debt.`
Read-only. Write the ledger to `WESH-DEBT.md` only if asked.
