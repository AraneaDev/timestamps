import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/tmp/claude-timestamp-1000'
const PANE = {
  plugin: 'timestamps',
  component: 'Pane' as const,
  requestId: 'timestamps-timeline',
  props: {
    title: 'Timeline',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}
// 1_700_000_000 is 22:13 UTC. Two turns: the first with one slow call, far
// over its usual 40s; the second longer and without any.
const TURNLOG = ['1\t1700000000\t1700000100\t100\t-\t-\t-\t0\tstop', '2\t1700000200\t1700000500\t300\t-\t-\t-\t0\tstop'].join('\n')
const CALLS = '1700000080\t71000\tBash\tnpm test\tok\t0'
const TSV = ['1\tapp\tnpm test\t40000\tok', '2\tapp\tnpm test\t40000\tok', '3\tapp\tnpm test\t40000\tok'].join('\n')

function world(on: On, files: Record<string, string>, env: Record<string, string> = { TMPDIR: '/tmp', UID: '1000', HOME: '/home/u' }) {
  mock.clock(on, { now: 1_700_000_600_000 })
  mock.env(on, env)
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'timeline' } }))
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(String((e as { id?: unknown }).id))
    return { value: { isPlaced: true } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return { opened }
}

const RECORDED = {
  [`${DIR}/s1.enabled`]: 'on',
  [`${DIR}/s1.live`]: 'on',
  [`${DIR}/s1.project`]: 'app',
  [`${DIR}/s1.cmdmem`]: 'on',
  [`${DIR}/s1.tz`]: 'UTC',
  [`${DIR}/s1.closed`]: '',
  [`${DIR}/s1.turnlog`]: TURNLOG,
  [`${DIR}/s1.calls`]: CALLS,
  '/home/u/.claude/claude-timestamp-commands-v2.tsv': TSV,
}

const texts = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

test('/timeline opens the pane on what bash recorded', async ($, on) => {
  const { opened } = world(on, RECORDED)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'timeline', args: '' })
  expect(ran.text?.startsWith('Timeline opened.')).toBe(true)
  expect(opened).toEqual(['timestamps-timeline'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const drawn = await texts(ui)
    expect(drawn.filter(t => /^(\d+ turn|#| +\d)/.test(t))).toEqual([
      '2 turns · 6m40s working · since 22:13',
      '#1  22:13  1m40s · 1m11s in 1 listed call',
      '    1m11s  npm test  ▲ 1.8× usual 40s',
      '      29s  the rest: thinking, writing, calls under 5s',
      '#2  22:16  5m00s',
    ])
    await ui.unmount()
  }
})

test('the order button puts the longest turn first, and back', async ($, on) => {
  world(on, RECORDED)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timeline', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const heads = async () => (await texts(ui)).filter(t => t.startsWith('#')).map(t => t.slice(0, 2))
  expect(await heads()).toEqual(['#1', '#2'])
  await ui.press({ key: 'order' })
  expect(await heads()).toEqual(['#2', '#1'])
  await ui.press({ key: 'order' })
  expect(await heads()).toEqual(['#1', '#2'])
  await ui.unmount()
})

test('/timeline longest opens it longest first', async ($, on) => {
  world(on, RECORDED)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timeline', args: 'longest' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await texts(ui)).filter(t => t.startsWith('#')).map(t => t.slice(0, 2))).toEqual(['#2', '#1'])
  await ui.unmount()
})

test('read again picks up what bash has written since', async ($, on) => {
  const files: Record<string, string> = { ...RECORDED }
  world(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'timeline', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  files[`${DIR}/s1.turnlog`] = `${TURNLOG}\n3\t1700000520\t1700000540\t20\t-\t-\t-\t0\tinterrupted`
  await ui.press({ key: 'reload' })
  expect((await texts(ui)).some(t => t === '#3  22:22  20s · interrupted')).toBe(true)
  await ui.unmount()
})

test('a session with no state directory says so and opens nothing', async ($, on) => {
  // No UID in the environment and an id -u that fails: nowhere to look.
  const { opened } = world(on, {}, { TMPDIR: '/tmp', HOME: '/home/u' })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'timeline', args: '' })
  expect(ran.text).toBe('Timestamps has recorded nothing for this session yet.')
  expect(opened).toEqual([])
})

test('before /timeline has run, the pane says how to fill it', async ($, on) => {
  world(on, RECORDED)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toEqual(['Run /timeline to read this session.'])
  await ui.unmount()
})
