import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { REPORT, REPORT_JSON } from './pane-fixture.ts'

const PANE = {
  plugin: 'timestamps',
  component: 'Pane' as const,
  requestId: 'timestamps',
  props: {
    title: 'Timestamps',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
}

// The engine beneath the plugin: one report from bash, and panes that open and close.
function world(
  on: On,
  report: () => { exitCode: number; stdout: string } = () => ({ exitCode: 0, stdout: REPORT_JSON }),
  // What setup.sh --only answers a write with; a success unless the test says otherwise.
  write: () => { exitCode: number; stdout: string; stderr: string } = () => ({ exitCode: 0, stdout: 'Wrote ~/.claude/claude-timestamp.conf', stderr: '' }),
) {
  mock.clock(on, { now: 1_700_003_000_000 })
  mock.env(on, { TMPDIR: '/tmp', UID: '1000', HOME: '/home/u' })
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', ($, e) => ({ deny: `ENOENT ${e.path}` }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'timestamps' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const seen = { runs: [] as { argv: readonly string[]; sid: string | undefined }[], open: [] as Record<string, unknown>[], isOpen: false }
  const pane = (seen: { runs: { argv: readonly string[] }[] }) => seen.runs.filter(r => r.argv.includes('--pane'))
  void pane
  on('process.run', ($, e) => {
    const call = e as { argv: readonly string[]; init?: { env?: Record<string, string> } }
    seen.runs.push({ argv: call.argv, sid: call.init?.env?.CLAUDE_CODE_SESSION_ID })
    return { value: call.argv.includes('--only') ? write() : { ...report(), stderr: '' } }
  })
  on('ui.open', ($, e) => {
    seen.open.push(e as Record<string, unknown>)
    seen.isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    seen.isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: seen.isOpen ? [{ id: 'timestamps' }] : [] }))
  return seen
}

type Mounted = { findAll: (q: { type: 'Text' }) => Promise<{ text?: string }[]> }
const texts = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const has = async (ui: Mounted, needle: string) => (await texts(ui)).some(t => t.includes(needle))

test('/timestamps asks bash once, opens the pane on a transparent ground, and closes it again', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const opened = await $.command.run({ command: 'timestamps', args: '' })
  expect(opened.text?.startsWith('Timestamps pane opened.')).toBe(true)
  expect(seen.runs.length).toBe(1)
  expect(seen.runs[0]?.argv.slice(-1)).toEqual(['--pane'])
  expect(seen.runs[0]?.argv[1]?.endsWith('/hooks/scripts/setup.sh')).toBe(true)
  expect(seen.runs[0]?.sid).toBe('s1')
  expect(seen.open[0]?.id).toBe('timestamps')
  // Asked for transparent. The build CI pins predates that argument and drops
  // it on the way to the engine; a newer one passes it through.
  expect(['transparent', undefined].includes(seen.open[0]?.backgroundColor as string | undefined)).toBe(true)
  const closed = await $.command.run({ command: 'timestamps', args: '' })
  expect([closed.text, seen.isOpen]).toEqual(['Timestamps pane closed.', false])
})

test('the pane draws the overview, on every surface', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await has(ui, 'Where the time went')).toBe(true)
    expect(await has(ui, '2.5× usual 1m07s')).toBe(true)
    expect(await has(ui, '50m00s · turn 3 running 3m20s')).toBe(true)
    await ui.unmount()
  }
})

test('a tab is a press or a digit away, and /timestamps with a name opens on it', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'told' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'newest first')).toBe(true)
  await ui.press({ key: 'key-history' })
  expect(await has(ui, 'Past sessions')).toBe(true)
  await ui.press({ key: 'tab-commands' })
  expect(await has(ui, 'slowest first')).toBe(true)
  await ui.unmount()
  const wrong = await $.command.run({ command: 'timestamps', args: 'nonsense' })
  expect(wrong.text).toBe('No tab called "nonsense". The tabs are overview, turns, commands, checks, told, history, settings, doctor.')
})

