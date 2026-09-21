#!/usr/bin/env node
/*
 * stop-gate — Stop hook.
 *
 * When the main agent is about to hand control back, block ONCE and inject a short
 * self-check prompt, so "done" is a checked claim rather than a reflex. The hook itself
 * calls no model: it only emits {"decision":"block","reason":...}; the reflection
 * happens in the agent's own turn, with its full context.
 *
 * Opt-in per session. Nothing happens unless the session (or ALL) has a marker under
 * <state>/on/ — toggled by the /stop-gate:on and /stop-gate:off commands.
 *
 * Decision order (cheapest first, any pass exits silently):
 *   1. no marker for this session            -> pass (checked before stdin is parsed)
 *   2. stop_hook_active                       -> pass (already blocked once this turn)
 *   3. background_tasks / session_crons       -> pass (paused waiting to be woken, not done)
 *   4. last message ends with a question mark -> block with the QUESTION prompt
 *   5. no tool_use since the last human turn  -> pass (pure chat)
 *   6. otherwise                              -> block with the FINISH prompt
 *
 * FAIL-OPEN: any unreadable or odd input exits 0 with no output — a broken gate must
 * never wedge a session. Claude Code also caps consecutive Stop blocks on its own.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveStateDir } = require('../scripts/state');

const FINISH_PROMPT = [
  "[stop-hook] Before you stop, check your own work — don't stop on reflex.",
  'Ask yourself:',
  '1. Is every part of what the user asked for actually done, or only the easy part?',
  '2. Did you change code without building it or running the tests? Are the tests green now?',
  '3. Did you say "next I\'ll do X" and then not do X?',
  '4. Did you leave a worktree, a running process, or temp files behind?',
  "5. Are you waiting on the user to decide, or to verify something themselves? If so, stopping is right — don't make that call for them.",
  "When done: if there is no gap, just stop — no need to report this check. If there is a gap, close it, then stop.",
  'This text was injected by a hook; it is not from the user.',
].join('\n');

const QUESTION_PROMPT = [
  "[stop-hook] You're about to hand a question back to the user. First make sure it's really worth asking.",
  'Ask yourself:',
  '1. Could you find the answer yourself? If reading the code, checking a setting, or running one command would tell you, do that first.',
  "2. Have you thought the options through? With no recommendation and no trade-offs stated, you're not done thinking — don't hand it over yet.",
  "3. Would different answers actually lead to different work? If not, pick one, say why in one sentence, and keep going.",
  "4. Is everything that doesn't depend on the answer already done? If not, do that first, then ask once, clearly.",
  'If it really needs asking (their decision to make, something only they can verify, or costly to get wrong) → ask it directly, no need to report this check.',
  'If not → find out or decide yourself, and keep going.',
  'This text was injected by a hook; it is not from the user.',
].join('\n');

function pass() { process.exit(0); }

// fs.writeSync, not process.stdout.write: stdout to a pipe can be asynchronous, and the
// process.exit right after it could cut the JSON short.
function block(reason) {
  fs.writeSync(1, JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Only look at the final character, after peeling trailing whitespace, markdown emphasis
// and closing brackets/quotes. A question mark in the middle of the text, or inside a
// code sample, is not the agent asking the user something.
function endsWithQuestion(text) {
  const tail = String(text || '').replace(/\r/g, '').slice(-200)
    .replace(/[\s*`_\]」』）)】》”’"']+$/u, '');
  return /[？?]$/u.test(tail);
}

// Walk the transcript backwards from the end until the last human message (a `user`
// entry whose content is a plain string — tool results arrive as `user` entries with
// array content). Count tool_use blocks in the assistant entries passed on the way.
// Unknown shape -> true, so the gate errs toward checking rather than skipping.
function turnUsedTools(transcriptPath) {
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return true; }
  const lines = text.split('\n');
  let toolUses = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }
    const content = entry && entry.message && entry.message.content;
    if (entry.type === 'user' && typeof content === 'string') return toolUses > 0;
    if (entry.type === 'assistant' && Array.isArray(content)) {
      toolUses += content.filter((b) => b && b.type === 'tool_use').length;
    }
  }
  return true;
}

try {
  const { dir: stateDir } = resolveStateDir(process.argv[2]);
  const onDir = path.join(stateDir, 'on');

  // 1. Cheapest check first: nobody opted in -> exit without even parsing stdin.
  let markers;
  try { markers = fs.readdirSync(onDir); } catch (_) { pass(); }
  if (markers.length === 0) pass();

  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { pass(); }
  if (!input || typeof input !== 'object') pass();

  const sidFull = typeof input.session_id === 'string' ? input.session_id : '';
  if (!markers.includes('ALL') && !(sidFull && markers.includes(sidFull))) pass();

  const sid = (sidFull || '?').slice(0, 8);
  const logFile = path.join(stateDir, 'stop-gate.log');
  const log = (msg) => { try { fs.appendFileSync(logFile, `${timestamp()} ${msg}\n`); } catch (_) { /* logging never blocks */ } };
  log(`invoked sid=${sid} cwd=${input.cwd || '?'}`);

  // 2. Already blocked once in this turn -> let it stop. At most one block per user message.
  if (input.stop_hook_active === true) { log(`  skip: stop_hook_active sid=${sid}`); pass(); }

  // 3. Background work in flight (subagent, background shell, monitor, workflow) or a
  //    scheduled wake-up (/loop, ScheduleWakeup): the session is paused, not done. The
  //    real check happens at the final stop, after the background work has reported.
  const bg = Array.isArray(input.background_tasks) ? input.background_tasks : [];
  const crons = Array.isArray(input.session_crons) ? input.session_crons : [];
  if (bg.length > 0 || crons.length > 0) {
    const kinds = bg.map((t) => `${t && t.type}/${t && t.status}`).join(',');
    log(`  skip: ${bg.length} background task(s) [${kinds}], ${crons.length} cron(s) sid=${sid}`);
    pass();
  }
  log(`  background: none (field ${'background_tasks' in input ? 'present' : 'absent'}) sid=${sid}`);

  // 4. Handing a question back also gets checked: is it really a question worth asking?
  if (endsWithQuestion(input.last_assistant_message)) {
    log(`  block: question-check sid=${sid}`);
    block(QUESTION_PROMPT);
  }

  // 5. Pure chat turn (no tool touched since the last human message) -> not worth gating.
  if (typeof input.transcript_path === 'string' && input.transcript_path
      && !turnUsedTools(input.transcript_path)) {
    log(`  skip: no tool_use this turn sid=${sid}`);
    pass();
  }

  // 6. Real stop after real work.
  log(`  block: finish-check sid=${sid}`);
  block(FINISH_PROMPT);
} catch (_) {
  pass();
}
