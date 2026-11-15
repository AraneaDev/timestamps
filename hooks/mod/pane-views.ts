// The pane as rows: a header (title, status, tabs), the open tab's body and
// a bar of keys. Pure: paneLayout turns the data, where the person is and
// the room there is into rows, and live.tsx draws them. Every section stands
// on a blank row and a rule, with a cell of margin either side, so the pane
// reads as a page rather than a dump.
import type { PaneCall, PaneCheck, PaneCommand, PaneData, PaneTab, PaneTurn, PaneView } from '../../types'
import { formatDuration } from './format.ts'
import { callName, callsByTurn, checkState, composition, days, overUsual, OVER_USUAL, usualOf, workingSeconds } from './pane-data.ts'
import type { Share } from './pane-data.ts'
import { bar, beside, blank, button, cells, clip, fit, hotkey, padEnd, padStart, padTo, rule, spread, stacked, width, wrap } from './rows.ts'
import type { Row, Segment } from './rows.ts'

/** The tabs in hotkey order. */
export const TABS: { id: PaneTab; full: string; hotkey: string }[] = [
  { id: 'overview', full: 'Overview', hotkey: '1' },
  { id: 'turns', full: 'Turns', hotkey: '2' },
  { id: 'commands', full: 'Commands', hotkey: '3' },
  { id: 'checks', full: 'Checks', hotkey: '4' },
  { id: 'told', full: 'Told Claude', hotkey: '5' },
  { id: 'history', full: 'History', hotkey: '6' },
]

// Claude Code theme keys, so the pane follows whichever theme is on.
const TITLE = 'claude'
const ACCENT = 'suggestion'
const OK = 'success'
const WARN = 'warning'
const BAD = 'error'
const ON_FILL = 'inverseText'
const SELECTED_BG = 'userMessageBackground'
const TURN_HUE = 'permission'
// One colour per slice of a composition bar; none of them a status colour.
const SERIES = ['suggestion', 'permission', 'merged', 'ide', 'remember'] as const
const OTHER_HUE = 'inactive'

/** A clock time in the configured zone: hour and minute, with seconds when asked. */
export type Clock = (epoch: number, withSeconds?: boolean) => string

/** What `o` opens from the marked row: a turn on the Turns tab. */
export type Target = { turn: number }

export type Layout = {
  rows: Row[]
  /** how many rows of the open tab the marker can stand on */
  count: number
  /** what the marked row opens, when it opens anything */
  open?: Target
}

type Body = { rows: Row[]; targets: (Target | null)[] }

const fmt = (seconds: number) => formatDuration(seconds)
// A command's time from the memory: under a second is said so, not rounded to nothing.
const span = (ms: number) => (ms < 1000 ? '<1s' : formatDuration(ms / 1000))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dimText = (key: string, text: string): Row => ({ key, segments: [{ text, dim: true }] })

/** The marker's two cells, and the ground a marked row is drawn on. */
function marked(isMarked: boolean, segments: Segment[], size: number): Segment[] {
  const lead: Segment = isMarked ? { text: '› ', color: ACCENT, bold: true } : { text: '  ' }
  const row = padTo([lead, ...segments], size)
  return isMarked ? row.map(s => (s.press === undefined ? { ...s, bg: SELECTED_BG } : s)) : row
}

// ---------------------------------------------------------------- header --

function titleRow(data: PaneData | null, columns: number): Row {
  const name: Segment = { text: 'timestamps', bold: true, color: TITLE }
  const project: Segment[] = data?.project ? [{ text: `  ${data.project}`, dim: true }] : []
  const reload: Segment[] = [{ text: '  ' }, button('reload', 'reload', 'r')]
  const open = data?.turns[data.turns.length - 1]
  const isRunning = open?.how === 'running'
  const pill: Segment = isRunning ? { text: ' live ', bg: OK, color: ON_FILL, bold: true } : { text: ' idle ', dim: true }
  const words =
    data === null || !data.hasSession
      ? 'no turns yet'
      : `${fmt(data.elapsed)} · ${isRunning && open !== undefined ? `turn ${open.n} running ${fmt(open.secs)}` : 'between turns'}`
  const status: Segment[] = [{ text: `${words}  `, dim: true }]
  // Each layout from the fullest down; the first that fits wins.
  const variants: [Segment[], Segment[]][] = [
    [[name, ...project], [...status, pill, ...reload]],
    [[name, ...project], [pill, ...reload]],
    [[name], [pill, ...reload]],
    [[name], [pill, hotkey('reload', 'reload', 'r')]],
  ]
  for (const [left, right] of variants) {
    if (width(left) + 1 + width(right) <= columns) return spread('title', left, right, columns)
  }
  return spread('title', [name], [hotkey('reload', 'reload', 'r')], columns)
}

function tabRow(view: PaneView, columns: number): Row {
  const names = (short: boolean): Segment[] =>
    TABS.flatMap((tab, i): Segment[] => {
      const label = short ? tab.hotkey : tab.full
      const gap: Segment[] = i === 0 ? [] : [{ text: short ? ' ' : '  ' }]
      if (tab.id === view.tab) return [...gap, { text: ` ${label} `, bg: SELECTED_BG, bold: true }]
      return [...gap, { text: ' ' }, button(`tab-${tab.id}`, label), { text: ' ' }]
    })
  // The digits are always there, drawn or not: a tab is one key away at any width.
  const keys = TABS.map(tab => hotkey(`key-${tab.id}`, tab.full, tab.hotkey))
  const full = names(false)
  return { key: 'tabs', segments: [...(width(full) <= columns ? full : clip(names(true), columns)), ...keys] }
}