test('j and k move the marker, never past either end, and o opens the marked turn', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const markedRow = async () => {
    const all = await texts(ui)
    const at = all.findIndex(t => t.startsWith('› '))
    return at < 0 ? '' : (all[at + 1] ?? '')
  }
  expect((await markedRow()).startsWith('bash tools/check-docs.sh')).toBe(true)
  await ui.press({ key: 'up' })
  expect((await markedRow()).startsWith('bash tools/check-docs.sh')).toBe(true)
  await ui.press({ key: 'down' })
  expect((await markedRow()).startsWith('#2')).toBe(true)
  for (let i = 0; i < 9; i++) await ui.press({ key: 'down' })
  expect((await markedRow()).startsWith('#1')).toBe(true)
  await ui.press({ key: 'up' })
  // On turn 3 now: o opens it on the Turns tab, marked there.
  await ui.press({ key: 'open' })
  expect(await has(ui, '#3 · 23:00 → now')).toBe(true)
  await ui.press({ key: 'order' })
  expect(await has(ui, 'longest first')).toBe(true)
  await ui.unmount()
})

test('reload asks bash again and draws what it says now', async ($, on) => {
  let report = REPORT_JSON
  const seen = world(on, () => ({ exitCode: 0, stdout: report }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'told' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  report = JSON.stringify({ ...REPORT, told: [...REPORT.told, { at: 1_700_002_990, kind: 'raised', text: 'Timestamps raised this call\'s limit from 2m00s to 3m30s.' }] })
  await ui.press({ key: 'reload' })
  expect(seen.runs.length).toBe(2)
  expect(await has(ui, 'Timestamps raised this call')).toBe(true)
  await ui.unmount()
})

test('a report that fails opens nothing and says why', async ($, on) => {
  const seen = world(on, () => ({ exitCode: 2, stdout: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'timestamps', args: '' })
  expect(ran.text?.startsWith('Timestamps could not read this session.')).toBe(true)
  expect(seen.open).toEqual([])
})

test('an open pane is read again when a turn ends, a closed one is not', async ($, on) => {
  const seen = world(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ durationMs: 1000 } as never)
  expect(seen.runs.length).toBe(0)
  await $.command.run({ command: 'timestamps', args: '' })
  await $.turn.complete({ durationMs: 1000 } as never)
  expect(seen.runs.length).toBe(2)
})

// The settings write through setup.sh --only; the test stands in for it.
function writes(seen: { runs: { argv: readonly string[] }[] }) {
  return seen.runs.filter(r => r.argv.includes('--only')).map(r => r.argv.slice(2))
}

test('e toggles the marked setting through setup.sh --only, and says what it came to', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'settings' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'change' })
  expect(writes(seen)).toEqual([['--only', '--enabled=off']])
  expect(await has(ui, 'ENABLED is now off. It applies from the next message.')).toBe(true)
  // The pane was read again after the write, so it shows what bash now says.
  expect(seen.runs.filter(r => r.argv.includes('--pane')).length).toBe(2)
  await ui.unmount()
})

test('e moves a choice to its next value, past the empty one by the word for it', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'settings' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (let i = 0; i < 2; i++) await ui.press({ key: 'down' })
  await ui.press({ key: 'change' })
  await ui.press({ key: 'down' })
  await ui.press({ key: 'change' })
  // DISPLAY_FORMAT short -> 12h; TIME_COLOR cyan is the last of its list -> the empty one, said as inherit.
  expect(writes(seen)).toEqual([['--only', '--display=12h'], ['--only', '--time-color=inherit']])
  await ui.unmount()
})

test('d writes the default, and a project pin is mentioned', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'settings' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (let i = 0; i < 4; i++) await ui.press({ key: 'down' })
  await ui.press({ key: 'default' })
  expect(writes(seen)).toEqual([['--only', '--slow-after=60']])
  // The note is long enough to wrap, so only its start is asked for.
  expect(await has(ui, 'SLOW_AFTER is now 60.')).toBe(true)
  expect(await has(ui, 'A project config sets it too')).toBe(true)
  await ui.unmount()
})

test('a value setup.sh refuses is not reported as changed: its own words are shown', async ($, on) => {
  world(on, undefined, () => ({ exitCode: 2, stdout: '', stderr: "--enabled must be on or off, got 'x'.\n" }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'settings' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'change' })
  expect(await has(ui, "--enabled must be on or off, got 'x'.")).toBe(true)
  expect(await has(ui, 'is now')).toBe(false)
  await ui.unmount()
})

test('the doctor tab shows what the doctor found', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timestamps', args: 'doctor' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await has(ui, 'No problems found.')).toBe(true)
  expect(await has(ui, 'jq-1.8.2')).toBe(true)
  await ui.unmount()
})
