# Changelog

Version history and decision rationale are collected here.

## 1.0.0 (2026-09-21)

First release as a plugin. The gate was first built and tuned as a user-level Stop hook in `~/.claude/settings.json` (bash + jq), then ported to Node and packaged here.

- **Stop hook (`hooks/stop-gate.js`)** — blocks the main agent's stop once and injects a self-check prompt. Two prompts: a **finish check** (work really done, built and tested, nothing promised but skipped, nothing left running, not waiting on the user) and a **question check** when the last message ends with a question (could the agent answer it itself, are the options thought through with a recommendation, would different answers change the work, is the answer-independent part done). Fail-open on any error.
- **Commands** — `/stop-gate:on`, `/stop-gate:off` (each with an optional `all`), `/stop-gate:status`, `/stop-gate:clean`. One-line output, relayed verbatim.

### Design notes

- **Inject a prompt, never spawn a model.** The first version ran `claude -p --model fable` inside the hook to judge whether to stop. It saw only a digest the script assembled, could not reuse the session's prompt cache, and added 7–9 s plus a model call to every stop. Injecting the question back into the agent's own turn gives the judgement full context at no extra call. A middle version told the agent to consult its `advisor` tool on every stop; that was dropped too — plain self-reflection is enough for most stops, and the agent can still reach for the advisor when it needs one.
- **Opt-in per session, registered globally.** Registration (which settings file wires the hook) can only be user- or project-wide; activation is decided inside the hook by a marker named after `session_id`, so it can be per session. Default is off. With no marker the hook returns before parsing stdin.
- **`stop_hook_active` is the loop guard.** Claude Code sets it once a Stop hook has blocked in the current turn and resets it on the next user message. It is not derived from tool history and a hook cannot clear it. Claude Code also caps consecutive blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- **`background_tasks` / `session_crons` separate "done" from "paused".** Both are in the Stop hook input. Verified live: with a background shell and a subagent running the hook saw `[shell/running,subagent/running]`, then `[shell/running]` after the subagent reported, then an empty array (field still present) once everything finished — and only that last stop was gated. Subagents fire `SubagentStop`, never `Stop`. A task that hangs keeps the gate open (passes), which costs one missed check, never a stuck session.
- **Question detection looks at the last character only.** An earlier version searched the last 160 characters for a question mark and skipped the gate on any hit — a `?` mid-sentence or inside code wrongly counted. Trailing whitespace, markdown emphasis and closing brackets/quotes are peeled first.
- **Questions are gated, not waved through.** Ending on a question used to pass the gate as "waiting for the user". It now gets its own check, since handing a question back is exactly where an agent tends to ask what it could have found out or decided itself.
- **`last_assistant_message` is in the input**, so the question test needs no transcript parsing. The tool-use filter still reads the transcript, walking backwards only as far as the last human message.
- **`claude -p` never fires `Stop`** (it does fire `SessionStart`), so the Stop path cannot be tested headless — only by ending a real interactive turn and reading the log. `${CLAUDE_PLUGIN_DATA}` was verified to expand inside a command's `!` line (via `--plugin-dir`); the hook receives it from `hooks.json`.
- **Settings load by the session's working directory, not by the worktree it edits.** A session started in the main checkout that edits a worktree loads the main checkout's settings — relevant when judging which sessions a hook affects.
