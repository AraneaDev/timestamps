// One session as `setup.sh --pane` reports it, shared by the pane's tests.
// 1_700_000_000 is 22:13:20 UTC. Three turns: the first short; the second
// long, with a call far over its usual time, one stopped, one failed, a
// chain and a subagent's; the third still running.
export const REPORT = {
  now: 1_700_003_000,
  project: 'app',
  session: {
    started: 1_700_000_000,
    elapsed: 3000,
    waiting: 2100,
    away: 600,
    checks: [
      { key: 'bash tests/run.sh', outcome: 'ok', at: 1_700_002_000, changed: 3 },
      { key: 'npm test', outcome: 'fail', at: 1_700_002_500, changed: 0 },
      { key: 'shellcheck', outcome: 'ok', at: 1_700_002_900, changed: 0 },
    ],
    turns: [
      { n: 1, start: 1_700_000_000, end: 1_700_000_100, secs: 100, how: 'stop' },
      { n: 2, start: 1_700_000_200, end: 1_700_002_000, secs: 1800, how: 'stop' },
      { n: 3, start: 1_700_002_800, end: null, secs: 200, how: 'open' },
      { n: 9, start: 'x', secs: 1, how: 'stop' },
      { n: 10, start: 1, secs: 1, how: 'nonsense' },
    ],
  },
  calls: [
    { at: 1_700_000_400, ms: 71_000, tool: 'Bash', key: 'bash tests/run.sh', outcome: 'ok', subagent: false },
    { at: 1_700_000_700, ms: 167_000, tool: 'Bash', key: 'bash tools/check-docs.sh', outcome: 'ok', subagent: false },
    { at: 1_700_000_900, ms: 120_010, tool: 'Bash', key: 'bash tests/run.sh', outcome: 'limit', subagent: false },
    { at: 1_700_001_000, ms: 9_000, tool: 'WebFetch', key: null, outcome: 'fail', subagent: false },
    { at: 1_700_001_100, ms: 30_000, tool: 'Bash', key: null, outcome: 'ok', subagent: true },
    { at: 1_700_002_900, ms: 7_000, tool: 'Bash', key: 'make', outcome: 'ok', subagent: false },
    { at: 1_700_002_500, ms: 5_000, tool: 'Bash', key: 'between', outcome: 'ok', subagent: false },
    { at: 'x', ms: 1, tool: 'Bash', outcome: 'ok' },
    'garbage',
  ],
  commands: [
    { key: 'bash tools/check-docs.sh', runs: 5, median_ms: 67_000, last_ms: 167_000, failed: 0, stopped: 0, limit_ms: 0, max_ms: 167_000 },
    { key: 'bash tests/run.sh', runs: 12, median_ms: 65_000, last_ms: 71_000, failed: 1, stopped: 2, limit_ms: 120_010, max_ms: 136_000 },
    { key: 'make', runs: 2, median_ms: 6_000, last_ms: 7_000, failed: 0, stopped: 0, limit_ms: 0, max_ms: 7_000 },
    { key: 'ls', runs: 4, median_ms: 40, last_ms: 30, failed: 0, stopped: 0, limit_ms: 0, max_ms: 90 },
  ],
  told: [
    { at: 1_700_000_700, kind: 'slow', text: 'That Bash call took 2m47s (usually 1m07s).' },
    { at: 1_700_000_900, kind: 'stopped', text: 'That Bash call was stopped at its 2m00s limit (finishes in ~1m05s when it does).' },
    { at: 'x', kind: 'slow', text: 'broken' },
  ],
  history: [
    { when: '2023-11-13T10:00:00', secs: 3600, turns: 40, waited: 900, idle: 600, failed: 2, project: null },
    { when: '2023-11-14T09:00:00', secs: 7200, turns: 80, waited: 1800, idle: 1200, failed: 0, project: 'app' },
    { when: '2023-11-14T20:00:00', secs: 1800, turns: 10, waited: 600, idle: 0, failed: 0, project: 'site' },
  ],
  settings: { tz: 'UTC', zone: 'UTC', slow_tool_after: 60 },
  config: [
    { key: 'ENABLED', flag: 'enabled', value: 'on', default: 'on', values: ['on', 'off'], describes: 'master switch; off silences every hook', kind: 'toggle', empty: null, pinned: false },
    { key: 'TZ', flag: 'tz', value: '', default: '', values: [], describes: 'IANA timezone name, or empty for the machine\'s local time', kind: 'text', empty: 'local', pinned: false },
    { key: 'DISPLAY_FORMAT', flag: 'display', value: 'short', default: '24h', values: ['24h', 'short', '12h', 'iso'], describes: 'clock format of the marker', kind: 'choice', empty: null, pinned: false },
    { key: 'TIME_COLOR', flag: 'time-color', value: 'cyan', default: '', values: ['', 'none', 'dim', 'cyan'], describes: 'colour of the time', kind: 'choice', empty: 'inherit', pinned: false },
    { key: 'SLOW_AFTER', flag: 'slow-after', value: '7', default: '60', values: [], describes: 'seconds after which a turn is slow', kind: 'text', empty: null, pinned: true },
    { key: 'TOOL_TIMING', flag: 'tool-timing', value: 'off', default: 'off', values: ['on', 'off'], describes: 'record what each tool call cost', kind: 'toggle', empty: null, pinned: false },
    { key: 'BROKEN', flag: 'broken', value: 'x', kind: 'nonsense' },
  ],
  config_file: '~/.claude/claude-timestamp.conf',
  project_config: '~/work/app/.claude/claude-timestamp.conf',
  doctor: ['Timestamps doctor', '', 'Platform', '  uname           Linux', '', 'Dependencies', '  jq              jq-1.8.2', '', 'No problems found.'],
}

export const REPORT_JSON = JSON.stringify(REPORT)
