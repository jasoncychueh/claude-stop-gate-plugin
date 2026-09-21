---
description: Remove stop-gate markers left behind by ended sessions
argument-hint: ""
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/toggle.js" "${CLAUDE_PLUGIN_DATA}" clean $ARGUMENTS`

The line above is the output of the stop-gate toggle script. Relay it to the user verbatim: that one line only, with no explanation, no usage notes, and no further commands.
