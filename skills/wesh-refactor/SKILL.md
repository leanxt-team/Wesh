---
name: wesh-refactor
description: Restructure code or migrate schema, data, API, config or dependencies with behavior proven before and after, and a rollback.
---

## Refactor
1. Fix the boundary: what behavior must stay identical (public interfaces, errors, ordering, compatibility).
2. Establish proof first: run the existing tests that cover it; if none cover it, add one characterization test at the seam. Record the command.
3. Move one ownership boundary at a time. Keep every intermediate state building and passing.
4. No feature changes, no new dependencies or config inside a refactor. Moved code keeps its validation and error handling. Before renaming or deleting, find all callers: `codegraph sync` first (the CLI reads the last synced index), then `codegraph impact <sym>` when the project has an index (else grep), plus grep for fixtures, config and string/dynamic references either way. An empty result is never proof: confirm with grep before deleting. Tests that cover the moved code: `codegraph affected <changed files>`.
5. Re-run the same proof. Stop when it matches and the requested structure exists.

## Migration
1. Map readers, writers, data shape, rollout overlap and ownership before editing.
2. Write the forward path and the rollback path. Destructive steps (drop, delete, rewrite in place) are explicit, separate, and need the user's go-ahead.
3. Sequence expand → migrate → verify → contract. Mixed versions must work during overlap.
4. Make retries idempotent and partial failure visible.
5. Verify old and new paths at each stage. Stop after the requested stage; never run the contract step implicitly.

Report: what moved, proof command and result before/after, rollback, remaining risk. Three to six lines.
