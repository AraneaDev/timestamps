// What every view of the pane is laid out with: styled segments, the rows
// they make up, and the few shapes the views share (a ruled section title, a
// bar, a stacked bar, a row spread to both edges). Pure: nothing here reads,
// measures or draws. live.tsx turns rows into elements.

/**
 * A pressable segment, drawn as a plain Button: `label`, or `hotkey: label`
 * when it has a hotkey. The segment's `text` is those cells as drawn, so
 * the layout can count them.
 */
export type Press = { id: string; label: string; hotkey?: string }

/**
 * A run of text in one style. `color` and `bg` are Claude Code theme keys.
 * `hidden` marks a pressable drawn out of sight, there only so its hotkey
 * works (a tab's digit, where the tab itself shows only its name).
 */
export type Segment = { text: string; color?: string; dim?: boolean; bold?: boolean; bg?: string; press?: Press; hidden?: true }

/** One line of the pane. */
export type Row = { key: string; segments: Segment[] }

// Every glyph the pane draws is one cell wide, so a code point is a cell.
export const cells = (text: string): number => [...text].length

/** `text` in at most `room` cells, an ellipsis in the last one when it was cut. */
export function fit(text: string, room: number): string {
  const points = [...text]
  if (points.length <= room) return text
  if (room <= 0) return ''
  if (room === 1) return '…'
  return `${points.slice(0, room - 1).join('')}…`
}

export const padEnd = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - cells(text)))
export const padStart = (text: string, width: number): string => ' '.repeat(Math.max(0, width - cells(text))) + text

/** The cells a run of segments takes; a hidden one takes none. */
export const width = (segments: readonly Segment[]): number =>
  segments.reduce((sum, s) => sum + (s.hidden === true ? 0 : cells(s.text)), 0)

/** Segments cut to `room` cells: whole ones kept, the one that crosses the edge fitted. */
export function clip(segments: readonly Segment[], room: number): Segment[] {
  const out: Segment[] = []
  let left = Math.max(0, room)
  for (const s of segments) {
    if (s.hidden === true) {
      out.push(s)
      continue
    }
    if (left <= 0) continue
    const size = cells(s.text)
    if (size <= left) {
      out.push(s)
      left -= size
    } else {
      out.push({ ...s, text: fit(s.text, left) })
      left = 0
    }
  }
  return out
}

/** A row with `left` at the left edge and `right` at the right; `left` gives way when both do not fit. */
export function spread(key: string, left: readonly Segment[], right: readonly Segment[], columns: number): Row {
  const rightWidth = width(right)
  if (rightWidth >= columns) return { key, segments: clip(right, columns) }
  const room = columns - rightWidth
  const kept = width(left) + 1 > room ? clip(left, Math.max(0, room - 1)) : [...left]
  const gap = Math.max(0, columns - width(kept) - rightWidth)
  return { key, segments: [...kept, { text: ' '.repeat(gap) }, ...right] }
}

export const blank = (key: string): Row => ({ key, segments: [{ text: '' }] })

/** A pressable: its label, or `hotkey: label`, which is what a plain Button draws. */
export function button(id: string, label: string, hotkey?: string): Segment {
  return hotkey === undefined ? { text: label, press: { id, label } } : { text: `${hotkey}: ${label}`, press: { id, label, hotkey } }
}

/** A hotkey with nothing drawn: the key works, the row keeps its cells. */
export const hotkey = (id: string, label: string, key: string): Segment => ({ text: '', hidden: true, press: { id, label, hotkey: key } })

/** Segments padded with spaces to exactly `size` cells, or cut to it. */
export function padTo(segments: readonly Segment[], size: number): Segment[] {
  const cut = clip(segments, size)
  const short = size - width(cut)
  return short > 0 ? [...cut, { text: ' '.repeat(short) }] : cut
}

