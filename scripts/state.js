'use strict';
/*
 * stop-gate — shared state-directory resolution.
 *
 * The hook and the toggle commands MUST agree on one directory, or a session that
 * opts in through a command would never be seen by the hook. Both call this helper
 * with whatever the caller received as argv (the hook gets "${CLAUDE_PLUGIN_DATA}"
 * from hooks.json; the commands pass the same placeholder, which may or may not be
 * substituted in a command's `!` line). Resolution order:
 *
 *   1. an argv value that is non-empty and not an unexpanded "${...}" placeholder
 *   2. the CLAUDE_PLUGIN_DATA environment variable
 *   3. ~/.claude/stop-gate  (fixed fallback, survives plugin updates)
 *
 * `status` prints which source won, so a mismatch between hook and command is visible.
 *
 * Layout under the state dir:
 *   on/ALL            -> gate enabled for every session
 *   on/<session_id>   -> gate enabled for that session only
 *   stop-gate.log     -> one line per decision, only for sessions that opted in
 */
const path = require('path');
const os = require('os');

function resolveStateDir(arg) {
  const fromArg = typeof arg === 'string' && arg.trim() !== '' && !arg.includes('${') ? arg.trim() : '';
  if (fromArg) return { dir: fromArg, source: 'argv' };
  const fromEnv = (process.env.CLAUDE_PLUGIN_DATA || '').trim();
  if (fromEnv) return { dir: fromEnv, source: 'env' };
  return { dir: path.join(os.homedir(), '.claude', 'stop-gate'), source: 'fallback' };
}

module.exports = { resolveStateDir };
