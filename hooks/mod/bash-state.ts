// What bash staged for this session, read the way ct_state_file_var and
// ct_read_flag_var address it. Every read can fail (first prompt not yet
// staged, a session older than the LIVE setting, a pruned file): a failure is
// "unknown", never a throw, so the live layer only ever gets quieter.
// The four things read here, as an interface rather than $ itself: the
// engine follows $ only into functions of the file that holds the hook, so
// live.ts adapts its $ to this, and the tests pass plain fakes.
export type EnvName = 'TMPDIR' | 'UID' | 'HOME' | 'CLAUDE_TIMESTAMP_COMMANDS'

export type Host = {
  env: (name: EnvName) => Promise<string | undefined>
  sessionId: () => Promise<string>
  read: (path: string) => Promise<string>
  /** the uid bash names its state directory with; undefined when unknown */
  uid: () => Promise<string | undefined>
}

export type BashState = {
  isOn: boolean
  sessionStartedAt?: number
  slowToolAfter: number
  project?: string
  isCommandMemoryOn: boolean
}

const DEFAULT_SLOW_TOOL_AFTER = 60
const FLAGS = ['enabled', 'live', 'start', 'livetool', 'project', 'cmdmem'] as const

async function stateDir(h: Host): Promise<string | undefined> {
  const tmp = ((await h.env('TMPDIR')) || '/tmp').replace(/\/+$/, '')
  const uid = await h.uid()
  if (!uid || !/^[0-9]+$/.test(uid)) return undefined
  return `${tmp}/claude-timestamp-${uid}`
}

async function readFlag(h: Host, base: string, name: string): Promise<string | undefined> {
  try {
    const text = (await h.read(`${base}.${name}`)).trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

const whole = (s: string | undefined) => (s !== undefined && /^[0-9]+$/.test(s) ? Number(s) : undefined)

export async function readBashState(h: Host): Promise<BashState> {
  const off: BashState = { isOn: false, slowToolAfter: DEFAULT_SLOW_TOOL_AFTER, isCommandMemoryOn: false }
  try {
    const dir = await stateDir(h)
    const sid = (await h.sessionId()).replace(/[^A-Za-z0-9_-]/g, '')
    if (!dir || !sid) return off
    const base = `${dir}/${sid}`
    const [enabled, live, start, livetool, project, cmdmem] = await Promise.all(FLAGS.map(n => readFlag(h, base, n)))
    const startS = whole(start)
    return {
      isOn: enabled === 'on' && live !== 'off',
      sessionStartedAt: startS === undefined ? undefined : startS * 1000,
      slowToolAfter: whole(livetool) ?? DEFAULT_SLOW_TOOL_AFTER,
      project: project && project !== '-' ? project : undefined,
      isCommandMemoryOn: cmdmem === 'on',
    }
  } catch {
    return off
  }
}

export async function readCommandsFile(h: Host): Promise<string> {
  try {
    const path =
      (await h.env('CLAUDE_TIMESTAMP_COMMANDS')) ||
      `${(await h.env('HOME')) ?? ''}/.claude/claude-timestamp-commands-v2.tsv`
    return await h.read(path)
  } catch {
    return ''
  }
}

// What the timeline pane is drawn from: the session's turn log and calls log
// as bash wrote them, the start of a turn still open, and what is needed to
// show them (the configured zone, the project the usual times are filed
// under). A file that is not there reads as empty: a session before its
// first turn has a timeline with nothing in it, not an error.
export type TimelineFiles = {
  turnlog: string
  calls: string
  /** epoch seconds of the open turn; undefined between turns */
  openStart?: number
  tz?: string
  project?: string
  isCommandMemoryOn: boolean
}

export async function readTimelineFiles(h: Host): Promise<TimelineFiles | undefined> {
  try {
    const dir = await stateDir(h)
    const sid = (await h.sessionId()).replace(/[^A-Za-z0-9_-]/g, '')
    if (!dir || !sid) return undefined
    const base = `${dir}/${sid}`
    const text = (path: string) => h.read(path).catch(() => '')
    // The marker's presence is the answer, so an empty file counts.
    const isClosed = await h.read(`${base}.closed`).then(
      () => true,
      () => false,
    )
    const [turnlog, calls, open, tz, project, cmdmem] = await Promise.all([
      text(`${base}.turnlog`),
      text(`${base}.calls`),
      isClosed ? Promise.resolve(undefined) : text(base).then(t => t.trim() || undefined),
      readFlag(h, base, 'tz'),
      readFlag(h, base, 'project'),
      readFlag(h, base, 'cmdmem'),
    ])
    return {
      turnlog,
      calls,
      openStart: whole(open),
      tz,
      project: project && project !== '-' ? project : undefined,
      isCommandMemoryOn: cmdmem === 'on',
    }
  } catch {
    return undefined
  }
}