function keysRow(view: PaneView, open: Target | undefined, columns: number): Row {
  const left: Segment[] = [button('down', '↓', 'j'), { text: '  ' }, button('up', '↑', 'k')]
  const right: Segment[] = []
  if (open !== undefined) right.push(button('open', 'open turn', 'o'), { text: '   ' })
  if (view.tab === 'turns') right.push(button('order', view.isByTime ? 'as they happened' : 'longest first', 's'), { text: '   ' })
  if (view.tab === 'commands') right.push(button('order', view.isByTime ? 'slowest first' : 'most time this session', 's'), { text: '   ' })
  right.push({ text: '1-6: tabs', dim: true })
  if (width(left) + 2 + width(right) <= columns) return spread('keys', left, right, columns)
  // Too narrow for the words: the keys stay, out of sight.
  const hidden = right.filter(s => s.press !== undefined).map(s => hotkey(s.press!.id, s.press!.label, s.press!.hotkey ?? ''))
  return { key: 'keys', segments: [...clip(left, columns), ...hidden.filter(s => s.press?.hotkey !== '')] }
}

// -------------------------------------------------------------- overview --

type Tile = { figure: string; label: string; color: string }

/** The headline figures in one frame, as many as fit, each as wide as the next. */
function tiles(all: Tile[], columns: number): Row[] {
  const inner = columns - 2
  let shown = all
  const need = (list: Tile[]) => list.reduce((sum, t) => sum + Math.max(cells(t.figure), cells(t.label)) + 2, 0) + (list.length - 1)
  while (shown.length > 1 && need(shown) > inner) shown = shown.slice(0, -1)
  if (shown.length === 0 || need(shown) > inner) return []
  // Each tile as wide as it needs, and what is left shared out evenly, so a
  // long label is never cut to make the tiles equal.
  const least = shown.map(t => Math.max(cells(t.figure), cells(t.label)) + 2)
  const spare = inner - (shown.length - 1) - least.reduce((a, b) => a + b, 0)
  const each = Math.floor(spare / shown.length)
  const sizes = least.map((n, i) => n + each + (i < spare % shown.length ? 1 : 0))
  const edge = (l: string, r: string): Row => ({ key: `tiles-${l}`, segments: [{ text: `${l}${'─'.repeat(inner)}${r}`, dim: true }] })
  const line = (key: string, cell: (t: Tile) => Segment): Row => ({
    key,
    segments: [
      { text: '│', dim: true },
      ...shown.flatMap((t, i): Segment[] => {
        const c = cell(t)
        return [{ ...c, text: padEnd(` ${c.text}`, sizes[i] ?? 0) }, { text: '│', dim: true }]
      }),
    ],
  })
  return [
    edge('┌', '┐'),
    line('tiles-figures', t => ({ text: t.figure, color: t.color, bold: true })),
    line('tiles-labels', t => ({ text: t.label })),
    edge('└', '┘'),
  ]
}

type Slice = { name: string; ms: number; color?: string }

/** A composition's slices: the largest shares each in a colour, the rest of the listed calls as one, then what no call accounts for. */
function slices(shares: Share[], wholeMs: number): Slice[] {
  const top = shares.slice(0, SERIES.length - 1)
  const out: Slice[] = top.map((s, i) => ({ name: s.name, ms: s.ms, color: SERIES[i] }))
  const other = shares.slice(top.length).reduce((sum, s) => sum + s.ms, 0)
  if (other > 0) out.push({ name: 'other listed calls', ms: other, color: OTHER_HUE })
  const listed = shares.reduce((sum, s) => sum + s.ms, 0)
  if (wholeMs > listed) out.push({ name: 'the rest', ms: wholeMs - listed })
  return out
}

/** The legend under a stacked bar: each slice's mark, name and share, in as many columns as fit. */
function legend(key: string, parts: Slice[], wholeMs: number, columns: number): Row[] {
  if (parts.length === 0) return []
  const nameW = Math.min(28, Math.max(...parts.map(p => cells(p.name))))
  const entryW = 2 + nameW + 5
  const perRow = Math.max(1, Math.floor((columns + 3) / (entryW + 3)))
  const rows: Row[] = []
  for (let i = 0; i < parts.length; i += perRow) {
    const segments: Segment[] = []
    parts.slice(i, i + perRow).forEach((p, j) => {
      if (j > 0) segments.push({ text: '   ' })
      const pct = wholeMs > 0 ? `${Math.round((p.ms / wholeMs) * 100)}%` : ''
      segments.push(
        p.color === undefined ? { text: '░ ', dim: true } : { text: '■ ', color: p.color },
        { text: padEnd(fit(p.name, nameW), nameW) },
        { text: padStart(pct, 5), dim: true },
      )
    })
    rows.push({ key: `${key}-${i}`, segments: clip(segments, columns) })
  }
  return rows
}

