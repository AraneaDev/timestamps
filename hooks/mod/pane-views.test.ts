import { expect, test } from 'claude-code/testing'
import type { PaneTab, PaneView } from '../../types'
import { parsePane } from './pane-data.ts'
import { REPORT, REPORT_JSON } from './pane-fixture.ts'
import { clockOf, dayLabel, markerOfTurn, paneLayout, TABS, turnOrder } from './pane-views.ts'
import type { Layout } from './pane-views.ts'
import { cells } from './rows.ts'

const data = parsePane(REPORT_JSON)!
const clock = clockOf('UTC')
const at = (tab: PaneTab, marker = 0, isByTime = false, editing: string | null = null, note: string | null = null): PaneView => ({ tab, marker, isByTime, editing, note })
const lines = (layout: Layout) => layout.rows.map(r => r.segments.filter(s => s.hidden !== true).map(s => s.text).join('').replace(/\s+$/, ''))
const draw = (view: PaneView, columns = 100, height = 60) => lines(paneLayout(data, view, columns, height, clock))
const rowOf = (drawn: string[], needle: string) => drawn.find(l => l.includes(needle)) ?? ''
// A row with its runs of spaces, rule and bar each brought down to one mark: what it says, not how far apart.
const said = (line: string) => line.replace(/─{2,}/g, '─').replace(/[━·]{2,}/g, '━').replace(/ {2,}/g, ' ')

test('the header: the name and project, the status, reload, then the tabs on a rule', () => {
  const drawn = draw(at('overview'))
  expect(said(drawn[0] ?? '')).toBe(' timestamps app 50m00s · turn 3 running 3m20s live r: reload')
  expect(cells(drawn[0] ?? '')).toBe(99)
  expect(drawn[1]).toBe('')
  expect(drawn[2]).toBe('  Overview    Turns    Commands    Checks    Told Claude    History    Settings    Doctor')
  expect(drawn[3]).toBe(` ${'─'.repeat(98)}`)
  expect(drawn[4]).toBe('')
})

test('every row keeps a cell of margin and none runs past the pane', () => {
  for (const tab of TABS) {
    for (const columns of [200, 120, 100, 80, 50, 30]) {
      const layout = paneLayout(data, at(tab.id, 1), columns, 50, clock)
      for (const row of layout.rows) {
        const size = row.segments.reduce((sum, s) => sum + (s.hidden === true ? 0 : cells(s.text)), 0)
        expect([tab.id, columns, row.key, size <= columns]).toEqual([tab.id, columns, row.key, true])
        const first = row.segments.find(s => s.hidden !== true && s.text !== '')
        if (first !== undefined) expect([row.key, first.text.startsWith(' ')]).toEqual([row.key, true])
      }
    }
  }
})

test('the keys are on the last row of the room, and every tab keeps its digit at any width', () => {
  for (const columns of [120, 30]) {
    const layout = paneLayout(data, at('overview'), columns, 60, clock)
    expect(layout.rows.length).toBe(60)
    expect(layout.rows[59]?.key).toBe('keys')
    const keys = layout.rows.flatMap(r => r.segments.map(s => s.press?.hotkey)).filter(k => k !== undefined)
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', 'j', 'k', 'r']) expect([columns, k, keys.includes(k)]).toEqual([columns, k, true])
  }
})

test('overview: the tiles, in one frame', () => {
  const drawn = draw(at('overview'))
  expect(drawn[5]).toBe(` ┌${'─'.repeat(96)}┐`)
  expect(drawn[6]?.replace(/ +/g, ' ')).toBe(' │ 50m00s │ 3 │ 35m00s │ 10m00s │ 7 │ 1 │ 1 │')
  expect(drawn[7]?.replace(/ +/g, ' ')).toBe(' │ session │ turns │ you waited │ away │ slow calls │ stopped │ failed │')
  expect(drawn[8]).toBe(` └${'─'.repeat(96)}┘`)
  expect(drawn[9]).toBe('')
})

test('overview: tiles that do not fit are dropped from the end, never squeezed', () => {
  const narrow = draw(at('overview'), 44)
  expect(narrow[7]?.replace(/ +/g, ' ')).toBe(' │ session │ turns │ you waited │ away │')
})

