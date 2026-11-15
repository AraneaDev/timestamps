#!/usr/bin/env bash
# PreToolUse hook, bound to Bash calls -- raises the time limit of a call the
# command memory says would be stopped.
#
# The memory knows a command takes 2m16s here; the call still comes with the
# two-minute default, is stopped, and is run again. A note cannot prevent
# that: what a PreToolUse hook tells the model arrives with the call's
# result. So this hook changes the one argument that decides it, timeout, and
# says that it did. What is raised, and to what, is ct_raise_limit_var's
# (lib/state.sh); RAISE_LIMIT=off switches it off.
#
# It never decides permission. Its answer carries updatedInput and
# additionalContext and no permissionDecision, so a call that needed the
# person's approval still does (measured: a mkdir with its limit raised by
# this shape of answer was still held for approval). It never lowers a limit,
# never touches the command, and leaves a background call alone.
#
# Codex also runs this file, with the CT_CODEX_HOOK marker its separate hook
# map sets, to record when a tool call started: Codex does not provide Claude
# Code's duration_ms field. That path is additive, only writes timing state
# for the current Codex session, and raises nothing.
#
# A session that was running before a version without a PreToolUse binding
# was replaced by this one keeps the hook map it started with. One bound to
# every tool, from before ad31d05, reaches the unmarked path for tools other
# than Bash and leaves at once; one bound to nothing never gets here.
#
# Invoked as `bash <this script>` (see hooks.json), so it does not depend on
# the executable bit surviving clones, zips, or Windows checkouts.
set -euo pipefail

CT_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
source "$CT_LIB/config.sh"
source "$CT_LIB/state.sh"

if [ "${CT_CODEX_HOOK:-}" = "1" ]; then
  command -v jq >/dev/null 2>&1 || exit 0

  # With all tool-facing features off, preserve the free path and do not create
  # per-call files merely because Codex supports this event.
  ct_timing_wanted || exit 0

  IFS=$'\x1f' read -r session_id tool_use_id cwd <<< "$(jq -r \
    '[(.session_id // ""), (.tool_use_id // ""), (.cwd // "")] | join("\u001f")')"
  [ -n "$session_id" ] && [ -n "$tool_use_id" ] || exit 0

  ct_read_flag_var "$session_id" "enabled"
  enabled="$_CT_FLAG"
  if [ -z "$enabled" ]; then
    ct_load_config "$cwd"
    enabled="$CT_ENABLED"
  fi
  [ "$enabled" = "on" ] || exit 0

  if ct_state_ready && start_file="$(ct_tool_start_file "$session_id" "$tool_use_id")"; then
    printf '%s' "$(date +%s)" > "$start_file"
  fi

  exit 0
fi

# Decide with a glob, before anything forks: the same gate post-tool-use.sh
# uses. The command memory keeps it open, and without the memory there is
# nothing to raise a limit from.
ct_timing_wanted || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# One jq call for everything the payload has to say. tool_input comes back
# whole, as one line of JSON, because the answer has to hand all of it back:
# updatedInput replaces the call's arguments rather than merging into them.
# JSON escapes control characters, so the separator cannot occur inside it.
IFS=$'\x1f' read -r session_id tool_name cmd_key limit background tool_input <<< "$(jq -r \
  "$CT_JQ_CMDKEY"'
  (.tool_input | if type == "object" then . else {} end) as $ti
  | [(.session_id // ""), (.tool_name // ""),
     (if .tool_name == "Bash" then ($ti.command // "" | ct_cmdkey) else "" end),
     ($ti | ct_bash_limit | floor | tostring),
     ($ti.run_in_background // false | tostring),
     ($ti | tojson)] | join("\u001f")')"

# A call without a key is one whose time no single command accounts for, so
# the memory has nothing on it. A background call has no limit to run into.
[ "$tool_name" = "Bash" ] && [ -n "$session_id" ] && [ -n "$cmd_key" ] && [ "$background" != "true" ] || exit 0

# Staged by the prompt hook already resolved against ENABLED, COMMAND_MEMORY
# and INJECT_CONTEXT. A session whose last prompt predates this version has
# nothing staged, and its calls are left as they are.
ct_read_flag_var "$session_id" "raise"
[ "$_CT_FLAG" = "on" ] || exit 0
ct_read_flag_var "$session_id" "project"; project="$_CT_FLAG"
case "$project" in ''|-) exit 0 ;; esac

runs=""; longest=""; stopped=""; stopped_at=""
ct_commands_path_var
while IFS=$'\t' read -r key key_runs _ _ _ key_stopped key_limit key_max; do
  [ "$key" = "$cmd_key" ] || continue
  runs="$key_runs"; longest="$key_max"; stopped="$key_stopped"; stopped_at="$key_limit"
  break
done < <(ct_command_stats "$_CT_COMMANDS_PATH" "$project" 2>/dev/null) || :
[ -n "$runs" ] || exit 0

# Claude Code refuses a timeout above BASH_MAX_TIMEOUT_MS, ten minutes unless
# set, and updatedInput is validated like any other input.
cap="${BASH_MAX_TIMEOUT_MS:-}"
case "$cap" in ''|*[!0-9]*) cap=600000 ;; esac
if [ "${#cap}" -gt 15 ] || [ "$((10#$cap))" -le 0 ]; then
  cap=600000
fi

ct_raise_limit_var "$limit" "$cap" "$runs" "$longest" "$stopped" "$stopped_at"
[ -n "$_CT_RAISE" ] || exit 0

from="$(ct_format_duration $(( 10#$limit / 1000 )))"
to="$(ct_format_duration $(( _CT_RAISE / 1000 )))"
if [ "$_CT_RAISE_WHY" = "stopped" ]; then
  why="was stopped at $(ct_format_duration $(( 10#$stopped_at / 1000 ))) here and has not been seen to finish"
else
  why="has taken up to $(ct_format_duration $(( (10#$longest + 999) / 1000 ))) here"
fi

# A fact, like every other note: what was changed and what it was based on.
raised="Timestamps raised this call's limit from $from to $to: $cmd_key $why."
ct_told "$session_id" "raised" "$raised"
jq -cn --argjson input "$tool_input" --argjson limit "$_CT_RAISE" \
  --arg note "$raised" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: ($input + {timeout: $limit}), additionalContext: $note}}'

exit 0
