---
name: wesh-compress
description: Rewrite a memory or instruction file (CLAUDE.md, AGENTS.md, rules, notes) to fewer tokens with every fact kept. Use for /wesh-compress <file>.
argument-hint: "<file>"
disable-model-invocation: true
---

These files load on every turn of every session, so each removed token saves repeatedly.

1. Refuse files that are code, config, lockfiles or data (`.json .yaml .toml .lock .env` and source files). Prose and Markdown only.
   Never edit text between `<!-- wesh:begin` and `<!-- wesh:end -->`, markers included: the wesh installer manages it.
2. Copy the original to `<name>.original.md` next to it (skip if it exists; never overwrite a backup).
3. Rewrite in place:
   - Keep verbatim: code blocks, inline code, commands, paths, URLs, version numbers, names, numbers, units, headings that other files link to, and every not/never/no/only/must/except.
   - Cut: greetings, motivation paragraphs, repeated rules, hedges, filler words, examples that restate a rule already clear.
   - Prefer short imperative lines and lists; merge duplicates; drop articles where the line still reads in one pass.
   - Rules the model already follows by default (e.g. "write clean code", "be helpful") get deleted.
4. Validate: every code span, path, URL and number in the original still appears in the new file; heading count of linked headings unchanged; no negation lost. Fix any miss.
5. Report: `<file>: <old> → <new> words (-N%)`, plus anything you deliberately dropped as redundant. Tell the user the backup path.