test('overview: where the time went, as a bar the full width and a legend', () => {
  const drawn = draw(at('overview'))
  expect(said(rowOf(drawn, 'Where the time went'))).toBe(' ─ ◷ Where the time went ─ 35m00s working ─')
  expect(cells(rowOf(drawn, 'Where the time went'))).toBe(99)
  const barRow = drawn[drawn.findIndex(l => l.includes('Where the time went')) + 2] ?? ''
  expect(cells(barRow)).toBe(98)
  expect(/^ {2}█+░+$/.test(barRow)).toBe(true)
  expect(said(rowOf(drawn, '■ bash tests/run.sh'))).toBe(' ■ bash tests/run.sh 9% ■ bash tools/check-docs.sh 8%')
  expect(said(rowOf(drawn, '░ the rest'))).toBe(' ■ other listed calls 1% ░ the rest 81%')
})

test('overview: over their usual, longest turns, checks and what Claude was told', () => {
  const drawn = draw(at('overview'))
  expect(said(rowOf(drawn, '2.5× usual'))).toBe(' › bash tools/check-docs.sh 2m47s ━ 2.5× usual 1m07s turn 2')
  expect(said(rowOf(drawn, '#2   22:16'))).toBe(' #2 22:16 30m00s ━ 6m37s in calls')
  expect(rowOf(drawn, '#3   23:00').endsWith('running')).toBe(true)
  expect(said(rowOf(drawn, '── ✓ Checks'))).toBe(' ─ ✓ Checks ─ 1 failed · 1 stale · 1 fresh ─')
  expect(rowOf(drawn, '✗ npm test')).toBe('  ✗ npm test           failed 8m20s ago · not run since')
  expect(rowOf(drawn, '! bash tests/run.sh')).toBe('  ! bash tests/run.sh  passed 16m40s ago · 3 files changed since')
  expect(rowOf(drawn, '✓ shellcheck')).toBe('  ✓ shellcheck         passed 1m40s ago · nothing changed since')
  expect(rowOf(drawn, 'stopped  That')).toBe('  22:28  stopped  That Bash call was stopped at its 2m00s limit (finishes in ~1m05s when it does).')
})

test('overview: the marker walks the rows that open a turn, and o says which', () => {
  const first = paneLayout(data, at('overview', 0), 100, 60, clock)
  expect([first.count, first.open]).toEqual([4, { turn: 2 }])
  expect(lines(first).filter(l => l.startsWith(' › ')).length).toBe(1)
  expect(paneLayout(data, at('overview', 2), 100, 60, clock).open).toEqual({ turn: 3 })
  expect(said(rowOf(lines(first), 'j: ↓'))).toBe(' j: ↓ k: ↑ o: open turn 1-8: tabs')
  // A marker past the end stands on the last row rather than on none.
  const past = paneLayout(data, at('overview', 99), 100, 60, clock)
  expect(lines(past).filter(l => l.startsWith(' › ')).length).toBe(1)
  expect(past.open).toEqual({ turn: 1 })
})

test('turns, stacked: the list, then the marked turn with its calls in the order they ran', () => {
  const drawn = draw(at('turns', 1), 90)
  expect(said(rowOf(drawn, '── ≡ Turns'))).toBe(' ─ ≡ Turns ─ 3 · as they happened ─')
  expect(said(rowOf(drawn, '› #2'))).toBe(' › #2 22:16 30m00s ━ 6m37s ▲1 ■1 ✗1')
  expect(rowOf(drawn, '#3   23:00').endsWith('running')).toBe(true)
  expect(said(rowOf(drawn, '── ◆ #2'))).toBe(' ─ ◆ #2 · 22:16 → 22:46 ─ ended normally ─')
  expect(rowOf(drawn, 'in 5 listed calls')).toBe('  30m00s  ·  6m37s in 5 listed calls  ·  23m23s the rest')
  const calls = drawn.filter(l => /^ {2}\d\d:\d\d:\d\d /.test(l))
  expect(calls).toEqual([
    '  22:18:49   1m11s  ■ bash tests/run.sh  usually 1m05s',
    '  22:22:13   2m47s  ■ bash tools/check-docs.sh  ▲ 2.5× usual 1m07s',
    '  22:26:19   2m00s  ■ bash tests/run.sh  ■ stopped at its limit',
    '  22:29:51      9s  ■ WebFetch  ✗ failed',
    '  22:31:10     30s  ■ Bash, several commands (subagent)',
  ])
  expect(rowOf(drawn, 'thinking, writing')).toBe('            23m23s  ░ thinking, writing, calls under 5s')
})