const HOW_WORDS: Record<PaneTurn['how'], string> = {
  stop: 'ended normally',
  interrupted: 'interrupted',
  error: 'ended in an error',
  running: 'running',
}

const CHECK_WORDS = { ok: 'passed', fail: 'failed', limit: 'was stopped at its limit' } as const

function checkRow(key: string, check: PaneCheck, now: number, nameW: number): Segment[] {
  const state = checkState(check)
  const color = state === 'fresh' ? OK : state === 'stale' ? WARN : BAD
  const glyph = state === 'fresh' ? '✓' : state === 'stale' ? '!' : '✗'
  const since =
    check.changed === null
      ? check.outcome === 'ok'
        ? ''
        : ' · not run since'
      : check.changed === 0
        ? check.outcome === 'ok'
          ? ' · nothing changed since'
          : ' · not run since'
        : ` · ${plural(check.changed, 'file')} changed since`
  void key
  return [
    { text: `${glyph} `, color, bold: true },
    { text: padEnd(fit(check.key, nameW), nameW) },
    { text: `  ${CHECK_WORDS[check.outcome]} ${fmt(Math.max(0, now - check.at))} ago`, color: state === 'fresh' ? undefined : color },
    { text: since, dim: true },
  ]
}

function checksSummary(checks: readonly PaneCheck[]): string {
  const count = { fresh: 0, stale: 0, bad: 0 }
  for (const c of checks) count[checkState(c)] += 1
  const parts: string[] = []
  if (count.bad > 0) parts.push(`${count.bad} failed`)
  if (count.stale > 0) parts.push(`${count.stale} stale`)
  if (count.fresh > 0) parts.push(`${count.fresh} fresh`)
  return parts.join(' · ')
}

const KIND_HUE: Record<string, string | undefined> = { stopped: WARN, checks: WARN, raised: ACCENT, slow: undefined }

function overview(data: PaneData, view: PaneView, w: number, clock: Clock): Body {
  const body: Body = { rows: [], targets: [] }
  const pick = (target: Target | null) => body.targets.push(target) - 1 === view.marker
  const working = workingSeconds(data)
  const stopped = data.calls.filter(c => c.outcome === 'limit').length
  const failed = data.calls.filter(c => c.outcome === 'fail').length
  body.rows.push(
    ...tiles(
      [
        { figure: fmt(data.elapsed), label: 'session', color: 'remember' },
        { figure: String(data.turns.length), label: 'turns', color: TURN_HUE },
        { figure: fmt(data.waiting), label: 'you waited', color: 'merged' },
        { figure: fmt(data.away), label: 'away', color: 'ide' },
        { figure: String(data.calls.length), label: 'slow calls', color: ACCENT },
        { figure: String(stopped), label: 'stopped', color: stopped > 0 ? WARN : OK },
        { figure: String(failed), label: 'failed', color: failed > 0 ? BAD : OK },
      ],
      w,
    ),
    blank('gap-tiles'),
  )

  body.rows.push(rule('went', '◷', 'Where the time went', working > 0 ? `${fmt(working)} working` : '', w), blank('gap-went'))
  if (working <= 0) body.rows.push(dimText('went-none', ' No turn has finished yet.'))
  else {
    const parts = slices(composition(data.calls), working * 1000)
    body.rows.push({ key: 'went-bar', segments: [{ text: ' ' }, ...stacked(parts.map(p => ({ value: p.ms, color: p.color })), Math.max(1, w - 2))] })
    body.rows.push(...legend('went-legend', parts, working * 1000, w - 1).map(r => ({ key: r.key, segments: [{ text: ' ' }, ...r.segments] })))
  }
  body.rows.push(blank('gap-went-end'))

  const over = overUsual(data)
  body.rows.push(rule('over', '▲', 'Over their usual', over.length > 0 ? plural(over.length, 'call') : '', w, WARN), blank('gap-over'))
  if (over.length === 0) body.rows.push(dimText('over-none', ' No call ran well over its usual time.'))
  else {
    const top = over.slice(0, 5)
    const nameW = Math.min(30, Math.max(...top.map(o => cells(callName(o.call)))))
    const most = Math.max(...top.map(o => o.ratio))
    top.forEach((o, i) => {
      const left: Segment[] = [
        { text: padEnd(fit(callName(o.call), nameW), nameW) },
        { text: padStart(fmt(o.call.ms / 1000), 8), bold: true },
        { text: '  ' },
        ...bar(o.ratio / most, 14, WARN),
        { text: `  ${o.ratio.toFixed(1)}× usual ${fmt(o.usual)}`, color: WARN },
      ]
      const turn = o.turn === undefined ? '' : `turn ${o.turn} `
      const isMarked = pick(o.turn === undefined ? null : { turn: o.turn })
      body.rows.push({ key: `over-${i}`, segments: marked(isMarked, spread('', left, [{ text: turn, dim: true }], w - 2).segments, w) })
    })
  }
  body.rows.push(blank('gap-over-end'))

  const byTurn = callsByTurn(data)
  const longest = [...data.turns].sort((a, b) => b.secs - a.secs).slice(0, 5)
  body.rows.push(rule('longest', '≡', 'Longest turns', data.turns.length > 0 ? plural(data.turns.length, 'turn') : '', w), blank('gap-longest'))
  if (longest.length === 0) body.rows.push(dimText('longest-none', ' No turns recorded yet.'))
  else {
    const most = Math.max(1, ...longest.map(t => t.secs))
    for (const t of longest) {
      const listed = Math.floor((byTurn.get(t.n) ?? []).reduce((sum, c) => sum + c.ms, 0) / 1000)
      const left: Segment[] = [
        { text: padEnd(`#${t.n}`, 5) },
        { text: clock(t.start), dim: true },
        { text: padStart(fmt(t.secs), 9), bold: true },
        { text: '  ' },
        ...bar(t.secs / most, Math.max(4, Math.min(24, w - 48)), t.how === 'running' ? ACCENT : TURN_HUE),
      ]
      const note = t.how === 'running' ? 'running ' : listed > 0 ? `${fmt(listed)} in calls ` : ''
      body.rows.push({ key: `longest-${t.n}`, segments: marked(pick({ turn: t.n }), spread('', left, [{ text: note, dim: true }], w - 2).segments, w) })
    }
  }
  body.rows.push(blank('gap-longest-end'))

  body.rows.push(rule('checks', '✓', 'Checks', checksSummary(data.checks), w, OK), blank('gap-checks'))
  if (data.checks.length === 0) body.rows.push(dimText('checks-none', ' No check has run yet: a command with test, lint, check or build in it.'))
  else {
    const newest = [...data.checks].sort((a, b) => b.at - a.at).slice(0, 4)
    const nameW = Math.min(30, Math.max(...newest.map(c => cells(c.key))))
    newest.forEach((c, i) => body.rows.push({ key: `checks-${i}`, segments: clip([{ text: ' ' }, ...checkRow('', c, data.now, nameW)], w) }))
  }
  body.rows.push(blank('gap-checks-end'))

  body.rows.push(rule('told', '⚑', 'Told Claude', data.told.length > 0 ? plural(data.told.length, 'note') : '', w), blank('gap-told'))
  if (data.told.length === 0) body.rows.push(dimText('told-none', ' Nothing yet this session.'))
  else {
    ;[...data.told]
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
      .forEach((n, i) =>
        body.rows.push({
          key: `told-${i}`,
          segments: clip([{ text: ` ${clock(n.at)}  `, dim: true }, { text: padEnd(n.kind, 9), color: KIND_HUE[n.kind] }, { text: n.text }], w),
        }),
      )
  }
  return body
}

