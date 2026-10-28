// Claude Code SessionStart hook: start a background codegraph index for this project if it has none.
// What it prints becomes session context, so the agent knows the graph is on its way.
import { autoIndex, NOTE, TOO_BIG, TOO_SMALL } from './autoindex.mjs';

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  try {
    const e = JSON.parse(input.replace(/^﻿/, '') || '{}');
    const what = autoIndex(e.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    if (what === 'started') process.stdout.write(NOTE);
    else if (what === 'too-big') process.stdout.write(TOO_BIG);
    else if (what === 'too-small') process.stdout.write(TOO_SMALL);
  } catch { /* never block a session */ }
});
