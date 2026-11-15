#!/usr/bin/env bash
# PostToolUse and PostToolUseFailure hook -- records what a tool call cost.
#
# Appends one line, "<tool name> <seconds> <ok|fail>", to a per-session log that
# session-end.sh aggregates, and the same line to a per-turn log the marker
# reads. Appending rather than maintaining a running tally is deliberate: tool
# calls run in parallel, so several copies of this hook can finish at once, and
# a read-modify-write on a shared counter would lose writes. A single short
# append does not.
#
# The duration comes from the payload rather than from a timestamp this plugin
# records itself. Claude Code measures the call alone, excluding the permission
# prompt and the hooks around it, which is the number worth reporting: a Bash
# call the user took ninety seconds to approve is not a ninety-second Bash call.
#
# The field is optional, so a harness that does not send one leaves the call
# untimed. That is the same place such a user was already in -- tool timing is
# off by default -- and it costs less than carrying a second measurement path
# for the case.
#
# It also tells the model two things, as additionalContext: that the call just
# finished was slow (SLOW_TOOL_AFTER), and how long the open turn has run
# (HEARTBEAT_AFTER). Both are staged by the prompt hook already resolved
# against INJECT_CONTEXT and ENABLED, so this hook reads a number per note
# rather than loading configuration for them.
#
# Never alters tool output: it writes its own state, may add context, and exits 0.
#
# Invoked as `bash <this script>` (see hooks.json), so it does not depend on
# the executable bit surviving clones, zips, or Windows checkouts.
set -euo pipefail

CT_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
source "$CT_LIB/config.sh"
source "$CT_LIB/state.sh"

# Decide with a glob, before anything forks. The gate itself lives in
# lib/state.sh, next to the flags it reads and where it can be tested: this
# hook's output is identical whether the answer is yes or no, so the only thing
# an end-to-end test could observe is the cost the gate exists to avoid.
ct_timing_wanted || exit 0

# No jq: nothing can be read out of the payload, including the session id this
# hook needs to find its own state.
command -v jq >/dev/null 2>&1 || exit 0