/** Two columns of rows side by side: the left padded to `leftWidth`, a gap, then the right. */
export function beside(left: readonly Row[], right: readonly Row[], leftWidth: number, gap: number): Row[] {
  const out: Row[] = []
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i]
    const r = right[i]
    out.push({
      key: `${l?.key ?? `left-${i}`}+${r?.key ?? `right-${i}`}`,
      segments: [...padTo(l?.segments ?? [], leftWidth), ...(r === undefined ? [] : [{ text: ' '.repeat(gap) }, ...r.segments])],
    })
  }
  return out
}

/**
 * A section's title on a rule: `── ◷ Title ───────── note ──`, the glyph in
 * the accent colour, the title bold, the note and the rule dim. Too narrow
 * for the note, it goes first; then the title is cut.
 */
export function rule(key: string, glyph: string, title: string, note: string, columns: number, glyphColor = 'claude'): Row {
  const head: Segment[] = [{ text: '── ', dim: true }, { text: `${glyph} `, color: glyphColor }, { text: title, bold: true }, { text: ' ' }]
  const tail: Segment[] = note === '' ? [] : [{ text: ` ${note} `, dim: true }, { text: '──', dim: true }]
  const fill = columns - width(head) - width(tail)
  if (fill >= 2) return { key, segments: [...head, { text: '─'.repeat(fill), dim: true }, ...tail] }
  const bare = columns - width(head)
  if (bare >= 0) return { key, segments: [...head, { text: '─'.repeat(bare), dim: true }] }
  return { key, segments: clip(head, columns) }
}

/** A thin bar `size` cells long, `fraction` of it drawn in `color` and the rest a dim track. Something above nothing shows at least one cell. */
export function bar(fraction: number, size: number, color: string): Segment[] {
  if (size <= 0) return []
  const share = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const filled = share > 0 ? Math.max(1, Math.round(share * size)) : 0
  const out: Segment[] = []
  if (filled > 0) out.push({ text: '━'.repeat(filled), color })
  if (filled < size) out.push({ text: '·'.repeat(size - filled), dim: true })
  return out
}

/**
 * A stacked bar `size` cells long: each part its share of the whole in its
 * colour, largest remainders rounding up so the cells add up to exactly
 * `size`, and a part above nothing never rounded away while room is left.
 * A part without a colour is the remainder, drawn as a dim shade.
 */
export function stacked(parts: readonly { value: number; color?: string }[], size: number): Segment[] {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0)
  if (size <= 0) return []
  if (total <= 0) return [{ text: '░'.repeat(size), dim: true }]
  const exact = parts.map(p => (Math.max(0, p.value) / total) * size)
  const share = exact.map(Math.floor)
  let left = size - share.reduce((a, b) => a + b, 0)
  // Parts that would vanish come first, then the largest remainders.
  const order = exact
    .map((x, i) => ({ i, lost: share[i] === 0 && x > 0, rest: x - Math.floor(x) }))
    .sort((a, b) => Number(b.lost) - Number(a.lost) || b.rest - a.rest)
  for (const { i } of order) {
    if (left <= 0) break
    share[i] = (share[i] ?? 0) + 1
    left -= 1
  }
  const out: Segment[] = []
  parts.forEach((p, i) => {
    const n = share[i] ?? 0
    if (n <= 0) return
    out.push(p.color === undefined ? { text: '░'.repeat(n), dim: true } : { text: '█'.repeat(n), color: p.color })
  })
  return out
}

/** Words wrapped to `room` cells; a word longer than a line is cut across lines. */
export function wrap(text: string, room: number): string[] {
  if (room <= 0) return []
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ').filter(w => w !== '')) {
    let rest = word
    while (cells(rest) > room) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      lines.push([...rest].slice(0, room).join(''))
      rest = [...rest].slice(room).join('')
    }
    if (line === '') line = rest
    else if (cells(line) + 1 + cells(rest) <= room) line += ` ${rest}`
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line !== '') lines.push(line)
  return lines
}
