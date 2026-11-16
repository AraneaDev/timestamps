// The pane's data: `setup.sh --pane`'s JSON read into the shape the views
// draw, and the figures several views share. Bash measured and recorded all
// of it; this only reads and arranges. A document that is not the expected
// shape yields nothing rather than a half-drawn pane, and a list entry that
// is not whole is left out, as bash leaves out a torn line.
import type { PaneCall, PaneCheck, PaneCommand, PaneData, PaneNote, PaneOutcome, PaneSession, PaneSetting, PaneTurn } from '../../types'

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const outcome = (v: unknown): PaneOutcome | undefined => (v === 'ok' || v === 'fail' || v === 'limit' ? v : undefined)

function each<T>(v: unknown, read: (o: Json) => T | undefined): T[] {
  const out: T[] = []
  for (const item of list(v)) {
    if (!isObject(item)) continue
    const one = read(item)
    if (one !== undefined) out.push(one)
  }
  return out
}

const HOW: Record<string, PaneTurn['how']> = { stop: 'stop', interrupted: 'interrupted', error: 'error', open: 'running' }

export function parsePane(json: string): PaneData | undefined {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!isObject(doc)) return undefined
  const now = num(doc.now)
  if (now === undefined) return undefined
  const session = isObject(doc.session) ? doc.session : undefined
  const settings = isObject(doc.settings) ? doc.settings : {}
  return {
    now,
    project: text(doc.project) ?? null,
    hasSession: session !== undefined,
    started: num(session?.started) ?? null,
    elapsed: num(session?.elapsed) ?? 0,
    waiting: num(session?.waiting) ?? 0,
    away: num(session?.away) ?? 0,
    turns: each(session?.turns, (o): PaneTurn | undefined => {
      const n = num(o.n)
      const start = num(o.start)
      const secs = num(o.secs)
      const how = typeof o.how === 'string' ? HOW[o.how] : undefined
      return n === undefined || start === undefined || secs === undefined || how === undefined ? undefined : { n, start, secs, how }
    }),
    calls: each(doc.calls, (o): PaneCall | undefined => {
      const at = num(o.at)
      const ms = num(o.ms)
      const tool = text(o.tool)
      const how = outcome(o.outcome)
      return at === undefined || ms === undefined || tool === undefined || how === undefined
        ? undefined
        : { at, ms, tool, key: text(o.key) ?? null, outcome: how, isSubagent: o.subagent === true }
    }),
    checks: each(session?.checks, (o): PaneCheck | undefined => {
      const key = text(o.key)
      const at = num(o.at)
      const how = outcome(o.outcome)
      return key === undefined || at === undefined || how === undefined ? undefined : { key, outcome: how, at, changed: num(o.changed) ?? null }
    }),
    commands: each(doc.commands, (o): PaneCommand | undefined => {
      const key = text(o.key)
      const runs = num(o.runs)
      return key === undefined || runs === undefined
        ? undefined
        : {
            key,
            runs,
            medianMs: num(o.median_ms) ?? 0,
            lastMs: num(o.last_ms) ?? 0,
            failed: num(o.failed) ?? 0,
            stopped: num(o.stopped) ?? 0,
            limitMs: num(o.limit_ms) ?? 0,
            maxMs: num(o.max_ms) ?? 0,
          }
    }),
    told: each(doc.told, (o): PaneNote | undefined => {
      const at = num(o.at)
      const kind = text(o.kind)
      const said = text(o.text)
      return at === undefined || kind === undefined || said === undefined ? undefined : { at, kind, text: said }
    }),
    history: each(doc.history, (o): PaneSession | undefined => {
      const when = text(o.when)
      const secs = num(o.secs)
      return when === undefined || secs === undefined
        ? undefined
        : { when, secs, turns: num(o.turns) ?? 0, waited: num(o.waited) ?? 0, idle: num(o.idle) ?? 0, project: text(o.project) ?? null }
    }),
    tz: text(settings.tz) ?? null,
    settings: each(doc.config, (o): PaneSetting | undefined => {
      const key = text(o.key)
      const flag = text(o.flag)
      const kind = o.kind === 'toggle' || o.kind === 'choice' || o.kind === 'text' ? o.kind : undefined
      return key === undefined || flag === undefined || kind === undefined
        ? undefined
        : {
            key,
            flag,
            // An empty value is a value: a timezone left to the machine, a colour that follows another.
            value: typeof o.value === 'string' ? o.value : '',
            def: typeof o.default === 'string' ? o.default : '',
            values: list(o.values).filter((v): v is string => typeof v === 'string'),
            describes: typeof o.describes === 'string' ? o.describes : '',
            kind,
            empty: text(o.empty) ?? null,
            isPinned: o.pinned === true,
          }
    }),
    configFile: text(doc.config_file) ?? null,
    projectConfig: text(doc.project_config) ?? null,
    doctor: list(doc.doctor).filter((l): l is string => typeof l === 'string'),
  }
}

