---
name: wesh-commit
description: Write a terse Conventional Commits message from the staged or given diff. Use for "commit message", "write a commit".
---

Read `git diff --staged` (else the diff given). Match the repo's existing commit style from `git log --oneline -10`.

Subject: `<type>(<scope>)!: <imperative summary>`; scope optional; `!` only for breaking. Types: feat fix refactor perf docs test chore build ci style revert. Imperative ("add", not "added"). ≤50 chars when possible, hard cap 72. No trailing period.

Body only for a non-obvious why, breaking change, migration note, security fix, data migration or revert; always include it for those. Wrap at 72. `-` bullets. Issue refs last: `Closes #42`. For bug fixes, state the confirmed cause in one line.

Never: "This commit", "I/we", restating the file list, emoji (unless the repo uses them), AI attribution (unless the user's own rules require a trailer).

Output the message in one code block, ready to paste. Do not stage, commit or amend unless asked.
