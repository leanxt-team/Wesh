// Claude Code PostToolUse hook (Bash|PowerShell): replaces long command output with its squeezed form.
// A replacement that does not match the tool's output shape is ignored by Claude Code, so failure is safe.
import { squeeze } from './squeeze.mjs';

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(input.replace(/^﻿/, '')); // Windows pipes may prepend a BOM
    const r = e.tool_response;
    if (!r || typeof r !== 'object' || r.isImage) return;
    const updated = { ...r };
    let changed = false;
    for (const k of ['stdout', 'stderr', 'output']) {
      if (typeof r[k] !== 'string') continue;
      const s = squeeze(r[k], { command: e.tool_input?.command || '', id: `${e.tool_use_id || ''}-${k}` });
      if (s.changed) { updated[k] = s.text; changed = true; }
    }
    if (changed) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: updated } }));
  } catch { /* never block a tool result */ }
});