test('turns, wide: the detail sits beside the list', () => {
  const drawn = draw(at('turns', 1), 160)
  const row = rowOf(drawn, '── ≡ Turns')
  expect(row.includes('── ◆ #2 · 22:16 → 22:46')).toBe(true)
  expect(rowOf(drawn, '› #2').includes('30m00s')).toBe(true)
})

test('turns: longest first reorders the list, and a turn is found in either order', () => {
  expect(turnOrder(data, true).map(t => t.n)).toEqual([2, 3, 1])
  expect([markerOfTurn(data, false, 3), markerOfTurn(data, true, 3), markerOfTurn(data, true, 99)]).toEqual([2, 1, 0])
  expect(rowOf(draw(at('turns', 0, true), 90), '── ≡ Turns').includes('longest first')).toBe(true)
  expect(rowOf(draw(at('turns', 0, true), 90), 'j: ↓').includes('s: as they happened')).toBe(true)
})

test('turns: a list longer than its room is a window around the marker', () => {
  const many = parsePane(
    JSON.stringify({
      ...REPORT,
      session: { ...REPORT.session, turns: Array.from({ length: 40 }, (_, i) => ({ n: i + 1, start: 1_700_000_000 + i * 100, secs: 50, how: 'stop' })) },
      calls: [],
    }),
  )!
  const drawn = lines(paneLayout(many, at('turns', 20), 90, 40, clock))
  expect(drawn.some(l => /↑ \d+ more/.test(l))).toBe(true)
  expect(drawn.some(l => /↓ \d+ more/.test(l))).toBe(true)
  expect(drawn.some(l => l.startsWith(' › #21'))).toBe(true)
})

test('commands: the memory, the marked command and its runs this session', () => {
  const drawn = draw(at('commands', 1), 90)
  expect(rowOf(drawn, '── ◔ Commands').includes('4 · slowest first')).toBe(true)
  expect(said(rowOf(drawn, '› bash tests/run.sh'))).toBe(' › bash tests/run.sh 12 1m05s 2m16s ━ ■2 ✗1')
  expect(said(rowOf(drawn, '   ls '))).toBe(' ls 4 <1s <1s ━')
  expect(rowOf(drawn, 'usually 1m05s')).toBe('  usually 1m05s  over 12 finished runs')
  expect(rowOf(drawn, 'stopped at its limit 2 times')).toBe('  ■ stopped at its limit 2 times, last at 2m00s')
  expect(rowOf(drawn, '1 run failed')).toBe('  ✗ 1 run failed')
  expect(drawn.filter(l => /^ {2}\d\d:\d\d:\d\d /.test(l))).toEqual(['  22:18:49   1m11s  turn 2  usually 1m05s', '  22:26:19   2m00s  turn 2  ■ stopped at its limit'])
  expect(rowOf(draw(at('commands', 0, true), 90), '── ◔ Commands').includes('most time this session')).toBe(true)
})

test('checks: each check, newest first, and what a check is', () => {
  const drawn = draw(at('checks'), 90)
  expect(drawn.filter(l => /^ [› ] [✓!✗] /.test(l)).map(l => l.slice(3, 4))).toEqual(['✓', '✗', '!'])
  expect(drawn.some(l => l.includes('A check is a command with a word such as test'))).toBe(true)
})

test('told: newest first, long notes wrapped under themselves', () => {
  const drawn = draw(at('told'), 70)
  expect(rowOf(drawn, '── ⚑ Told Claude').includes('2 notes · newest first')).toBe(true)
  const from = drawn.findIndex(l => l.includes('22:28:20'))
  expect(drawn[from]).toBe(' › 22:28:20  stopped  That Bash call was stopped at its 2m00s limit')
  expect(drawn[from + 1]).toBe('                      (finishes in ~1m05s when it does).')
  expect(drawn[from + 2]).toBe('   22:25:00  slow     That Bash call took 2m47s (usually 1m07s).')
})

