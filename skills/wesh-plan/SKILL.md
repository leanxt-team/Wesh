---
name: wesh-plan
description: Turn a fuzzy or large request into agreed decisions and a short spec before coding. Use for /wesh-plan.
disable-model-invocation: true
---

Goal: shared understanding in the fewest rounds, then a spec an agent can build from. Building the wrong thing is the most expensive token spend.

## 1. Facts first, yourself
Explore the repo for what exists: entry points, owning modules, reusable helpers, test seams, `GLOSSARY.md` and ADRs if present. Never ask the user for a fact you can look up. Broad searches: `codegraph_explore` when it is available or `codegraph status` reports an index, else delegate to `wesh-scout`. Task-shaped orientation: `codegraph context "<task>"` and `codegraph files` (structure) before a broad explore. Reuse check: `codegraph_explore "<name>"` — it reports unsynced files; the CLI reads the last synced index, so `codegraph sync` first when no code graph server is running. Before writing a new helper, confirm with grep that it does not exist.

## 2. Ask the frontier in rounds
Map the decisions as a tree. The frontier is every decision whose prerequisites are settled. Ask the whole frontier in one round, numbered, each with your recommended answer, worded so "yes" accepts it:

```
Q1 - <title>: <question, options if any>
→ <recommended answer>
```

Wait for answers. Recompute the frontier. A question depending on another open question waits for a later round. Stop when the frontier is empty. Usually 1-3 rounds. Skip this step entirely when nothing material is open.

Apply wesh scope rules while asking: propose the smallest version that does the core job; list cut options as explicit non-goals.

## 3. Write the spec
Give it in the reply. Save it to a file only where the repo already keeps specs, or publish it to the issue tracker, when the user wants that. Keep it under ~60 lines:

```
# <feature>
Problem: <user's view, 1-3 lines>
Solution: <user's view, 1-3 lines>
Acceptance (observable, numbered): 1. ... 
Decisions: modules touched, interfaces, schema/API changes (no file paths, no code unless a prototype fixed a shape)
Test seams: the highest existing public interface(s) to test at; fewest seams possible
Non-goals: <cut scope>
Slices: ordered vertical slices, each shippable and testable, with blockers noted
```

Do not start implementing until the user confirms the spec, unless they asked you to go straight on.
