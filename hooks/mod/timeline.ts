// The timeline pane's model: this session turn by turn, and under each turn
// the calls that took its time. Built from two files bash keeps, the turn log
// (ct_turn_log, lib/state.sh) and the calls log (post-tool-use.sh), and drawn
// as plain lines so the same answer suits every surface. Nothing here reads
// or draws: live.tsx does both.
import { formatDuration } from './format.ts'

export type Outcome = 'ok' | 'fail' | 'limit'

export type TimelineCall = {
  /** epoch seconds */
  endedAt: number
  ms: number
  tool: string
  /** the command-memory key; absent for a chain or another tool */
  key?: string
  outcome: Outcome
  isSubagent: boolean
  /** the usual seconds of this command here, when the memory has one */
  usualS?: number
}

export type TimelineTurn = {
  n: number
  /** epoch seconds */
  startedAt: number
  secs: number
  how: 'stop' | 'interrupted' | 'error' | 'running'
  calls: TimelineCall[]
}

export type Timeline = { turns: TimelineTurn[] }

export type Line = { tone: 'head' | 'plain' | 'dim' | 'warn'; text: string }

const MAX_CALLS = 8
// A call this far over its usual time is marked, the band's own factor.
const OVER_USUAL = 1.5
// Their whole duration is the person's own time.
const INTERACTIVE = new Set(['AskUserQuestion', 'ExitPlanMode'])

const isWhole = (s: string | undefined): s is string => s !== undefined && /^[0-9]+$/.test(s)

function parseTurns(text: string): TimelineTurn[] {
  const turns: TimelineTurn[] = []
  for (const line of text.split('\n')) {
    const f = line.replace(/\r$/, '').split('\t')
    const [n, start, end, secs] = f
    const how = f[8]
    if (!isWhole(n) || !isWhole(start) || !isWhole(end) || !isWhole(secs)) continue
    if (how !== 'stop' && how !== 'interrupted' && how !== 'error') continue
    turns.push({ n: Number(n), startedAt: Number(start), secs: Number(secs), how, calls: [] })
  }
  return turns
}

function parseCalls(text: string, usualOf: (key: string) => number | undefined): TimelineCall[] {
  const calls: TimelineCall[] = []
  for (const line of text.split('\n')) {
    const [end, ms, tool, key, outcome, agent] = line.replace(/\r$/, '').split('\t')
    if (!isWhole(end) || !isWhole(ms) || !tool) continue
    if (outcome !== 'ok' && outcome !== 'fail' && outcome !== 'limit') continue
    const named = key !== undefined && key !== '' && key !== '-' ? key : undefined
    calls.push({
      endedAt: Number(end),
      ms: Number(ms),
      tool,
      key: named,
      outcome,
      isSubagent: agent === '1',
      usualS: named === undefined ? undefined : usualOf(named),
    })
  }
  return calls
}

// openStart is the start bash holds for a turn still running, epoch seconds;
// undefined between turns. The same start already in the log is a turn that
// has since closed, read a moment apart.
export function buildTimeline(
  turnlog: string,
  callsLog: string,
  openStart: number | undefined,
  now: number,
  usualOf: (key: string) => number | undefined,
): Timeline {
  const turns = parseTurns(turnlog)
  const last = turns[turns.length - 1]
  if (
    openStart !== undefined &&
    !turns.some(t => t.startedAt === openStart) &&
    (last === undefined || openStart >= last.startedAt + last.secs)
  ) {
    turns.push({ n: (last?.n ?? 0) + 1, startedAt: openStart, secs: Math.max(0, now - openStart), how: 'running', calls: [] })
  }
  for (const call of parseCalls(callsLog, usualOf)) {
    // A call is filed by when it ended; two seconds of slack for the hook
    // that wrote it running just after the turn closed.
    const turn = turns.find(t =>
      t.how === 'running' ? call.endedAt >= t.startedAt : call.endedAt >= t.startedAt && call.endedAt <= t.startedAt + t.secs + 2,
    )
    turn?.calls.push(call)
  }
  return { turns }
}