test('history: by day, newest first, then by project', () => {
  const drawn = draw(at('history'), 100)
  expect(rowOf(drawn, '── ▤ Past sessions').includes('3 sessions · 3h30m')).toBe(true)
  expect(said(rowOf(drawn, 'Tue 14 Nov'))).toBe(' › Tue 14 Nov 2 2h30m ━ 40m00s 27% 90')
  expect(rowOf(drawn, 'Mon 13 Nov').startsWith('   Mon 13 Nov')).toBe(true)
  expect(rowOf(drawn, '── ◫ By project') !== '').toBe(true)
  expect(said(rowOf(drawn, '2h00m'))).toBe(' app 1 session 2h00m ━')
  expect(dayLabel('2026-11-05')).toBe('Thu  5 Nov')
  expect(dayLabel('nonsense')).toBe('nonsense')
})

test('a session with nothing recorded says so on every tab', () => {
  const none = parsePane(JSON.stringify({ now: 1, project: null, session: null, calls: [], commands: [], told: [], history: [], settings: {} }))!
  const say = (tab: PaneTab) => lines(paneLayout(none, at(tab), 90, 30, clock)).join('\n')
  expect(say('overview').includes('no turns yet')).toBe(true)
  expect(say('turns').includes('No turns recorded yet in this session.')).toBe(true)
  expect(say('commands').includes('This directory is not in a project')).toBe(true)
  expect(say('checks').includes('No check has run in this session yet.')).toBe(true)
  expect(say('told').includes('Nothing has been said to Claude about time')).toBe(true)
  expect(say('history').includes('No finished session recorded yet.')).toBe(true)
})

test('before the report arrives the pane says it is reading', () => {
  const layout = paneLayout(null, at('overview'), 80, 20, clock)
  expect(lines(layout).some(l => l.includes('Reading this session…'))).toBe(true)
  expect(layout.count).toBe(0)
})

test('the clock is in the configured zone, with seconds when asked', () => {
  expect([clockOf('UTC')(1_700_000_000), clockOf('Asia/Tokyo')(1_700_000_000), clockOf('UTC')(1_700_000_000, true)]).toEqual(['22:13', '07:13', '22:13:20'])
  expect(/^\d\d:\d\d$/.test(clockOf('Not/AZone')(1_700_000_000))).toBe(true)
  expect(/^\d\d:\d\d$/.test(clockOf(null)(1_700_000_000))).toBe(true)
})

test('compact: a short room gets the title, the tabs, the body and the keys, with no blank rows', () => {
  const layout = paneLayout(data, at('overview'), 198, 11, clock)
  const drawn = lines(layout)
  expect(drawn.length).toBe(11)
  expect(said(drawn[0] ?? '')).toBe(' timestamps app 50m00s · turn 3 running 3m20s live r: reload')
  expect(drawn[1]).toBe('  Overview    Turns    Commands    Checks    Told Claude    History    Settings    Doctor')
  expect(drawn[2]).toBe('  50m00s session · 3 turns · 35m00s you waited · 10m00s away · 7 slow calls · 1 stopped · 1 failed')
  expect(layout.rows[10]?.key).toBe('keys')
  expect(drawn.slice(2, 10).some(l => l === '')).toBe(false)
  expect(drawn.some(l => l.includes('┌'))).toBe(false)
})

