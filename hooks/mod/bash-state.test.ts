import { expect, test } from 'claude-code/testing'
import { readBashState, readCommandsFile, readTimelineFiles } from './bash-state.ts'
import type { Host } from './bash-state.ts'

const DIR = '/tmp/x/claude-timestamp-1000'

function host(files: Record<string, string>, env: Record<string, string> = {}, uid: string | undefined = '1000'): Host {
  const vars: Record<string, string> = { TMPDIR: '/tmp/x/', HOME: '/home/u', ...env }
  return {
    env: async name => vars[name],
    sessionId: async () => 'ab.c/../d-1',
    read: async path => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    uid: async () => uid,
  }
}

test('reads every staged flag', async () => {
  const h = host({
    [`${DIR}/abcd-1.enabled`]: 'on',
    [`${DIR}/abcd-1.live`]: 'on',
    [`${DIR}/abcd-1.start`]: '1700000000',
    [`${DIR}/abcd-1.livetool`]: '30',
    [`${DIR}/abcd-1.project`]: 'app',
    [`${DIR}/abcd-1.cmdmem`]: 'on',
  })
  expect(await readBashState(h)).toEqual({
    isOn: true,
    sessionStartedAt: 1700000000000,
    slowToolAfter: 30,
    project: 'app',
    isCommandMemoryOn: true,
  })
})

test('no uid, or one that is not a number, is off', async () => {
  expect((await readBashState(host({ [`${DIR}/abcd-1.enabled`]: 'on' }, {}, ''))).isOn).toBe(false)
  expect((await readBashState(host({ [`${DIR}/abcd-1.enabled`]: 'on' }, {}, 'nope'))).isOn).toBe(false)
})

test('nothing staged yet: off, defaults, no throw', async () => {
  expect(await readBashState(host({}))).toEqual({
    isOn: false,
    sessionStartedAt: undefined,
    slowToolAfter: 60,
    project: undefined,
    isCommandMemoryOn: false,
  })
})

test('a missing .live counts as on', async () => {
  expect((await readBashState(host({ [`${DIR}/abcd-1.enabled`]: 'on' }))).isOn).toBe(true)
})

test('LIVE=off is off', async () => {
  expect((await readBashState(host({ [`${DIR}/abcd-1.enabled`]: 'on', [`${DIR}/abcd-1.live`]: 'off' }))).isOn).toBe(false)
})

test('garbled values fall back', async () => {
  const s = await readBashState(
    host({
      [`${DIR}/abcd-1.enabled`]: 'on',
      [`${DIR}/abcd-1.start`]: '17x',
      [`${DIR}/abcd-1.livetool`]: '-3',
      [`${DIR}/abcd-1.project`]: '-',
    }),
  )
  expect([s.sessionStartedAt, s.slowToolAfter, s.project]).toEqual([undefined, 60, undefined])
})

test('a host that throws everywhere is off, not a throw', async () => {
  const boom = async () => {
    throw new Error('boom')
  }
  expect((await readBashState({ env: boom, sessionId: boom, read: boom, uid: boom })).isOn).toBe(false)
})

test('the commands file honours CLAUDE_TIMESTAMP_COMMANDS', async () => {
  expect(await readCommandsFile(host({ '/c.tsv': 'row' }, { CLAUDE_TIMESTAMP_COMMANDS: '/c.tsv' }))).toBe('row')
})

test('the commands file defaults beside the config', async () => {
  expect(await readCommandsFile(host({ '/home/u/.claude/claude-timestamp-commands-v2.tsv': 'row' }))).toBe('row')
})

test('an unreadable commands file reads empty', async () => {
  expect(await readCommandsFile(host({}))).toBe('')
})

test('the timeline reads the turn log, the calls log, the open turn and the zone', async () => {
  const h = host({
    [`${DIR}/abcd-1`]: '5500\n',
    [`${DIR}/abcd-1.turnlog`]: 'turns',
    [`${DIR}/abcd-1.calls`]: 'calls',
    [`${DIR}/abcd-1.tz`]: 'Europe/Amsterdam\n',
    [`${DIR}/abcd-1.project`]: 'app',
    [`${DIR}/abcd-1.cmdmem`]: 'on',
  })
  expect(await readTimelineFiles(h)).toEqual({
    turnlog: 'turns',
    calls: 'calls',
    openStart: 5500,
    tz: 'Europe/Amsterdam',
    project: 'app',
    isCommandMemoryOn: true,
  })
})

test('a closed turn is not an open one', async () => {
  const h = host({ [`${DIR}/abcd-1`]: '5500', [`${DIR}/abcd-1.closed`]: '', [`${DIR}/abcd-1.turnlog`]: 'turns' })
  expect((await readTimelineFiles(h))?.openStart).toBe(undefined)
})

test('a session with nothing recorded reads as empty logs', async () => {
  expect(await readTimelineFiles(host({}))).toEqual({
    turnlog: '',
    calls: '',
    openStart: undefined,
    tz: undefined,
    project: undefined,
    isCommandMemoryOn: false,
  })
})

test('no state directory, no timeline', async () => {
  // A default parameter would turn an undefined uid back into the fake one.
  expect(await readTimelineFiles({ ...host({}), uid: async () => undefined })).toBe(undefined)
})