# agent_id is non-empty only inside a subagent, the same test stop.sh and
# message-display.sh apply. jq reads the payload from stdin itself: holding it
# in a variable first cost a `cat` and a subshell on every tool call, for a
# value nothing else here reads.
#
# stop_ms is the limit a Bash call was stopped at, empty for a call that was
# not. Claude Code stops a foreground call at tool_input.timeout, or at
# BASH_DEFAULT_TIMEOUT_MS, or after two minutes, and says so in the failure's
# error text ("Command timed out after 2s", seen in a captured payload). A
# call is stopped when it failed and either ran up to that limit or carries
# that text; and when it ran under timeout(1) and exited 124, which is how
# timeout reports that it fired. Where the limit is not one this hook can
# name, the call's own duration is it. All of it needs duration_ms, which
# Codex does not send: there a stopped call stays a failed one.
IFS=$'\x1f' read -r session_id tool_name event ms tool_use_id agent_id outcome cmd_key background stop_ms publish cwd <<< "$(jq -r \
  "$CT_JQ_CMDKEY"'
  (.tool_input | if type == "object" then . else {} end) as $ti
  | (if .tool_name == "Bash" then ($ti.command // "" | ct_cmdparse) else {key: "", timeout: false, publish: ""} end) as $c
  | (if .hook_event_name == "PostToolUseFailure" or .error != null or .success == false or .status == "error" or .status == "failed" or (.tool_response | if type == "object" then .error != null else false end) then "fail" else "ok" end) as $o
  | ($ti | ct_bash_limit) as $lim
  | (.error | if type == "string" then . else "" end) as $e
  | (if .tool_name == "Bash" and $o == "fail" and $ti.run_in_background != true and (.duration_ms | type) == "number" then
       if .duration_ms + 250 >= $lim then $lim
       elif ($e | contains("Command timed out after")) or ($c.timeout and ($e | startswith("Exit code 124"))) then .duration_ms
       else null end
     else null end) as $stop
  | [(.session_id // "-"), (.tool_name // ""), (.hook_event_name // ""), (.duration_ms // "" | tostring), (.tool_use_id // ""), (.agent_id // ""),
    $o, $c.key, ($ti.run_in_background // false | tostring),
    (if $stop == null then "" else ($stop | floor | tostring) end),
    $c.publish, (.cwd // "" | if type == "string" then . else "" end)] | join("\u001f")')"

# The prompt hook resolved the settings against the payload's cwd and left
# them here, so this hook honours the same project config the marker does
# without resolving one itself. A session whose first prompt predates this
# version has no staged answer; fall back to the process's own view, which is
# what this hook used to do unconditionally. Such a session gets no notes
# until its next prompt stages their thresholds.
#
# Every flag is read through the _var form, which assigns _CT_FLAG rather than
# printing: this runs on every tool call, and a command substitution per flag
# was a subshell each.
ct_read_flag_var "$session_id" "enabled";    ct_enabled="$_CT_FLAG"
ct_read_flag_var "$session_id" "tooltiming"; ct_timing="$_CT_FLAG"
if [ -z "$ct_enabled" ] || [ -z "$ct_timing" ]; then
  ct_load_config
  ct_enabled="${ct_enabled:-$CT_ENABLED}"
  ct_timing="${ct_timing:-$CT_TOOL_TIMING}"
fi

[ "$ct_enabled" = "on" ] || exit 0

case "$tool_name" in ''|*[![:alnum:]_-]*) tool_name="unknown" ;; esac

# The outcome is the third field on the line rather than a counter of its own.
# Tool calls run in parallel, so a counter would be a read-modify-write on a
# file several copies of this hook hold open at once, which is the lost-update
# hazard the log's own append-only shape exists to avoid.
# Claude Code supplies duration_ms. Codex measures from its PreToolUse hook
# when that field is absent. A whole-second fallback is intentional: Codex's
# documented payload has no subsecond duration, and inventing precision here
# would make the displayed number look more exact than the measurement.
if [ -z "$ms" ] && [ -n "$tool_use_id" ]; then
  start_file="$(ct_tool_start_file "$session_id" "$tool_use_id" 2>/dev/null || true)"
  if [ -n "$start_file" ] && [ -r "$start_file" ]; then
    started="$(ct_read_counter "$start_file")"
    rm -f "$start_file" 2>/dev/null || true
    now="$(date +%s)"
    if [ "$started" -gt 0 ] && [ "$now" -ge "$started" ]; then
      ms=$(( (now - started) * 1000 ))
    fi
  fi
elif [ -n "$tool_use_id" ]; then
  start_file="$(ct_tool_start_file "$session_id" "$tool_use_id" 2>/dev/null || true)"
  [ -z "$start_file" ] || rm -f "$start_file" 2>/dev/null || true
fi

# Absent, or not composed entirely of digits: there is no usable duration, so
# the call goes unrecorded rather than logged with a made-up number, and no
# slow-tool note can be based on it. A genuine zero is real information.
#
# Force base 10. A leading zero -- e.g. "0800" -- makes bash arithmetic read
# it as octal, where 8 is not a valid digit, aborting the hook; "10#" pins the
# base so the digits are read as the decimal the sender meant. Do not remove
# this as noise.
#
# More than 15 digits -- over 30,000 years of milliseconds -- is not a real
# duration, and bash arithmetic would wrap it silently into a wrong or
# negative one. It is treated the same as a missing value.
case "$ms" in
  ''|*[!0-9]*) ms="" ;;
  *) if [ "${#ms}" -gt 15 ]; then ms=""; else ms=$((10#$ms)); fi ;;
esac

# The outcome is parsed above so Codex's single PostToolUse event can still
# contribute to failure counts. Claude Code's PostToolUseFailure remains
# covered by the same expression.

# The two log paths are ct_tool_log and ct_turn_tool_log, spelled out from
# ct_state_file_var so that resolving them forks nothing.
if [ "$ct_timing" = "on" ] && [ -n "$ms" ] && ct_state_ready \
   && ct_state_file_var "$session_id"; then
  log="${_CT_STATE_FILE}.tools"
  # Milliseconds to seconds, in the shell rather than through awk, so a hook
  # that already fires once per tool call does not fork a second time to
  # divide by a thousand.
  printf -v seconds '%d.%03d' "$((ms / 1000))" "$((ms % 1000))"
  printf '%s %s %s\n' "$tool_name" "$seconds" "$outcome" >> "$log"

  # The session-wide log answers "what made this session slow"; this one
  # answers "what made this reply slow". Both need the same line.
  printf '%s %s %s\n' "$tool_name" "$seconds" "$outcome" >> "${_CT_STATE_FILE}.turntools"
fi

# What the model is told. Both notes are facts only; the time-awareness skill
# is where the advice about them lives. The slow-tool note follows SUBAGENTS,
# the same switch that decides whether a subagent's messages are stamped --
# but the heartbeat is main-conversation only, whatever SUBAGENTS says.
# Subagents share the session's heartbeat record (<state>.hb) with the main
# conversation rather than keeping one of their own, so letting a subagent's
# call claim an interval would leave the main conversation's next call
# finding it already told; the elapsed time it reports is the turn's, which
# belongs to the main conversation regardless of which call happens to
# observe it.
#
# The note builders assign _CT_NOTE rather than print, so a call with nothing
# to say forks nothing to find that out. `|| :` keeps a failure inside one of
# them from ending the hook under errexit: a note that cannot be built is a
# note not sent.
note=""
subagent_notes=""
if [ -n "$agent_id" ]; then
  ct_read_flag_var "$session_id" "subagents"; subagent_notes="$_CT_FLAG"
fi
if [ -z "$agent_id" ] || [ "$subagent_notes" = "on" ]; then
  ct_read_flag_var "$session_id" "slowtool"; st_after="$_CT_FLAG"
  if [ -n "$stop_ms" ]; then
    # Stopped at its limit. Told whatever the threshold is, short of off: a
    # 30-second limit that was hit is as much a fact as a two-minute one.
    # Worth one read of the memory, as a slow call is: what the command takes
    # when it finishes, or how often it has been stopped before.
    case "$st_after" in
      ''|0|*[!0-9]*) _CT_NOTE="" ;;
      *)
        lim_usual=""; lim_stopped=""; lim_total=""
        if [ -n "$cmd_key" ]; then
          ct_read_flag_var "$session_id" "cmdmem"
          if [ "$_CT_FLAG" = "on" ]; then
            ct_read_flag_var "$session_id" "project"
            ct_commands_path_var
            while IFS=$'\t' read -r lim_key lim_runs lim_med _ _ lim_n _; do
              [ "$lim_key" = "$cmd_key" ] || continue
              [ "$lim_runs" -ge 3 ] && lim_usual="$(( lim_med / 1000 ))"
              lim_stopped="$lim_n"; lim_total="$(( lim_runs + lim_n ))"
              break
            done < <(ct_command_stats "$_CT_COMMANDS_PATH" "$_CT_FLAG" 2>/dev/null) || :
          fi
        fi
        ct_limit_note_var "$tool_name" "$stop_ms" "$lim_usual" "$lim_stopped" "$lim_total" || :
        ;;
    esac
  else
    ct_slow_tool_note_var "$tool_name" "$ms" "$outcome" "$st_after" || :
  fi
  # Already slow, so worth one read of the memory: the usual figure for this
  # command, from the runs before this one (it is recorded further down).
  if [ -z "$stop_ms" ] && [ -n "$_CT_NOTE" ] && [ -n "$cmd_key" ]; then
    ct_read_flag_var "$session_id" "cmdmem"
    if [ "$_CT_FLAG" = "on" ]; then
      ct_read_flag_var "$session_id" "project"
      ct_commands_path_var
      usual="$(ct_command_usual "$_CT_COMMANDS_PATH" "$_CT_FLAG" "$cmd_key")" || usual=""
      if [ -n "$usual" ]; then
        ct_slow_tool_note_var "$tool_name" "$ms" "$outcome" "$st_after" "$usual" || :
      fi
    fi
  fi
  note="$_CT_NOTE"
fi
# The timeline pane's detail: one line for each call that took five seconds
# or more, or was stopped at its limit however short. End time, duration,
# tool, command key (- for none), outcome, and whether a subagent made it.
# Only ever the key, as in the command memory, never the command line. The
# live layer draws it (hooks/mod/timeline.ts), so LIVE=off writes nothing; it
# does not keep this hook awake by itself, and a session with every
# tool-facing setting off gets a timeline of turns without calls.
#
# An append of one short line, for the reason the tool log's is one.
if [ -n "$ms" ] && [ "$background" != "true" ] && { [ "$ms" -ge 5000 ] || [ -n "$stop_ms" ]; }; then
  ct_read_flag_var "$session_id" "live"
  if [ "$_CT_FLAG" = "on" ] && ct_state_ready && ct_state_file_var "$session_id"; then
    ct_epoch_var
    tl_outcome="$outcome"
    [ -z "$stop_ms" ] || tl_outcome="limit"
    tl_agent=0
    [ -z "$agent_id" ] || tl_agent=1
    # shellcheck disable=SC2153  # _CT_NOW is assigned by ct_epoch_var (lib/state.sh)
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$_CT_NOW" "$ms" "$tool_name" "${cmd_key:--}" "$tl_outcome" "$tl_agent" \
      >> "${_CT_STATE_FILE}.calls" 2>/dev/null || :
  fi
fi

# Checks, and what became of them. A check that finishes is recorded; a
# commit, a push or a pull request that went through is the moment to say
# which checks did not pass or have had files change since. Both need the
# call to have run here and finished: a background call has done neither.
if [ "$tool_name" = "Bash" ] && [ -n "$ms" ] && [ "$background" != "true" ]; then
  ct_read_flag_var "$session_id" "checknote"
  if [ "$_CT_FLAG" = "on" ]; then
    if [ -n "$cmd_key" ] && ct_is_check_key "$cmd_key"; then
      ct_epoch_var
      ck_outcome="$outcome"
      [ -z "$stop_ms" ] || ck_outcome="limit"
      # shellcheck disable=SC2153  # _CT_NOW is assigned by ct_epoch_var (lib/state.sh)
      ct_check_record "$session_id" "$cmd_key" "$ck_outcome" "$_CT_NOW" || :
    fi
    if [ -n "$publish" ] && [ "$outcome" = "ok" ] \
       && { [ -z "$agent_id" ] || [ "$subagent_notes" = "on" ]; }; then
      ct_epoch_var
      ct_check_note_var "$session_id" "$cwd" "$publish" "$_CT_NOW" || :
      [ -n "$_CT_NOTE" ] && note="${note:+$note }$_CT_NOTE"
    fi
  fi
fi
if [ -z "$agent_id" ]; then
  ct_read_flag_var "$session_id" "heartbeat"; hb_every="$_CT_FLAG"
  case "$hb_every" in
    ''|0|*[!0-9]*) ;;
    *)
      ct_epoch_var
      # shellcheck disable=SC2153  # _CT_NOW is assigned by ct_epoch_var (lib/state.sh)
      now="$_CT_NOW"
      ct_heartbeat_note_var "$session_id" "$now" "$hb_every" || :
      [ -n "$_CT_NOTE" ] && note="${note:+$note }$_CT_NOTE"
      ;;
  esac
fi

# Duration memory: one line per Bash call, recorded after the note above so a
# "usually" figure never includes the call it is compared with. A background
# call's duration is how long it took to start, so it is not recorded. The
# append is a single short write, the same concurrency argument as the tool
# log's.
if [ "$tool_name" = "Bash" ] && [ -n "$cmd_key" ] && [ -n "$ms" ] && [ "$background" != "true" ]; then
  ct_read_flag_var "$session_id" "cmdmem"
  if [ "$_CT_FLAG" = "on" ]; then
    # Outside any project (no cwd, or $HOME) a duration describes nothing
    # that a later session could look up, so it is not kept.
    ct_read_flag_var "$session_id" "project"; cm_project="$_CT_FLAG"
    case "$cm_project" in
      ''|-) ;;
      *)
        ct_epoch_var
        ct_commands_path_var
        # shellcheck disable=SC2153  # _CT_NOW is assigned by ct_epoch_var (lib/state.sh)
        # A stopped call is "limit" here and nowhere else: the tool logs
        # above keep it a failure, which it also was.
        cm_outcome="$outcome"
        [ -z "$stop_ms" ] || cm_outcome="limit"
        printf '%s\t%s\t%s\t%s\t%s\n' "$_CT_NOW" "$cm_project" "$cmd_key" "$ms" "$cm_outcome" \
          >> "$_CT_COMMANDS_PATH" 2>/dev/null || :
        ;;
    esac
  fi
fi

if [ -n "$note" ]; then
  jq -n --arg event "${event:-PostToolUse}" --arg note "$note" \
    '{hookSpecificOutput: {hookEventName: $event, additionalContext: $note}}'
fi

exit 0