test('compact: j walks the rows, then goes on to the end of the page, and the keys say what is out of sight', () => {
  const seen = new Set<string>()
  const first = paneLayout(data, at('overview', 0), 198, 11, clock)
  expect(rowOf(lines(first), 'j: ↓').includes('more')).toBe(true)
  // It opens on the top of the page: the figures are the first thing in the room.
  expect(lines(first)[2]?.startsWith('  50m00s session')).toBe(true)
  expect(/↑ \d+ more/.test(rowOf(lines(first), 'j: ↓'))).toBe(false)
  let marker = 0
  let count = first.count
  let last = lines(first)
  // As the hooks do it: a step is allowed while it stays under the count of the last drawing.
  for (let guard = 0; guard < 200 && marker < count; guard++) {
    const layout = paneLayout(data, at('overview', marker), 198, 11, clock)
    last = lines(layout)
    expect(last.length).toBe(11)
    for (const l of last) seen.add(l)
    count = layout.count
    marker += 1
  }
  for (const title of ['Where the time went', 'Over their usual', 'Longest turns', 'Checks', 'Told Claude']) {
    expect([title, [...seen].some(l => l.includes(title))]).toEqual([title, true])
  }
  // The end of the page is the last note, and nothing is left below it.
  expect(last.some(l => l.includes('22:25  slow'))).toBe(true)
  expect(/↓ \d+ more/.test(rowOf(last, 'j: ↓'))).toBe(false)
  expect(/↑ \d+ more/.test(rowOf(last, 'j: ↓'))).toBe(true)
})

test('compact: past the last row that opens a turn, o opens nothing', () => {
  const layout = paneLayout(data, at('overview', 6), 198, 11, clock)
  expect(layout.open).toBe(undefined)
  expect(rowOf(lines(layout), 'j: ↓').includes('o: open turn')).toBe(false)
})

test('compact: every tab fits its room at every width, and a tab without rows to mark still scrolls', () => {
  for (const tab of TABS) {
    for (const [columns, height] of [[198, 11], [80, 9], [40, 8], [120, 25]] as const) {
      const layout = paneLayout(data, at(tab.id, 0), columns, height, clock)
      expect([tab.id, columns, layout.rows.length]).toEqual([tab.id, columns, height])
      expect([tab.id, layout.rows[height - 1]?.key]).toEqual([tab.id, 'keys'])
    }
  }
  const none = parsePane(JSON.stringify({ ...REPORT, session: { ...REPORT.session, checks: [] } }))!
  const short = paneLayout(none, at('checks', 0), 40, 8, clock)
  expect(short.count > 1).toBe(true)
  expect(lines(paneLayout(none, at('checks', short.count - 1), 40, 8, clock)).some(l => l.includes('whoever edited them.'))).toBe(true)
})

test('a full-height pane that is still too short for its page scrolls the same way', () => {
  const layout = paneLayout(data, at('overview', 0), 100, 30, clock)
  const drawn = lines(layout)
  expect(drawn.length).toBe(30)
  expect(drawn[5]?.includes('┌')).toBe(true)
  expect(/↓ \d+ more/.test(rowOf(drawn, 'j: ↓'))).toBe(true)
  expect(layout.count > 4).toBe(true)
})

test('a page that fits has exactly the rows the marker can stand on', () => {
  expect(paneLayout(data, at('overview', 0), 100, 60, clock).count).toBe(4)
  expect(rowOf(draw(at('overview')), 'j: ↓').includes('more')).toBe(false)
})

test('settings: each setting with its value, what is changed and what a project pins', () => {
  const drawn = draw(at('settings', 0), 90)
  expect(said(rowOf(drawn, '── ◇ Settings'))).toBe(' ─ ◇ Settings ─ ~/.claude/claude-timestamp.conf ─')
  const rows = drawn.filter(l => /^ [› ] [A-Z_]+ /.test(l)).map(said)
  expect(rows).toEqual([
    ' › ENABLED on',
    ' TZ local',
    ' DISPLAY_FORMAT short changed',
    ' TIME_COLOR cyan changed',
    ' SLOW_AFTER 7 ⚑ project',
    ' TOOL_TIMING off',
  ])
})

test('settings: the marked setting says what it does, what it accepts and how to change it by hand', () => {
  const drawn = draw(at('settings', 3), 90)
  expect(said(rowOf(drawn, '── ◆ TIME_COLOR'))).toBe(' ─ ◆ TIME_COLOR ─')
  expect(drawn.includes('  Colour of the time.')).toBe(true)
  expect(said(rowOf(drawn, 'accepts'))).toBe(' accepts inherit, none, dim, cyan')
  expect(said(rowOf(drawn, 'default'))).toBe(' default inherit')
  expect(said(rowOf(drawn, 'by hand'))).toBe(' by hand setup.sh --only --time-color=VALUE')
  expect(said(rowOf(draw(at('settings', 1), 90), 'accepts'))).toBe(' accepts a value you type, or local')
  expect(said(rowOf(draw(at('settings', 4), 90), 'accepts'))).toBe(' accepts a value you type')
})

