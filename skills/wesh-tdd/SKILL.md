---
name: wesh-tdd
description: Test-first development in red-to-green slices at public seams. Use only when the user asks for TDD, "red-green" or "test first".
---

## Seams
A seam is the public interface where behavior is observable. Tests live only at seams, never on internals. Prefer existing seams and the highest one that reaches the logic; fewest seams wins. State the seams in one line each (what it catches, what it misses). Ask the user to confirm only when the choice is not obvious from the spec or nearby tests. Which tests already cover the code: `codegraph affected <source file>`; an interface with no callers and no test is not a seam yet.

## Loop (one slice per cycle)
1. Red: one failing test for one behavior. Run it; see it fail for the right reason.
2. Green: the least code that passes. No anticipated features.
3. Next slice. Each test is a tracer bullet informed by the last cycle.
Run the single test file each cycle; the full suite once at the end. Refactoring belongs to review, not the loop.

## A good test
- Reads like a spec ("checkout rejects expired card"), survives refactors.
- Expected values come from an independent source (literal, worked example, spec), never recomputed like the code (`expect(add(a,b)).toBe(a+b)` is tautological).
- Mock only system boundaries: external APIs, time, randomness, sometimes DB/FS. Never mock your own modules. Prefer a test DB to a DB mock.
- Pass boundary clients in (dependency injection); prefer one function per external operation over a generic `fetch(endpoint)` mock.

## Anti-patterns
Implementation-coupled tests (break on refactor), tautological assertions, horizontal slicing (all tests first, then all code), coverage padding. One good test per risky behavior beats many shallow ones.

Use the project's glossary vocabulary in test names when a `GLOSSARY.md` exists.
