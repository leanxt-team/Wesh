// OpenCode plugin (installed to <opencode>/plugins/): squeezes long shell output before the model sees it.
// One default export for both plugin APIs: OpenCode 2 runs `setup`, OpenCode 1 calls `server`.
// Nothing else is exported: OpenCode 1 would treat any exported function as a plugin.
import fs from 'node:fs';
import { squeeze } from '../wesh/squeeze.mjs';

const SHELL = new Set(['bash', 'shell']);

// OpenCode truncates long output and saves the whole thing; the preview it hands us says where.
// v2: "[showing lines 1-100 of 4000; full output saved to /path]"; v1: "Full output saved to: /path".
const SAVED = /\[showing lines \d+-\d+ of \d+; full output saved to ([^\]]+)\]|Full output saved to: (.+)/;

// The file holding the complete output, if the preview names one and it is readable.
function fullOutputPath(text) {
  const m = SAVED.exec(text);
  if (!m) return '';
  const file = (m[1] || m[2] || '').trim();
  if (!file) return '';
  try { return fs.statSync(file).isFile() ? file : ''; } catch { return ''; }
}

// OpenCode's preview shows only the first lines, so a squeeze of the full output (failures further down, the summary)
// may be a little longer and still worth more. Many times longer is not: then the preview stays.
const worthIt = (r, shown) => r.changed && r.text.length <= Math.max(2 * shown.length, 8000);

// OpenCode 1: hooks object.
const server = async () => {
  const commands = new Map(); // callID -> command, in case the after-hook gets no args
  return {
    'tool.execute.before': async (input, output) => {
      if (SHELL.has(input.tool) && output?.args?.command) commands.set(input.callID, output.args.command);
    },
    'tool.execute.after': async (input, output) => {
      const command = input.args?.command ?? commands.get(input.callID) ?? '';
      commands.delete(input.callID);
      if (!SHELL.has(input.tool) || typeof output?.output !== 'string') return;
      try {
        // The preview is already truncated: squeeze the file it points at, so early failures survive.
        const full = fullOutputPath(output.output);
        let raw = output.output;
        if (full) { try { raw = fs.readFileSync(full, 'utf8'); } catch { raw = output.output; } }
        const r = squeeze(raw, { command, id: input.callID, fullPath: full });
        if (worthIt(r, output.output)) output.output = r.text;
      } catch { /* never break a tool result */ }
    },
  };
};

// OpenCode 2: the tool result's `content` is what the model reads.
function squeezeResult(event) {
  if (event?.status !== 'completed' || !SHELL.has(event.tool) || !event.result) return;
  const { content } = event.result;
  const text = typeof content === 'string' ? content
    : Array.isArray(content) && content.length && content.every(c => c?.type === 'text') ? content.map(c => c.text).join('') : null;
  if (text === null) return;
  // The preview is already truncated: squeeze the file it points at, so early failures survive.
  const full = fullOutputPath(text);
  let raw = text;
  if (full) { try { raw = fs.readFileSync(full, 'utf8'); } catch { raw = text; } }
  const r = squeeze(raw, { command: event.input?.command ?? '', id: String(event.id ?? ''), fullPath: full });
  if (worthIt(r, text)) event.result = { ...event.result, content: typeof content === 'string' ? r.text : [{ type: 'text', text: r.text }] };
}

export default {
  id: 'wesh-squeeze',
  // OpenCode 2. OpenCode 1's V2 preview also calls setup but has no tool hooks: then `server` does the work.
  async setup(ctx) {
    if (!ctx?.tool?.hook) return;
    await ctx.tool.hook('execute.after', event => { try { squeezeResult(event); } catch { /* never break a tool result */ } });
  },
  server,
};