// ----------------------------------------------------------------- turns --

/** The turns in the order the list shows them. */
export function turnOrder(data: PaneData, isByTime: boolean): PaneTurn[] {
  return isByTime ? [...data.turns].sort((a, b) => b.secs - a.secs) : data.turns
}

/** A list's window around the marker: where it starts, and how many rows it shows. */
function windowOf(length: number, marker: number, room: number): { start: number; shown: number } {
  const shown = Math.max(1, Math.min(length, room))
  const start = Math.max(0, Math.min(length - shown, marker - Math.floor(shown / 2)))
  return { start, shown }
}

const more = (key: string, n: number, arrow: string): Row => dimText(key, `  ${arrow} ${n} more`)

function callFlags(call: PaneCall, usual: Map<string, number>): Segment[] {
  if (call.outcome === 'limit') return [{ text: '  ■ stopped at its limit', color: WARN }]
  if (call.outcome === 'fail') return [{ text: '  ✗ failed', color: BAD }]
  const u = call.key === null ? undefined : usual.get(call.key)
  if (u === undefined || u < 1) return []
  const ratio = call.ms / 1000 / u
  return ratio >= OVER_USUAL ? [{ text: `  ▲ ${ratio.toFixed(1)}× usual ${fmt(u)}`, color: WARN }] : [{ text: `  usually ${fmt(u)}`, dim: true }]
}

function turnDetail(turn: PaneTurn, calls: PaneCall[], usual: Map<string, number>, w: number, clock: Clock): Row[] {
  const until = turn.how === 'running' ? 'now' : clock(turn.start + turn.secs)
  const rows: Row[] = [rule('detail', '◆', `#${turn.n} · ${clock(turn.start)} → ${until}`, HOW_WORDS[turn.how], w, ACCENT), blank('gap-detail')]
  const listed = Math.floor(calls.reduce((sum, c) => sum + c.ms, 0) / 1000)
  const rest = turn.secs - listed
  rows.push({
    key: 'detail-figures',
    segments: clip(
      [
        { text: ` ${fmt(turn.secs)}`, bold: true },
        { text: calls.length === 0 ? '' : `  ·  ${fmt(listed)} in ${plural(calls.length, 'listed call')}`, dim: true },
        { text: calls.length > 0 && rest >= 1 ? `  ·  ${fmt(rest)} the rest` : '', dim: true },
      ],
      w,
    ),
  })
  if (calls.length === 0) {
    rows.push(blank('gap-detail-none'), dimText('detail-none', ' No call of five seconds or more in this turn.'))
    return rows
  }
  const parts = slices(composition(calls), Math.max(turn.secs, listed) * 1000)
  const hue = new Map(parts.map(p => [p.name, p.color]))
  rows.push({ key: 'detail-bar', segments: [{ text: ' ' }, ...stacked(parts.map(p => ({ value: p.ms, color: p.color })), Math.max(1, w - 2))] }, blank('gap-detail-bar'))
  // In the order they ran: a call's start is its end less its length.
  const ran = [...calls].sort((a, b) => a.at - a.ms / 1000 - (b.at - b.ms / 1000))
  ran.forEach((call, i) => {
    const name = callName(call)
    const color = hue.get(name)
    rows.push({
      key: `detail-call-${i}`,
      segments: clip(
        [
          { text: ` ${clock(Math.floor(call.at - call.ms / 1000), true)}`, dim: true },
          { text: padStart(fmt(call.ms / 1000), 8), bold: true },
          { text: '  ' },
          color === undefined || color === OTHER_HUE ? { text: '· ', dim: true } : { text: '■ ', color },
          { text: name },
          ...callFlags(call, usual),
        ],
        w,
      ),
    })
  })
  // Calls that ran side by side add up to more than the turn; a running turn's remainder is still moving.
  if (rest >= 1 && turn.how !== 'running') {
    rows.push({ key: 'detail-rest', segments: clip([{ text: ' '.repeat(9) }, { text: padStart(fmt(rest), 8), dim: true }, { text: '  ░ thinking, writing, calls under 5s', dim: true }], w) })
  }
  return rows
}

