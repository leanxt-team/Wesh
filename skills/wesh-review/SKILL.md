---
name: wesh-review
description: Review a diff, PR, files or repo for bugs, security, scale, missing tests and removable code, as numbered findings. Use for "review", "audit".
argument-hint: "[target] [--terse|--explain] [--spec <path>]"
---

Review like the senior dev who gets paged when it breaks. Priority: correct, safe, holds under load, tested, fast, lean. Lists findings; changes no code.

## 1. Target
Named target: uncommitted/staged changes, a branch or ref (`git diff <ref>...HEAD`), a PR, files, a folder, or `repo`. Nothing named: uncommitted changes, else the last commit. Bad ref or empty diff: say so and stop.
Spec: the `--spec` path, issue refs in commit messages, or a matching file under `docs/`/`specs/`. None found: skip the spec axis.

## 2. Read what the change touches
Diff, then callers of every changed function, functions it calls, tests, README. Signature or behavior changed: find every caller (`codegraph callers <fn>` per changed function when the project has an index, else grep; plus grep for string or dynamic references). The CLI reads the last synced index: run `codegraph sync` first when the answer decides a delete, a rename or "unused". Find the expected load (README, deploy config) and state it.
Repo audit: read README, build/deploy config, dependencies, entry points, tests; trace main flows end to end; go deep where mistakes cost most; name what you did not read. Large repo: orient with `codegraph_explore` when it is available, else 2-3 `wesh-scout` calls in parallel.

## 3. Look for
1. Bug: wrong result, crash, edge cases (empty, zero, last item, rounding, time zones), a broken caller, a fix in one caller while shared code stays broken.
2. Risk: injection, weak randomness, secrets, unchecked user input, swallowed errors, writes in wrong order, missing transaction.
3. Scale: check-then-write races, query per item, O(n²) on big input, unbounded growth, per-process state that must be shared.
4. Missing test: risky logic (branch, parser, money, security, data writes, bug fix) with no test that fails when it breaks. Which test files cover the change: `git diff --name-only | codegraph affected --stdin`; none covering it is the finding.
5. Speed: big slowdowns are problems; hot-loop micro-wins are suggestions.
6. Lean: dead code, unused options, speculative generality, single-implementation interfaces, pass-through wrappers, a helper that already exists (name its path), stdlib/platform does it, near-copies to merge, a function mixing unrelated jobs (split by job, never by line count).
7. Spec (when a spec exists): requirements missing or partial, behavior nobody asked for, requirements implemented wrong. Quote the spec line. Keep spec findings in their own group; do not rerank them against code findings.
8. Repo standards: violations of documented rules (`CONTRIBUTING.md`, `CODING_STANDARDS.md`, lint configs not enforced by tooling). A documented rule overrides these defaults.

## 4. Verify before reporting
Every finding needs a concrete case: this input or situation gives this wrong result. No case, no finding. Re-read the lines; confirm the caller exists, the value can be empty, the code is unused (`codegraph sync` first, then `codegraph callers <sym>` empty, then grep the whole tree, including tests, config, dynamic references). A `shortcut:` comment that names its limit is a decision, not a finding, unless the expected load already crosses it. Smallest fix; prefer fixes that delete code. No taste, no "consider", no vague worries.

## 5. Output
Default `--terse` for diffs, one line per finding, numbered across groups:
```
What this change does: <1-2 sentences>. Load assumed: <...>.
Must fix
1. path:L42 bug: user can be null after find(). Guard before .email.
Should fix
2. path:L88-140 lean: 50-line fn does 4 jobs. Extract validate/persist.
Nice to have
3. ...
Spec: <findings or "no spec">
Verdict: ship | fix 1, 3 first. Lean: -N lines possible. Not checked: <...>
```
`--explain` (default for `repo` audits, security findings, or a newcomer audience): each finding gets four short parts: **What this is**, **Problem**, **Fix**, **If we skip it**, in plain English, explaining terms on first use. Audit: at most 20 findings; say how many smaller ones you left out; add `-M dependencies possible` when relevant.
Nothing found: `What this change does: ...` then `Looks good. Ship.` and one line on what you checked.
