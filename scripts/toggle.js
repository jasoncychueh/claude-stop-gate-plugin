#!/usr/bin/env node
/*
 * stop-gate — toggle, called from the /stop-gate:* commands.
 *
 *   node toggle.js <state-placeholder> <on|off|status|clean> [all]
 *
 * Default scope is the CURRENT session (CLAUDE_CODE_SESSION_ID, which Claude Code exports
 * to shell commands); `all` switches every session. Prints exactly one line, which the
 * command file tells the model to relay verbatim.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveStateDir } = require('./state');

const { dir: stateDir, source } = resolveStateDir(process.argv[2]);
const onDir = path.join(stateDir, 'on');
const action = (process.argv[3] || 'status').toLowerCase();
const scope = (process.argv[4] || '').toLowerCase();
const sid = (process.env.CLAUDE_CODE_SESSION_ID || '').trim();
const short = sid ? sid.slice(0, 8) : '?';

const exists = (p) => { try { fs.accessSync(p); return true; } catch (_) { return false; } };
const markers = () => { try { return fs.readdirSync(onDir); } catch (_) { return []; } };
// An empty on/ directory is removed so the hook's cheapest path (no directory) applies.
const pruneIfEmpty = () => { try { if (markers().length === 0) fs.rmdirSync(onDir); } catch (_) { /* ignore */ } };

function state() {
  if (exists(path.join(onDir, 'ALL'))) return 'on (all sessions)';
  if (sid && exists(path.join(onDir, sid))) return 'on (this session only)';
  return 'off';
}

function out(line, code = 0) {
  fs.writeSync(1, line + '\n');
  process.exit(code);
}

switch (action) {
  case 'on': {
    fs.mkdirSync(onDir, { recursive: true });
    if (scope === 'all') {
      fs.writeFileSync(path.join(onDir, 'ALL'), '');
      out('stop-gate is on for all sessions. Use /stop-gate:off all to turn it off.');
    }
    if (!sid) { pruneIfEmpty(); out('No session id available; nothing changed. To turn it on everywhere: /stop-gate:on all', 1); }
    fs.writeFileSync(path.join(onDir, sid), '');
    out(`stop-gate is on for this session only (${short}). Other sessions are unaffected.`);
    break;
  }
  case 'off': {
    if (scope === 'all') {
      fs.rmSync(onDir, { recursive: true, force: true });
      out('stop-gate is off for all sessions; every marker was cleared.');
    }
    if (!sid) out('No session id available; nothing changed. To turn it off everywhere: /stop-gate:off all', 1);
    fs.rmSync(path.join(onDir, sid), { force: true });
    if (exists(path.join(onDir, 'ALL'))) {
      out("This session's marker was removed, but stop-gate is still on for all sessions, so it will keep gating. To turn it off everywhere: /stop-gate:off all");
    }
    pruneIfEmpty();
    out(`stop-gate is off for this session (${short}). Other sessions are unaffected.`);
    break;
  }
  case 'clean': {
    // Drop per-session markers whose transcript no longer exists anywhere under ~/.claude/projects.
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    let projects = [];
    try { projects = fs.readdirSync(projectsDir); } catch (_) { /* none */ }
    let removed = 0;
    for (const m of markers()) {
      if (m === 'ALL') continue;
      const alive = projects.some((p) => exists(path.join(projectsDir, p, `${m}.jsonl`)));
      if (!alive) { fs.rmSync(path.join(onDir, m), { force: true }); removed++; }
    }
    pruneIfEmpty();
    out(`Removed ${removed} marker(s) left by ended sessions. Current state: ${state()}`);
    break;
  }
  case 'status':
  case '': {
    const list = markers().map((m) => (m === 'ALL' ? 'ALL' : m.slice(0, 8))).join(' ');
    out(`stop-gate: ${state()} | session ${short} | markers: ${list || 'none'} | state dir (${source}): ${stateDir}`);
    break;
  }
  default:
    out('Usage: /stop-gate:on | /stop-gate:off | /stop-gate:status | /stop-gate:clean (on/off accept "all")', 1);
}