function turnFlags(turn: PaneTurn, calls: PaneCall[], usual: Map<string, number>): Segment[] {
  if (turn.how === 'running') return [{ text: 'running', color: ACCENT }]
  if (turn.how === 'interrupted') return [{ text: 'interrupted', color: WARN }]
  if (turn.how === 'error') return [{ text: 'error', color: BAD }]
  const over = calls.filter(c => c.outcome === 'ok' && c.key !== null && (usual.get(c.key) ?? 0) >= 1 && c.ms / 1000 / (usual.get(c.key) ?? 1) >= OVER_USUAL).length
  const stopped = calls.filter(c => c.outcome === 'limit').length
  const failed = calls.filter(c => c.outcome === 'fail').length
  const out: Segment[] = []
  if (over > 0) out.push({ text: `▲${over} `, color: WARN })
  if (stopped > 0) out.push({ text: `■${stopped} `, color: WARN })
  if (failed > 0) out.push({ text: `✗${failed} `, color: BAD })
  return out
}

/** A list and the marked row's detail: side by side where there is room, else one above the other. */
function split(list: Row[], detail: Row[], listW: number, isWide: boolean): Row[] {
  return isWide ? beside(list, detail, listW, 3) : [...list, blank('gap-split'), ...detail]
}

function turns(data: PaneData, view: PaneView, w: number, room: number, clock: Clock): Body {
  const order = turnOrder(data, view.isByTime)
  if (order.length === 0) {
    return { rows: [rule('turns', '≡', 'Turns', '', w), blank('gap-turns'), dimText('turns-none', ' No turns recorded yet in this session.')], targets: [] }
  }
  const isWide = w >= 100
  const listW = isWide ? Math.min(60, Math.floor(w * 0.46)) : w
  const byTurn = callsByTurn(data)
  const usual = usualOf(data)
  const most = Math.max(1, ...order.map(t => t.secs))
  const barW = Math.max(0, listW - 46)
  const list: Row[] = [
    rule('turns', '≡', 'Turns', `${order.length} · ${view.isByTime ? 'longest first' : 'as they happened'}`, listW),
    blank('gap-turns'),
    dimText('turns-head', `  ${padEnd('#', 5)}${padEnd('start', 5)}${padStart('took', 9)}${' '.repeat(barW >= 4 ? barW + 2 : 0)}${padStart('in calls', 10)}`),
  ]
  // A stacked pane gives the list about half its rows; side by side it has them all.
  const listRoom = Math.max(3, (isWide ? room : Math.floor(room / 2)) - 5)
  const marker = Math.min(view.marker, order.length - 1)
  const win = windowOf(order.length, marker, listRoom)
  if (win.start > 0) list.push(more('turns-above', win.start, '↑'))
  order.slice(win.start, win.start + win.shown).forEach((t, i) => {
    const calls = byTurn.get(t.n) ?? []
    const listed = Math.floor(calls.reduce((sum, c) => sum + c.ms, 0) / 1000)
    list.push({
      key: `turn-${t.n}`,
      segments: marked(
        win.start + i === marker,
        [
          { text: padEnd(`#${t.n}`, 5) },
          { text: padEnd(clock(t.start), 5), dim: true },
          { text: padStart(fmt(t.secs), 9), bold: true },
          ...(barW >= 4 ? [{ text: '  ' }, ...bar(t.secs / most, barW, t.how === 'running' ? ACCENT : TURN_HUE)] : []),
          { text: padStart(listed > 0 ? fmt(listed) : '', 10), dim: true },
          { text: '  ' },
          ...turnFlags(t, calls, usual),
        ],
        listW,
      ),
    })
  })
  const below = order.length - win.start - win.shown
  if (below > 0) list.push(more('turns-below', below, '↓'))
  const chosen = order[marker]
  const detail = chosen === undefined ? [] : turnDetail(chosen, byTurn.get(chosen.n) ?? [], usual, isWide ? w - listW - 3 : w, clock)
  return { rows: split(list, detail, listW, isWide), targets: order.map(() => null) }
}

// -------------------------------------------------------------- commands --