function callName(call: TimelineCall): string {
  const what = call.key ?? (call.tool === 'Bash' ? 'Bash, several commands' : call.tool)
  if (INTERACTIVE.has(call.tool)) return `${what} (your answer)`
  return call.isSubagent ? `${what} (subagent)` : what
}

function callLine(call: TimelineCall): Line {
  const took = formatDuration(call.ms / 1000).padStart(9)
  const name = callName(call)
  if (call.outcome === 'limit') return { tone: 'warn', text: `${took}  ${name}  ■ stopped at its limit` }
  if (call.outcome === 'fail') return { tone: 'warn', text: `${took}  ${name}  ✗ failed` }
  const usual = call.usualS
  if (usual !== undefined && usual >= 1) {
    const ratio = call.ms / 1000 / usual
    if (ratio >= OVER_USUAL) {
      return { tone: 'warn', text: `${took}  ${name}  ▲ ${ratio.toFixed(1)}× usual ${formatDuration(usual)}` }
    }
    return { tone: 'plain', text: `${took}  ${name}  usually ${formatDuration(usual)}` }
  }
  return { tone: 'plain', text: `${took}  ${name}` }
}

function turnLines(turn: TimelineTurn, clock: (epoch: number) => string): Line[] {
  const listedS = Math.floor(turn.calls.reduce((sum, c) => sum + c.ms, 0) / 1000)
  let head = `#${turn.n}  ${clock(turn.startedAt)}  ${formatDuration(turn.secs)}`
  if (turn.calls.length > 0) {
    head += ` · ${formatDuration(listedS)} in ${turn.calls.length} listed ${turn.calls.length === 1 ? 'call' : 'calls'}`
  }
  if (turn.how === 'running') head += ' · running'
  if (turn.how === 'interrupted') head += ' · interrupted'
  if (turn.how === 'error') head += ' · ended in an error'
  const lines: Line[] = [{ tone: 'head', text: head }]
  const byLength = [...turn.calls].sort((a, b) => b.ms - a.ms)
  for (const call of byLength.slice(0, MAX_CALLS)) lines.push(callLine(call))
  if (byLength.length > MAX_CALLS) {
    lines.push({ tone: 'dim', text: `${' '.repeat(11)}+ ${byLength.length - MAX_CALLS} more listed calls` })
  }
  // Calls that ran side by side add up to more than the turn: then there is
  // no remainder to name. A running turn's remainder is still moving.
  const rest = turn.secs - listedS
  if (turn.calls.length > 0 && rest >= 1 && turn.how !== 'running') {
    lines.push({ tone: 'dim', text: `${formatDuration(rest).padStart(9)}  the rest: thinking, writing, calls under 5s` })
  }
  return lines
}

export function timelineLines(
  timeline: Timeline,
  options: { columns: number; byTime: boolean; clock: (epoch: number) => string },
): Line[] {
  const { turns } = timeline
  if (turns.length === 0) return [{ tone: 'dim', text: 'No turns recorded yet.' }]
  const first = turns[0]
  const working = turns.reduce((sum, t) => sum + t.secs, 0)
  const lines: Line[] = [
    {
      tone: 'dim',
      text: `${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} · ${formatDuration(working)} working${
        first === undefined ? '' : ` · since ${options.clock(first.startedAt)}`
      }`,
    },
  ]
  const ordered = options.byTime ? [...turns].sort((a, b) => b.secs - a.secs) : turns
  for (const turn of ordered) lines.push(...turnLines(turn, options.clock))
  const width = Math.max(1, Math.floor(options.columns))
  return lines.map(l => ({ tone: l.tone, text: [...l.text].slice(0, width).join('') }))
}

// Hour and minute, in the zone the plugin was configured with (the tz flag
// bash stages), else the machine's. A zone the platform does not know falls
// back to the machine's rather than failing the drawing.
export function clockOf(tz: string | undefined): (epoch: number) => string {
  const make = (timeZone: string | undefined) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
  let format: Intl.DateTimeFormat
  try {
    format = make(tz || undefined)
  } catch {
    format = make(undefined)
  }
  return epoch => format.format(new Date(epoch * 1000))
}
