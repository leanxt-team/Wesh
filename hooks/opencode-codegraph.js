// OpenCode plugin (installed to <opencode>/plugins/): build, sync or repair the code graph of every project a session
// opens. The work runs in a detached Node process, so OpenCode never waits. One default export for both plugin APIs:
// OpenCode 2 runs `setup`, OpenCode 1 calls `server`.
import { autoIndexDetached } from '../wesh/autoindex.mjs';

const start = dir => { try { autoIndexDetached(dir || process.cwd()); } catch { /* never block OpenCode */ } };

// Every session may open another project (OpenCode 2 runs one shared service), and each needs its own index.
const event = async ({ event: e }) => {
  if (e?.type !== 'session.created') return;
  const info = e.properties?.info || e.properties || {};
  start(info.directory || info.worktree || e.properties?.directory);
};

export default {
  id: 'wesh-codegraph',
  async setup(ctx) {
    start(ctx?.location?.directory);
    return { event };
  },
  server: async (input) => { start(input?.directory); return { event }; },
};