function commandOrder(data: PaneData, isByTime: boolean): PaneCommand[] {
  if (!isByTime) return data.commands
  const spent = new Map<string, number>()
  for (const c of data.calls) if (c.key !== null) spent.set(c.key, (spent.get(c.key) ?? 0) + c.ms)
  return [...data.commands].sort((a, b) => (spent.get(b.key) ?? 0) - (spent.get(a.key) ?? 0) || b.medianMs - a.medianMs)
}

function commandDetail(data: PaneData, command: PaneCommand, w: number, clock: Clock): Row[] {
  const rows: Row[] = [rule('detail', '◆', fit(command.key, Math.max(8, w - 12)), '', w, ACCENT), blank('gap-detail')]
  const line = (key: string, segments: Segment[]) => rows.push({ key, segments: clip([{ text: ' ' }, ...segments], w) })
  if (command.runs >= 3) line('cmd-usual', [{ text: `usually ${span(command.medianMs)}`, bold: true }, { text: `  over ${plural(command.runs, 'finished run')}`, dim: true }])
  else if (command.runs > 0) line('cmd-usual', [{ text: `${plural(command.runs, 'finished run')}`, bold: true }, { text: '  too few for a usual time', dim: true }])
  else line('cmd-usual', [{ text: 'never seen to finish', bold: true }])
  if (command.runs > 0) line('cmd-range', [{ text: `longest ${span(command.maxMs)}  ·  last ${span(command.lastMs)}`, dim: true }])
  if (command.stopped > 0) line('cmd-stopped', [{ text: `■ stopped at its limit ${plural(command.stopped, 'time')}, last at ${fmt(command.limitMs / 1000)}`, color: WARN }])
  if (command.failed > 0) line('cmd-failed', [{ text: `✗ ${plural(command.failed, 'run')} failed`, color: BAD }])
  rows.push(blank('gap-cmd'), rule('cmd-session', '◷', 'This session', '', w), blank('gap-cmd-session'))
  const mine = data.calls.filter(c => c.key === command.key)
  if (mine.length === 0) rows.push(dimText('cmd-none', ' Not run for five seconds or more in this session.'))
  const byTurn = callsByTurn(data)
  const usual = usualOf(data)
  mine.forEach((call, i) => {
    const turn = [...byTurn.entries()].find(([, calls]) => calls.includes(call))?.[0]
    line(`cmd-call-${i}`, [
      { text: clock(Math.floor(call.at - call.ms / 1000), true), dim: true },
      { text: padStart(fmt(call.ms / 1000), 8), bold: true },
      { text: turn === undefined ? '' : `  turn ${turn}`, dim: true },
      ...callFlags(call, usual),
    ])
  })
  return rows
}

function commands(data: PaneData, view: PaneView, w: number, room: number, clock: Clock): Body {
  const order = commandOrder(data, view.isByTime)
  const head = rule('commands', '◔', 'Commands', data.project === null ? '' : `${order.length} remembered in ${data.project}`, w)
  if (order.length === 0) {
    const why = data.project === null ? ' This directory is not in a project, so nothing is remembered here.' : ' Nothing remembered for this project yet.'
    return { rows: [head, blank('gap-commands'), dimText('commands-none', why)], targets: [] }
  }
  const isWide = w >= 100
  const listW = isWide ? Math.min(64, Math.floor(w * 0.5)) : w
  const nameW = Math.max(10, Math.min(30, listW - 32))
  // The marker, the name, three figures, a gap either side of the bar, and room for both flags.
  const barW = Math.max(0, listW - nameW - 34)
  const most = Math.max(1, ...order.map(c => c.medianMs))
  const list: Row[] = [
    rule('commands', '◔', 'Commands', `${order.length} · ${view.isByTime ? 'most time this session' : 'slowest first'}`, listW),
    blank('gap-commands'),
    dimText('commands-head', `  ${padEnd('command', nameW)}${padStart('runs', 5)}${padStart('usual', 8)}${padStart('longest', 8)}`),
  ]
  const listRoom = Math.max(3, (isWide ? room : Math.floor(room / 2)) - 5)
  const marker = Math.min(view.marker, order.length - 1)
  const win = windowOf(order.length, marker, listRoom)
  if (win.start > 0) list.push(more('commands-above', win.start, '↑'))
  order.slice(win.start, win.start + win.shown).forEach((c, i) => {
    const flags: Segment[] = []
    if (c.stopped > 0) flags.push({ text: `■${c.stopped} `, color: WARN })
    if (c.failed > 0) flags.push({ text: `✗${c.failed} `, color: BAD })
    list.push({
      key: `command-${win.start + i}`,
      segments: marked(
        win.start + i === marker,
        [
          { text: padEnd(fit(c.key, nameW), nameW) },
          { text: padStart(String(c.runs), 5), dim: true },
          { text: padStart(c.runs >= 3 ? span(c.medianMs) : '', 8), bold: true },
          { text: padStart(c.runs > 0 ? span(c.maxMs) : '', 8), dim: true },
          ...(barW >= 4 ? [{ text: '  ' }, ...bar(c.medianMs / most, barW, TURN_HUE)] : []),
          { text: '  ' },
          ...flags,
        ],
        listW,
      ),
    })
  })
  const below = order.length - win.start - win.shown
  if (below > 0) list.push(more('commands-below', below, '↓'))
  const chosen = order[marker]
  const detail = chosen === undefined ? [] : commandDetail(data, chosen, isWide ? w - listW - 3 : w, clock)
  return { rows: split(list, detail, listW, isWide), targets: order.map(() => null) }
}

