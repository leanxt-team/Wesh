---
name: wesh-debug
description: Debug hard bugs, flaky tests and performance regressions with a reproduce-first loop. Use when the cause is unclear, a first fix failed, or the user says "debug".
---

No loop, no fix. Guessing at causes burns turns.

**Redact** secrets in every command and output you show (`<REDACTED>`); read credentials from env vars.

## 1. Build a red-capable loop
One command you have already run that drives the real bug path and asserts the user's exact symptom. Pick the first that works: failing test at the seam that reaches the bug · curl/HTTP script against a dev server · CLI run diffed against a known-good output · headless browser script · replayed captured payload · throwaway harness calling the code path · property/fuzz loop · bisection script (`git bisect run`) · differential run old vs new.
Tighten it: seconds not minutes, deterministic (pin time, seed RNG, isolate FS/network), assert the symptom not "didn't crash". Flaky bug: raise the reproduction rate (loop 100x, parallelise, add stress) until debuggable.
Cannot build one? Stop. Say what you tried and ask for an environment, a redacted artifact (log, HAR, dump) or permission to instrument.

## 2. Reproduce, then minimise
Confirm it fails with the user's symptom, not a nearby one. Cut inputs, config and steps one at a time while it stays red.

## 3. Hypothesise, ranked
3-5 falsifiable hypotheses: "If X is the cause, changing Y makes it pass." Show the ranked list in one compact block; continue without waiting if the user is away.

## 4. Probe one variable at a time
Debugger or targeted logs at the boundaries that split hypotheses. Tag every debug log `[DBG-<4 hex>]`. Performance: measure a baseline first, then bisect; no guessing from logs.

## 5. Fix at the owning layer
Find every caller of the code you change (`codegraph sync` first, then `codegraph impact <sym>` / `codegraph callers <sym>` when the project has an index; `codegraph_explore` for the shape of the flow; else grep); fix the root cause once in the shared code, narrowest layer that owns the wrong behavior. No cleanup or renames outside the fix.
Regression test before the fix, only at a seam that reproduces the real call pattern. No correct seam? Say so: that is an architecture finding.
Watch the test go red, apply the fix, watch it go green, re-run the original loop.

## 6. Clean up and report
Remove `[DBG-` logs (grep the tag) and throwaway harnesses. Report in 3-5 lines: cause, proof (command + result), fix location, regression test, what is unverified. Put the confirmed cause in the commit message.
Diagnosis-only request: report cause and proof, change no product code.
