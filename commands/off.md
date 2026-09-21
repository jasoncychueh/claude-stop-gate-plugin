---
description: Turn off stop-gate (this session only; add all for every session)
argument-hint: "[all]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/toggle.js" "${CLAUDE_PLUGIN_DATA}" off $ARGUMENTS`

The line above is the output of the stop-gate toggle script. Relay it to the user verbatim: that one line only, with no explanation, no usage notes, and no further commands.
