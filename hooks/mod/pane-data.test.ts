import { expect, test } from 'claude-code/testing'
import { callName, callsByTurn, checkState, composition, days, overUsual, parsePane, usualOf, workingSeconds } from './pane-data.ts'
import { REPORT, REPORT_JSON } from './pane-fixture.ts'

const data = parsePane(REPORT_JSON)!

test('the report is read whole, and entries that are not whole are left out', () => {
  expect([data.now, data.project, data.hasSession, data.started, data.elapsed, data.waiting, data.away, data.tz]).toEqual([
    1_700_003_000, 'app', true, 1_700_000_000, 3000, 2100, 600, 'UTC',
  ])
  expect(data.turns.map(t => [t.n, t.secs, t.how])).toEqual([[1, 100, 'stop'], [2, 1800, 'stop'], [3, 200, 'running']])
  expect(data.calls.length).toBe(7)
  expect(data.calls[4]).toEqual({ at: 1_700_001_100, ms: 30_000, tool: 'Bash', key: null, outcome: 'ok', isSubagent: true })
  expect(data.commands[1]).toEqual({ key: 'bash tests/run.sh', runs: 12, medianMs: 65_000, lastMs: 71_000, failed: 1, stopped: 2, limitMs: 120_010, maxMs: 136_000 })
  expect(data.told.length).toBe(2)
  expect(data.checks.map(c => c.key)).toEqual(['bash tests/run.sh', 'npm test', 'shellcheck'])
  expect(data.history.map(s => s.project)).toEqual([null, 'app', 'site'])
})

test('a session with no record yet still has its memory and history', () => {
  const none = parsePane(JSON.stringify({ ...REPORT, session: null }))!
  expect([none.hasSession, none.turns.length, none.checks.length, none.commands.length, none.history.length]).toEqual([false, 0, 0, 4, 3])
})

test('what is not the report is nothing', () => {
  expect(parsePane('')).toBe(undefined)
  expect(parsePane('not json')).toBe(undefined)
  expect(parsePane('[1,2]')).toBe(undefined)
  expect(parsePane('{"session":{}}')).toBe(undefined)
})

test('a usual time needs three finished runs', () => {
  expect([...usualOf(data).entries()]).toEqual([['bash tools/check-docs.sh', 67], ['bash tests/run.sh', 65], ['ls', 0]])
})

test('each call lands in the turn it ended in; one that ended between turns is in none', () => {
  const byTurn = callsByTurn(data)
  expect([...byTurn.keys()]).toEqual([2, 3])
  expect(byTurn.get(2)?.length).toBe(5)
  expect(byTurn.get(3)?.map(c => c.key)).toEqual(['make'])
})

test('over their usual: furthest over first, with the turn, and never a stopped call', () => {
  expect(overUsual(data).map(o => [o.call.key, o.usual, Number(o.ratio.toFixed(2)), o.turn])).toEqual([['bash tools/check-docs.sh', 67, 2.49, 2]])
})

test('the composition is by what a call is listed as, most time first', () => {
  expect(composition(data.calls).map(s => [s.name, s.ms, s.count]).slice(0, 3)).toEqual([
    ['bash tests/run.sh', 191_010, 2],
    ['bash tools/check-docs.sh', 167_000, 1],
    ['Bash, several commands (subagent)', 30_000, 1],
  ])
  expect(callName({ at: 0, ms: 0, tool: 'AskUserQuestion', key: null, outcome: 'ok', isSubagent: false })).toBe('AskUserQuestion (your answer)')
})

test('working time is the turns added up', () => {
  expect(workingSeconds(data)).toBe(2100)
})

test('past sessions by day, newest first', () => {
  expect(days(data.history)).toEqual([
    { date: '2023-11-14', sessions: 2, secs: 9000, waited: 2400, turns: 90 },
    { date: '2023-11-13', sessions: 1, secs: 3600, waited: 900, turns: 40 },
  ])
})

test('a check is fresh, stale or bad', () => {
  expect(data.checks.map(checkState)).toEqual(['stale', 'bad', 'fresh'])
  expect(checkState({ key: 'k', outcome: 'ok', at: 0, changed: null })).toBe('fresh')
})

test('the settings are read with their kind, an empty value kept as a value, a broken one left out', () => {
  expect(data.settings.map(c => c.key)).toEqual(['ENABLED', 'TZ', 'DISPLAY_FORMAT', 'TIME_COLOR', 'SLOW_AFTER', 'TOOL_TIMING'])
  expect(data.settings[1]).toEqual({
    key: 'TZ', flag: 'tz', value: '', def: '', values: [], describes: "IANA timezone name, or empty for the machine's local time", kind: 'text', empty: 'local', isPinned: false,
  })
  expect([data.settings[4]?.isPinned, data.settings[3]?.values]).toEqual([true, ['', 'none', 'dim', 'cyan']])
  expect([data.configFile, data.projectConfig]).toEqual(['~/.claude/claude-timestamp.conf', '~/work/app/.claude/claude-timestamp.conf'])
  expect(data.doctor.length).toBe(9)
})
