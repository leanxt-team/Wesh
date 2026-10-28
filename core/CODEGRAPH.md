## Code graph (codegraph)
- wesh builds, syncs `.codegraph/`. Never run `codegraph init`. No graph yet: grep/Read.
- Cross-file question (how X works, who calls Y, what breaks if Z changes): one `codegraph_explore` first, treat output as read. Known file or symbol: Read.
- Outside session start dir (git worktree, other checkout): pass `projectPath=<that root>`.
- Cheap facts: `codegraph callers|impact <symbol>`, `codegraph affected <files>`. CLI reads last sync: before delete, rename, "unused": `codegraph sync`, confirm empty result with grep.
