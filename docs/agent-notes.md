# What Claude is told

Part of the Timestamps documentation. Start at the [README](../README.md).

The marker is drawn on your screen, never enters the transcript and never reaches the model. A few short
notes do reach it, each as a system reminder, and each only when there is
something to say. `INJECT_CONTEXT=false` switches all of them off, and each
has a setting of its own.

| When | What Claude reads | Setting |
| --- | --- | --- |
| A session starts | `Timestamps reports turn length, slow tool calls, usually slow commands and resumed sessions in system reminders; the timestamps:time-awareness skill explains them and can query session history.` | `INJECT_CONTEXT` |
| Every prompt | `Message sent at local time 10:37:21 CEST, after a 3h break` | `INJECT_CONTEXT`, `CONTEXT_FORMAT` |
| The first tool result after a turn passes 15 minutes, and every 15 after | `Turn running 15m02s (prompt sent 10:37:21); now 10:52:23 CEST.` | `HEARTBEAT_AFTER` |
| One tool call takes a minute or more | `That Bash call took 2m14s.` or, for a command with a few earlier runs here, `That Bash call took 6m10s (usually 4m02s).` | `SLOW_TOOL_AFTER` |
| A Bash call is stopped at its time limit, however short the limit | `That Bash call was stopped at its 2m00s limit (finishes in ~2m16s when it does).` or, for a command with too few finished runs to say, `That Bash call was stopped at its 2m00s limit (2 of its last 3 runs were).` | `SLOW_TOOL_AFTER` (only `0` silences it), `COMMAND_MEMORY` for the part in brackets |
| A Bash call is about to run with a time limit the command memory says is too short | `Timestamps raised this call's limit from 2m00s to 3m30s: bash tests/run.sh has taken up to 2m16s here.` or, for a command only ever stopped, `Timestamps raised this call's limit from 2m00s to 4m00s: npx playwright test was stopped at 2m00s here and has not been seen to finish.` | `RAISE_LIMIT`, `COMMAND_MEMORY` |
| A commit, a push or a pull request goes through while a check run this session failed, was stopped, or has had files change since | `Before this commit: bash tests/run.sh passed 48m12s ago, 9 files changed since; bash tools/check-docs.sh failed 12m05s ago, not run since.` | `CHECK_NOTE` |
| A session starts in a project where some commands usually take a minute or more, or were stopped at their limit at least twice | `Usually slow in this project: bash tests/run.sh ~4m02s (12 runs).`, with stopped runs `bash tests/run.sh ~2m16s (3 runs, 2 more stopped at the 2m00s limit)`, and for a command that has rarely finished `npx playwright test stopped at its limit 3 times (limit 2m00s)` | `COMMAND_MEMORY`, `SLOW_TOOL_AFTER` |
| A session starts an hour or more after the last one in this project, or a conversation is resumed an hour or more after its last activity | `Previous session in this project ended 14h ago (Thu 20:12:05).` or `Resuming this conversation; last activity 14h ago (Thu 20:12:05).` | `RESUME_NOTE` |
| A conversation is compacted | `Conversation compacted. Session started 09:12:05 (3h04m ago), 41 turns so far, 1h02m of it waiting. Longest turns: 10:37:21 (22m04s), 14:05:10 (15m30s).` | `RESUME_NOTE` |

The notes state facts and give no instructions. The advice lives in one place,
a skill the plugin ships, `time-awareness`, which Claude loads when a note
arrives or when you ask something like "how long has this session been
running?". It says what each note is a reason to do: check the work against
the request after a long stretch, run a slow command in the background next
time, re-check the branch and CI after a gap. It can also run
`setup.sh --session` and `--stats` to answer from measurement. It does not
appear in your `/` menu; `/timestamps:configure` is still where you change settings.

<p align="center">
  <img src="../assets/skill.webp" alt="Claude loading the time-awareness skill and answering how long the session has run from the measured report" width="760">
</p>

<sub>A real session, recorded as it happened. Claude loads the skill, runs
`--session`, and answers with the measured numbers rather than an estimate.</sub>

The figures about commands are only as good as what is remembered, so the
memory keeps a call only when one command in it can have taken the time.
`cd app && npm test | tail -5` is remembered as `npm test`, and
`timeout 300 npm test` too. A chain of two commands (`sleep 240; git log`), a
loop, a multi-line script and `bash -c '...'` are not remembered at all: one
call has one duration, and putting it on the wrong command would teach Claude
something false. A run stopped at its limit lasted as long as the limit, not
as long as the command, so it is counted apart and left out of the usual time.

The note about checks is there for the moment Claude is about to say the
work is verified. A check is a Bash command with a word such as `test`,
`lint`, `check` or `build` in it, or the name of a common runner; the words
decide what is tracked, and the note only ever states when a command ran and
how it ended. "Files changed since" counts the files in the Git work tree,
tracked or new and not ignored, that are newer than the end of that run, so
an edit made by a tool, by a shell command or in your own editor all count.
Outside a repository the count is unknown, and only a check that failed is
mentioned. Nothing is said when every check passed and nothing changed, and
nothing at the end of a turn that publishes nothing: `setup.sh --session`
lists every check for that.

One note reports something the plugin did rather than something it saw. A
note sent before a call arrives together with the call's result, which is too
late to say "this will be stopped". So where the memory shows a foreground
Bash call's limit is too short, the plugin raises that one argument before
the call runs, and the note says so. The limit goes to one and a half times
the longest run seen here, or to twice the limit the command was last stopped
at when it has not been seen to get further, rounded up to ten seconds and
never past Claude Code's own maximum. It is only ever raised. The command is
not touched, a background call is left alone, and the call is not approved on
anyone's behalf: one that needed permission still asks. `RAISE_LIMIT=off`
switches it off.

A note can only reach Claude when a hook runs, so the turn-length note waits
for the next tool result. A single 31-minute command produces one note when
it finishes, not one at 15 minutes and another at 30.

Subagents hear about their own slow calls unless `SUBAGENTS` is `off`. The
turn-length note goes to the main conversation only, since the turn is yours
and theirs is a part of it.

The resumption note records nothing of its own. Claude Code already keeps a
transcript per session in a folder per project, and the note reads the time
from those. If that layout ever changes, the note goes quiet rather than
guessing.