// A call this far over its usual time is marked, the band's own factor.
export const OVER_USUAL = 1.5
// The memory quotes a usual time from three finished runs, as bash does.
const MIN_RUNS = 3
// Their whole duration is the person's own time.
const INTERACTIVE = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** What a call is listed as: its command key, or its tool where it has none. */
export function callName(call: PaneCall): string {
  const what = call.key ?? (call.tool === 'Bash' ? 'Bash, several commands' : call.tool)
  if (INTERACTIVE.has(call.tool)) return `${what} (your answer)`
  return call.isSubagent ? `${what} (subagent)` : what
}

/** The usual seconds of each remembered command, where the memory has enough runs to say. */
export function usualOf(data: PaneData): Map<string, number> {
  const usual = new Map<string, number>()
  for (const c of data.commands) if (c.runs >= MIN_RUNS) usual.set(c.key, Math.floor(c.medianMs / 1000))
  return usual
}

/**
 * Each turn's calls, by the turn's number. A call is filed by when it ended,
 * with two seconds of slack for the hook that wrote it running just after
 * the turn closed; one that ended in no turn is in none.
 */
export function callsByTurn(data: PaneData): Map<number, PaneCall[]> {
  const byTurn = new Map<number, PaneCall[]>()
  for (const call of data.calls) {
    const turn = data.turns.find(t => (t.how === 'running' ? call.at >= t.start : call.at >= t.start && call.at <= t.start + t.secs + 2))
    if (turn === undefined) continue
    const mine = byTurn.get(turn.n)
    if (mine === undefined) byTurn.set(turn.n, [call])
    else mine.push(call)
  }
  return byTurn
}

export type OverUsual = { call: PaneCall; usual: number; ratio: number; turn: number | undefined }

/** The calls that ran well over their usual time, furthest over first. */
export function overUsual(data: PaneData): OverUsual[] {
  const usual = usualOf(data)
  const byTurn = callsByTurn(data)
  const turnOf = (call: PaneCall) => [...byTurn.entries()].find(([, calls]) => calls.includes(call))?.[0]
  const out: OverUsual[] = []
  for (const call of data.calls) {
    if (call.key === null || call.outcome === 'limit') continue
    const u = usual.get(call.key)
    if (u === undefined || u < 1) continue
    const ratio = call.ms / 1000 / u
    if (ratio >= OVER_USUAL) out.push({ call, usual: u, ratio, turn: turnOf(call) })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}

/** The seconds the session's turns took, added up. */
export const workingSeconds = (data: PaneData): number => data.turns.reduce((sum, t) => sum + t.secs, 0)

export type Share = { name: string; ms: number; count: number }

/** Where the listed calls' time went, by what they are listed as, most first. */
export function composition(calls: readonly PaneCall[]): Share[] {
  const shares = new Map<string, Share>()
  for (const call of calls) {
    const name = callName(call)
    const share = shares.get(name)
    if (share === undefined) shares.set(name, { name, ms: call.ms, count: 1 })
    else {
      share.ms += call.ms
      share.count += 1
    }
  }
  return [...shares.values()].sort((a, b) => b.ms - a.ms)
}

export type Day = { date: string; sessions: number; secs: number; waited: number; turns: number }

/** The recorded sessions by the day they ended, newest day first. */
export function days(history: readonly PaneSession[]): Day[] {
  const byDate = new Map<string, Day>()
  for (const s of history) {
    const date = s.when.slice(0, 10)
    const day = byDate.get(date) ?? { date, sessions: 0, secs: 0, waited: 0, turns: 0 }
    day.sessions += 1
    day.secs += s.secs
    day.waited += s.waited
    day.turns += s.turns
    byDate.set(date, day)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** How a check stands: fresh, stale (files changed since it passed), or bad (failed or stopped). */
export function checkState(check: PaneCheck): 'fresh' | 'stale' | 'bad' {
  if (check.outcome !== 'ok') return 'bad'
  return check.changed !== null && check.changed > 0 ? 'stale' : 'fresh'
}
