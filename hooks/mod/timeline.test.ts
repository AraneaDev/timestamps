import { expect, test } from 'claude-code/testing'
import { buildTimeline, clockOf, timelineLines } from './timeline.ts'

// The turnlog's nine fields: n, start, end, secs, tools, tool secs, slowest, heartbeats, how.
const TURNLOG = [
  '1\t1000\t1100\t100\t-\t-\t-\t0\tstop',
  '2\t2000\t3800\t1800\t-\t-\t-\t1\tstop',
  '3\t4000\t4020\t20\t-\t-\t-\t0\tinterrupted',
  'torn\t1',
  '4\t5000\t5010\t10\t-\t-\t-\t0\tnonsense',
].join('\n')

// The calls log's six fields: end, ms, tool, key, outcome, subagent.
const CALLS = [
  '2100\t71000\tBash\tbash tests/run.sh\tok\t0',
  '2400\t167000\tBash\tbash tools/check-docs.sh\tok\t0',
  '2500\t120010\tBash\tbash tests/run.sh\tlimit\t0',
  '2600\t9000\tWebFetch\t-\tfail\t0',
  '2700\t30000\tBash\t-\tok\t1',
  '9999\t5000\tBash\tmake\tok\t0',
  'garbage',
  '2800\tabc\tBash\tmake\tok\t0',
].join('\n')

const USUAL: Record<string, number> = { 'bash tests/run.sh': 65, 'bash tools/check-docs.sh': 67 }
const usualOf = (key: string) => USUAL[key]
const clock = (epoch: number) => `@${epoch}`

test('turns come from the turn log, whole lines only', () => {
  const tl = buildTimeline(TURNLOG, '', undefined, 6000, usualOf)
  expect(tl.turns.map(t => [t.n, t.startedAt, t.secs, t.how])).toEqual([
    [1, 1000, 100, 'stop'],
    [2, 2000, 1800, 'stop'],
    [3, 4000, 20, 'interrupted'],
  ])
})

test('the open turn is last, running since its start', () => {
  const tl = buildTimeline(TURNLOG, '', 5500, 5560, usualOf)
  expect(tl.turns.at(-1)).toEqual({ n: 4, startedAt: 5500, secs: 60, how: 'running', calls: [] })
})

test('a start the log already closed is not an open turn', () => {
  expect(buildTimeline(TURNLOG, '', 4000, 6000, usualOf).turns.length).toBe(3)
})

test('each call lands in the turn it ended in, with its usual time', () => {
  const tl = buildTimeline(TURNLOG, CALLS, undefined, 6000, usualOf)
  const second = tl.turns[1]
  expect(second?.calls.map(c => [c.key ?? c.tool, c.ms, c.outcome, c.usualS, c.isSubagent])).toEqual([
    ['bash tests/run.sh', 71000, 'ok', 65, false],
    ['bash tools/check-docs.sh', 167000, 'ok', 67, false],
    ['bash tests/run.sh', 120010, 'limit', 65, false],
    ['WebFetch', 9000, 'fail', undefined, false],
    ['Bash', 30000, 'ok', undefined, true],
  ])
  // One that ended in no turn, and the two broken lines, are in none.
  expect(tl.turns.flatMap(t => t.calls).length).toBe(5)
})

test('a call that ended during the open turn belongs to it', () => {
  const tl = buildTimeline(TURNLOG, '5520\t7000\tBash\tmake\tok\t0', 5500, 5560, usualOf)
  expect(tl.turns.at(-1)?.calls.map(c => c.key)).toEqual(['make'])
})

test('the lines: a header, each turn, its calls longest first, and the rest', () => {
  const tl = buildTimeline(TURNLOG, CALLS, undefined, 6000, usualOf)
  expect(timelineLines(tl, { columns: 120, byTime: false, clock }).map(l => `${l.tone}|${l.text}`)).toEqual([
    'dim|3 turns · 32m00s working · since @1000',
    'head|#1  @1000  1m40s',
    'head|#2  @2000  30m00s · 6m37s in 5 listed calls',
    'warn|    2m47s  bash tools/check-docs.sh  ▲ 2.5× usual 1m07s',
    'warn|    2m00s  bash tests/run.sh  ■ stopped at its limit',
    'plain|    1m11s  bash tests/run.sh  usually 1m05s',
    'plain|      30s  Bash, several commands (subagent)',
    'warn|       9s  WebFetch  ✗ failed',
    'dim|   23m23s  the rest: thinking, writing, calls under 5s',
    'head|#3  @4000  20s · interrupted',
  ])
})

test('longest first puts the turns in order of their length', () => {
  const tl = buildTimeline(TURNLOG, '', 5500, 5560, usualOf)
  const heads = timelineLines(tl, { columns: 120, byTime: true, clock }).filter(l => l.tone === 'head')
  expect(heads.map(l => l.text)).toEqual(['#2  @2000  30m00s', '#1  @1000  1m40s', '#4  @5500  1m00s · running', '#3  @4000  20s · interrupted'])
})

test('more than eight calls in a turn: the eight longest, and a count', () => {
  const many = Array.from({ length: 11 }, (_, i) => `${2100 + i}\t${(i + 6) * 1000}\tBash\tk${i}\tok\t0`).join('\n')
  const lines = timelineLines(buildTimeline(TURNLOG, many, undefined, 6000, usualOf), { columns: 120, byTime: false, clock })
  expect(lines.filter(l => /^\s+\d+s {2}k\d+/.test(l.text)).length).toBe(8)
  expect(lines.some(l => l.text.trim() === '+ 3 more listed calls')).toBe(true)
})

test('calls that overlapped leave no rest to show', () => {
  const overlap = ['2100\t1500000\tBash\ta\tok\t0', '2200\t1500000\tBash\tb\tok\t1'].join('\n')
  const lines = timelineLines(buildTimeline(TURNLOG, overlap, undefined, 6000, usualOf), { columns: 120, byTime: false, clock })
  expect(lines.some(l => l.text.includes('the rest'))).toBe(false)
})

test('a line never runs past the pane', () => {
  const tl = buildTimeline(TURNLOG, CALLS, undefined, 6000, usualOf)
  for (const l of timelineLines(tl, { columns: 24, byTime: false, clock })) expect([...l.text].length <= 24).toBe(true)
})

test('nothing recorded says so', () => {
  expect(timelineLines(buildTimeline('', '', undefined, 6000, usualOf), { columns: 80, byTime: false, clock })).toEqual([
    { tone: 'dim', text: 'No turns recorded yet.' },
  ])
})

test('the clock is the hour and minute in the zone bash was given', () => {
  expect(clockOf('UTC')(1_700_000_000)).toBe('22:13')
  expect(clockOf('Asia/Tokyo')(1_700_000_000)).toBe('07:13')
  // A zone the platform does not know falls back rather than throwing.
  expect(/^\d\d:\d\d$/.test(clockOf('Not/AZone')(1_700_000_000))).toBe(true)
  expect(/^\d\d:\d\d$/.test(clockOf(undefined)(1_700_000_000))).toBe(true)
})