// ---------------------------------------------------------------- checks --

function checks(data: PaneData, view: PaneView, w: number): Body {
  const rows: Row[] = [rule('checks', '✓', 'Checks', checksSummary(data.checks), w, OK), blank('gap-checks')]
  const newest = [...data.checks].sort((a, b) => b.at - a.at)
  if (newest.length === 0) rows.push(dimText('checks-none', ' No check has run in this session yet.'))
  else {
    const nameW = Math.min(36, Math.max(...newest.map(c => cells(c.key))))
    newest.forEach((c, i) => rows.push({ key: `check-${i}`, segments: marked(i === Math.min(view.marker, newest.length - 1), checkRow('', c, data.now, nameW), w) }))
  }
  rows.push(blank('gap-checks-note'))
  const note =
    'A check is a command with a word such as test, lint, check or build in it. "Changed since" counts the files in the work tree that are newer than the end of that run, whoever edited them.'
  wrap(note, Math.max(10, w - 2)).forEach((line, i) => rows.push(dimText(`checks-note-${i}`, ` ${line}`)))
  return { rows, targets: newest.map(() => null) }
}

// ------------------------------------------------------------------ told --

function told(data: PaneData, view: PaneView, w: number, room: number, clock: Clock): Body {
  const notes = [...data.told].sort((a, b) => b.at - a.at)
  const rows: Row[] = [rule('told', '⚑', 'Told Claude', notes.length > 0 ? `${plural(notes.length, 'note')} · newest first` : '', w), blank('gap-told')]
  if (notes.length === 0) {
    rows.push(dimText('told-none', ' Nothing has been said to Claude about time in this session yet.'))
    return { rows, targets: [] }
  }
  const marker = Math.min(view.marker, notes.length - 1)
  const lead = 2 + 8 + 2 + 9
  const textW = Math.max(12, w - lead)
  // Notes are of uneven height: start a little above the marker and stop where the room ends.
  const start = Math.max(0, marker - 2)
  if (start > 0) rows.push(more('told-above', start, '↑'))
  let used = rows.length
  let shown = start
  for (let i = start; i < notes.length; i++) {
    const n = notes[i]!
    const lines = wrap(n.text, textW)
    if (i > marker && used + lines.length > room - 1) break
    lines.forEach((line, j) => {
      const segments: Segment[] =
        j === 0
          ? [{ text: clock(n.at, true), dim: true }, { text: '  ' }, { text: padEnd(n.kind, 9), color: KIND_HUE[n.kind], bold: true }, { text: line }]
          : [{ text: ' '.repeat(lead - 2) }, { text: line }]
      rows.push({ key: `told-${i}-${j}`, segments: j === 0 ? marked(i === marker, segments, w) : padTo([{ text: '  ' }, ...segments], w) })
    })
    used += lines.length
    shown = i + 1
  }
  if (shown < notes.length) rows.push(more('told-below', notes.length - shown, '↓'))
  return { rows, targets: notes.map(() => null) }
}

// --------------------------------------------------------------- history --

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-11-15` as `Sun 15 Nov`; anything else as it came. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined || !Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return date
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAYS[day] ?? ''} ${String(d).padStart(2, ' ')} ${MONTHS[m - 1] ?? ''}`
}

