# stop-gate

A Claude Code plugin that puts a **self-check gate at the moment the agent tries to stop**.

Agents stop too early. The tests are still red, only the easy half is done, or the last message says "next I'll do X" and X never happens. Nothing catches that moment. stop-gate does: a Stop hook blocks once and hands the agent a short checklist to run against its own work before control comes back to you.

## How it works

One Stop hook and four commands. It is opt-in per session.

When the main agent is about to stop, the hook blocks **once** and injects one of two prompts. The agent reads the prompt as its next instruction, checks its work, then either closes the gap or stops.

The hook **calls no model**. It only prints `{"decision":"block","reason":...}`. The reflection happens in the agent's own turn, with its full context and its prompt cache.

### What the agent sees

**Finish check.** Used on a normal stop after real work:

```text
[stop-hook] Before you stop, check your own work — don't stop on reflex.
Ask yourself:
1. Is every part of what the user asked for actually done, or only the easy part?
2. Did you change code without building it or running the tests? Are the tests green now?
3. Did you say "next I'll do X" and then not do X?
4. Did you leave a worktree, a running process, or temp files behind?
5. Are you waiting on the user to decide, or to verify something themselves? If so, stopping is right — don't make that call for them.
When done: if there is no gap, just stop — no need to report this check. If there is a gap, close it, then stop.
This text was injected by a hook; it is not from the user.
```

**Question check.** Used when the last message ends with a question:

```text
[stop-hook] You're about to hand a question back to the user. First make sure it's really worth asking.
Ask yourself:
1. Could you find the answer yourself? If reading the code, checking a setting, or running one command would tell you, do that first.
2. Have you thought the options through? With no recommendation and no trade-offs stated, you're not done thinking — don't hand it over yet.
3. Would different answers actually lead to different work? If not, pick one, say why in one sentence, and keep going.
4. Is everything that doesn't depend on the answer already done? If not, do that first, then ask once, clearly.
If it really needs asking (their decision to make, something only they can verify, or costly to get wrong) → ask it directly, no need to report this check.
If not → find out or decide yourself, and keep going.
This text was injected by a hook; it is not from the user.
```

"Ends with a question" means the **last character** is `?` or `？`, after trailing whitespace, markdown emphasis and closing brackets or quotes are stripped. A question mark in the middle of a sentence or inside a code sample does not count.

### When it stays out of the way

The hook checks these in order, cheapest first. Any match lets the stop through without a word:

1. **Not opted in.** No marker for this session. This is checked before the hook even reads its input.
2. **Already blocked this turn.** `stop_hook_active` is set. You get at most one block per message you send; the flag resets on your next message.
3. **Background work in flight.** `background_tasks` (subagents, background shells, monitors, workflows) or `session_crons` (`/loop`, `ScheduleWakeup`) is non-empty. The session is paused and waiting to be woken, not done. The check runs at the final stop, after the background work has reported back.
4. **Pure chat.** No tool was used since your last message.

## Commands

| Command | Effect |
|---|---|
| `/stop-gate:on` | Turn on for **this session** only |
| `/stop-gate:on all` | Turn on for every session |
| `/stop-gate:off` | Turn off for this session |
| `/stop-gate:off all` | Turn off everywhere and clear every marker |
| `/stop-gate:status` | Show the state, the markers and the state directory in use |
| `/stop-gate:clean` | Remove markers left by sessions whose transcript is gone |

It is **off everywhere** by default. The hook is registered once for all projects; whether it acts is decided per session, by a marker file named after the session id (`CLAUDE_CODE_SESSION_ID`, which Claude Code exports to shell commands).

## Install

This repo doubles as its own single-plugin marketplace (via `.claude-plugin/marketplace.json`).

1. **Add this repo as a marketplace:**
   ```
   /plugin marketplace add jasoncychueh/claude-stop-gate-plugin
   ```
   A local clone works too: pass its path instead.
2. **Install the plugin.** Choose the **user** scope when prompted, so it applies to every project:
   ```
   /plugin install stop-gate@claude-stop-gate-plugin
   ```
3. **Load it in the current session.** No restart needed:
   ```
   /reload-plugins
   ```

Then run `/stop-gate:on` in any session you want gated.

## Checking that it works

Run `/stop-gate:on`, give the agent a task that uses a tool, and let it finish. The agent should receive the finish check once, then stop.

Every decision for an opted-in session is written to `stop-gate.log` in the state directory (`/stop-gate:status` prints where that is):

```text
2026-09-21 11:02:17 invoked sid=35180d91 cwd=C:\repos\my-project
2026-09-21 11:02:17   skip: 2 background task(s) [shell/running,subagent/running], 0 cron(s) sid=35180d91
2026-09-21 11:03:08 invoked sid=35180d91 cwd=C:\repos\my-project
2026-09-21 11:03:08   background: none (field present) sid=35180d91
2026-09-21 11:03:09   block: finish-check sid=35180d91
```

## State

Markers and the log live in the plugin data directory (`${CLAUDE_PLUGIN_DATA}`), which survives plugin updates:

```text
<plugin data>/
├── on/
│   ├── ALL              # on for every session
│   └── <session_id>     # on for that session only
└── stop-gate.log        # one line per decision, opted-in sessions only
```

When no session is opted in, the `on/` directory does not exist and the hook exits in under 100 ms without reading its input.

## Limitations

- **A hung background task keeps the gate open.** If a background task never finishes, every stop in that session is treated as "paused" and passes. You lose the check; the session never gets stuck.
- **The check is only as good as the agent's honesty with itself.** The hook can make the agent look; it cannot make it see. It is a prompt, not a test runner.
- **Headless runs are not gated.** `claude -p` does not fire the Stop event.

## Files

```text
stop-gate/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── hooks/
│   ├── hooks.json          # Stop wiring, passes ${CLAUDE_PLUGIN_DATA}
│   └── stop-gate.js        # the gate and both prompts
├── scripts/
│   ├── state.js            # shared state-directory resolution
│   └── toggle.js           # on / off / status / clean
└── commands/
    ├── on.md
    ├── off.md
    ├── status.md
    └── clean.md
```

Requires only Node, which ships with Claude Code. No `jq` and no bash-only tools, so it runs the same on Windows with or without Git Bash.

## Origin

stop-gate started as a user-level Stop hook written in bash. The first version spawned a separate `claude -p` to judge whether to stop, and the second told the agent to consult its advisor on every stop. Both cost a model call per stop and saw less context than the agent itself. The version here only asks the agent to look. [CHANGELOG.md](CHANGELOG.md) records each design decision and why it was made.