test('settings: a setting the project pins says a change of your own does nothing here', () => {
  const drawn = draw(at('settings', 4), 90).join(' ')
  expect(drawn.includes('⚑ ~/work/app/.claude/claude-timestamp.conf sets this')).toBe(true)
  expect(draw(at('settings', 0), 90).join(' ').includes('sets this')).toBe(false)
})

test('settings: typing a value puts a field where the value stands, on the marked row only', () => {
  const layout = paneLayout(data, at('settings', 1, false, 'TZ'), 90, 60, clock)
  const fields = layout.rows.flatMap(r => r.segments.filter(s => s.field !== undefined).map(s => [r.key, s.field?.value, s.field?.placeholder]))
  expect(fields).toEqual([['setting-TZ', '', 'local']])
  // The marker moved on: the setting named is no longer the marked one, so nothing is being typed.
  expect(paneLayout(data, at('settings', 2, false, 'TZ'), 90, 60, clock).rows.some(r => r.segments.some(s => s.field !== undefined))).toBe(false)
})

test('settings: what the last change came to is said above the list, and the keys are named', () => {
  const drawn = draw(at('settings', 0, false, null, 'TOOL_TIMING is now on. It applies from the next message.'), 90)
  expect(drawn.includes('  TOOL_TIMING is now on. It applies from the next message.')).toBe(true)
  expect(said(rowOf(drawn, 'j: ↓'))).toBe(' j: ↓ k: ↑ e: change t: type a value d: default 1-8: tabs')
})

test('settings: wide, the detail sits beside the list', () => {
  const row = rowOf(draw(at('settings', 0), 160), '── ◇ Settings')
  expect(row.includes('── ◆ ENABLED')).toBe(true)
})

test('doctor: the findings as the doctor lays them out, and its verdict on the rule', () => {
  const drawn = draw(at('doctor'), 90)
  expect(said(rowOf(drawn, '── ◉ Doctor'))).toBe(' ─ ◉ Doctor ─ no problems found ─')
  const from = drawn.findIndex(l => l.includes('── ◉ Doctor'))
  expect(drawn.slice(from + 1).filter(l => l !== '' && !l.includes('j: ↓'))).toEqual(['  Platform', '    uname           Linux', '  Dependencies', '    jq              jq-1.8.2', '  No problems found.'])
  const troubled = parsePane(JSON.stringify({ ...REPORT, doctor: ['Timestamps doctor', '', 'Dependencies', '  jq              not found', '', '1 problem found.'] }))!
  const bad = lines(paneLayout(troubled, at('doctor'), 90, 60, clock))
  expect(said(rowOf(bad, '── ◉ Doctor'))).toBe(' ─ ◉ Doctor ─')
  expect(bad.includes('  1 problem found.')).toBe(true)
})

test('settings and doctor fit a short room, and scroll like every other tab', () => {
  for (const tab of ['settings', 'doctor'] as const) {
    const layout = paneLayout(data, at(tab), 120, 11, clock)
    expect([tab, layout.rows.length, layout.rows[10]?.key]).toEqual([tab, 11, 'keys'])
  }
  expect(paneLayout(data, at('doctor'), 120, 8, clock).count > 1).toBe(true)
})

test('the tab names close up, then shorten, before the row falls back to digits', () => {
  const tabs = (columns: number) => lines(paneLayout(data, at('overview'), columns, 60, clock))[2] ?? ''
  expect(tabs(100)).toBe('  Overview    Turns    Commands    Checks    Told Claude    History    Settings    Doctor')
  expect(tabs(90)).toBe('  Overview   Turns   Commands   Checks   Told Claude   History   Settings   Doctor')
  expect(tabs(80)).toBe('  Overview  Turns  Commands  Checks  Told Claude  History  Settings  Doctor')
  expect(tabs(74)).toBe('  Overview  Turns  Commands  Checks  Told  History  Settings  Doctor')
  expect(tabs(40)).toBe('  1   2   3   4   5   6   7   8')
})