function history(data: PaneData, view: PaneView, w: number, room: number): Body {
  const all = days(data.history)
  const total = data.history.reduce((sum, s) => sum + s.secs, 0)
  const rows: Row[] = [rule('history', '▤', 'Past sessions', all.length > 0 ? `${plural(data.history.length, 'session')} · ${fmt(total)}` : '', w), blank('gap-history')]
  if (all.length === 0) {
    rows.push(dimText('history-none', ' No finished session recorded yet.'))
    return { rows, targets: [] }
  }
  const projects = new Map<string, { sessions: number; secs: number }>()
  for (const s of data.history) {
    if (s.project === null) continue
    const p = projects.get(s.project) ?? { sessions: 0, secs: 0 }
    p.sessions += 1
    p.secs += s.secs
    projects.set(s.project, p)
  }
  const topProjects = [...projects.entries()].sort((a, b) => b[1].secs - a[1].secs).slice(0, 6)
  const projectRows = topProjects.length === 0 ? 0 : topProjects.length + 3
  const marker = Math.min(view.marker, all.length - 1)
  const win = windowOf(all.length, marker, Math.max(3, room - 4 - projectRows))
  const most = Math.max(1, ...all.map(d => d.secs))
  const barW = Math.max(0, Math.min(28, w - 62))
  rows.push(dimText('history-head', `  ${padEnd('day', 11)}${padStart('sessions', 9)}${padStart('time', 9)}${' '.repeat(barW >= 4 ? barW + 2 : 0)}${padStart('you waited', 16)}${padStart('turns', 8)}`))
  if (win.start > 0) rows.push(more('history-above', win.start, '↑'))
  all.slice(win.start, win.start + win.shown).forEach((d, i) => {
    const pct = d.secs > 0 ? `${Math.round((d.waited / d.secs) * 100)}%` : ''
    rows.push({
      key: `day-${d.date}`,
      segments: marked(
        win.start + i === marker,
        [
          { text: padEnd(dayLabel(d.date), 11) },
          { text: padStart(String(d.sessions), 9), dim: true },
          { text: padStart(fmt(d.secs), 9), bold: true },
          ...(barW >= 4 ? [{ text: '  ' }, ...bar(d.secs / most, barW, TURN_HUE)] : []),
          { text: padStart(fmt(d.waited), 11) },
          { text: padStart(pct, 5), dim: true },
          { text: padStart(String(d.turns), 8), dim: true },
        ],
        w,
      ),
    })
  })
  const below = all.length - win.start - win.shown
  if (below > 0) rows.push(more('history-below', below, '↓'))
  if (topProjects.length > 0) {
    rows.push(blank('gap-projects'), rule('projects', '◫', 'By project', '', w), blank('gap-projects-head'))
    const nameW = Math.min(30, Math.max(...topProjects.map(([name]) => cells(name))))
    const top = Math.max(1, ...topProjects.map(([, p]) => p.secs))
    topProjects.forEach(([name, p], i) =>
      rows.push({
        key: `project-${i}`,
        segments: clip(
          [
            { text: `  ${padEnd(fit(name, nameW), nameW)}` },
            { text: padStart(plural(p.sessions, 'session'), 14), dim: true },
            { text: padStart(fmt(p.secs), 9), bold: true },
            { text: '  ' },
            ...bar(p.secs / top, Math.max(4, Math.min(28, w - nameW - 30)), TURN_HUE),
          ],
          w,
        ),
      }),
    )
  }
  return { rows, targets: all.map(() => null) }
}

// ------------------------------------------------------------------ pane --

function bodyOf(data: PaneData, view: PaneView, w: number, room: number, clock: Clock): Body {
  switch (view.tab) {
    case 'overview':
      return overview(data, view, w, clock)
    case 'turns':
      return turns(data, view, w, room, clock)
    case 'commands':
      return commands(data, view, w, room, clock)
    case 'checks':
      return checks(data, view, w)
    case 'told':
      return told(data, view, w, room, clock)
    case 'history':
      return history(data, view, w, room)
  }
}

/** How many rows of a tab the marker can stand on: what the hooks clamp j and k to. */
export function markerCount(data: PaneData | null, view: PaneView, columns: number, height: number, clock: Clock): number {
  return paneLayout(data, view, columns, height, clock).count
}

/**
 * The whole pane: the title and the tabs, a rule, the open tab's body with a
 * cell of margin either side, and the keys on the last row of the room. A
 * marker past the end of its list stands on the last row.
 */
export function paneLayout(data: PaneData | null, view: PaneView, columns: number, height: number, clock: Clock): Layout {
  const inner = Math.max(1, columns - 2)
  const pad = (row: Row): Row => ({ key: row.key, segments: [{ text: ' ' }, ...clip(row.segments, inner)] })
  const head: Row[] = [titleRow(data, inner), blank('gap-title'), tabRow(view, inner), { key: 'tabs-rule', segments: [{ text: '─'.repeat(inner), dim: true }] }, blank('gap-tabs')]
  const room = Math.max(6, height - head.length - 2)
  let body: Body
  if (data === null) body = { rows: [dimText('loading', ' Reading this session…')], targets: [] }
  else {
    body = bodyOf(data, view, inner, room, clock)
    // Past the end of a list that has since shrunk: the last row is the marked one.
    if (body.targets.length > 0 && view.marker >= body.targets.length) body = bodyOf(data, { ...view, marker: body.targets.length - 1 }, inner, room, clock)
  }
  const marker = Math.min(view.marker, Math.max(0, body.targets.length - 1))
  const open = body.targets[marker] ?? undefined
  const rows = [...head, ...body.rows].map(pad)
  // The keys sit on the room's last row; a body taller than the room pushes them down with it.
  for (let i = rows.length; i < height - 1; i++) rows.push(blank(`fill-${i}`))
  rows.push(pad(keysRow(view, open, inner)))
  return { rows, count: body.targets.length, open }
}

/** Where a turn stands in the Turns tab's list, for opening it from the overview. */
export function markerOfTurn(data: PaneData, isByTime: boolean, turn: number): number {
  return Math.max(0, turnOrder(data, isByTime).findIndex(t => t.n === turn))
}

/**
 * Hour and minute, with seconds when asked, in the zone the plugin was
 * configured with, else the machine's. A zone the platform does not know
 * falls back to the machine's rather than failing the drawing.
 */
export function clockOf(tz: string | null | undefined): Clock {
  const make = (timeZone: string | undefined, second: boolean) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', ...(second ? { second: '2-digit' as const } : {}), hourCycle: 'h23', timeZone })
  let short: Intl.DateTimeFormat
  let long: Intl.DateTimeFormat
  try {
    short = make(tz || undefined, false)
    long = make(tz || undefined, true)
  } catch {
    short = make(undefined, false)
    long = make(undefined, true)
  }
  return (epoch, withSeconds = false) => (withSeconds ? long : short).format(new Date(epoch * 1000))
}
