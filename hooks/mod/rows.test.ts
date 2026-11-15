import { expect, test } from 'claude-code/testing'
import { bar, beside, button, cells, clip, fit, hotkey, padTo, rule, spread, stacked, width, wrap } from './rows.ts'
import type { Segment } from './rows.ts'

const text = (segments: readonly Segment[]) => segments.filter(s => s.hidden !== true).map(s => s.text).join('')

test('fit cuts with an ellipsis in the last cell', () => {
  expect(fit('abcdef', 6)).toBe('abcdef')
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fit('abcdef', 1)).toBe('…')
  expect(fit('abcdef', 0)).toBe('')
})

test('a hidden segment takes no cells', () => {
  expect(width([{ text: 'ab' }, hotkey('x', 'x', '1'), { text: 'c' }])).toBe(3)
})

test('clip keeps whole segments, fits the one that crosses the edge, and keeps hidden keys', () => {
  const cut = clip([{ text: 'abc' }, hotkey('k', 'k', '1'), { text: 'defgh', bold: true }, { text: 'zzz' }], 6)
  expect(text(cut)).toBe('abcde…')
  expect(cut.some(s => s.hidden === true)).toBe(true)
  expect(cut.find(s => s.text === 'de…')?.bold).toBe(true)
})

test('spread puts the right side on the right edge, and the left gives way', () => {
  expect(text(spread('k', [{ text: 'left' }], [{ text: 'right' }], 14).segments)).toBe('left     right')
  expect(text(spread('k', [{ text: 'a long left side' }], [{ text: 'right' }], 12).segments)).toBe('a lon… right')
  expect(text(spread('k', [{ text: 'left' }], [{ text: 'a right side too long' }], 8).segments)).toBe('a right…')
})

test('a rule carries its title and its note, and drops the note before the title', () => {
  expect(text(rule('k', '◷', 'Title', 'note', 30).segments)).toBe('── ◷ Title ─────────── note ──')
  expect(cells(text(rule('k', '◷', 'Title', 'note', 30).segments))).toBe(30)
  expect(text(rule('k', '◷', 'Title', 'a note far too long', 16).segments)).toBe('── ◷ Title ─────')
  expect(text(rule('k', '◷', 'Title', '', 8).segments)).toBe('── ◷ Ti…')
})

test('a bar shows something for anything above nothing, and never more than its size', () => {
  expect(text(bar(0.5, 10, 'x'))).toBe('━━━━━·····')
  expect(text(bar(0.001, 10, 'x'))).toBe('━·········')
  expect(text(bar(0, 4, 'x'))).toBe('····')
  expect(text(bar(7, 4, 'x'))).toBe('━━━━')
  expect(text(bar(Number.NaN, 3, 'x'))).toBe('···')
  expect(bar(1, 0, 'x')).toEqual([])
})

test('a stacked bar is exactly its size, and keeps a small part visible', () => {
  const drawn = stacked([{ value: 97, color: 'a' }, { value: 1, color: 'b' }, { value: 2 }], 10)
  expect(cells(text(drawn))).toBe(10)
  expect(drawn.map(s => s.color)).toEqual(['a', 'b', undefined])
  expect(text(stacked([{ value: 1, color: 'a' }, { value: 1, color: 'b' }], 4))).toBe('████')
  expect(text(stacked([], 5))).toBe('░░░░░')
  expect(text(stacked([{ value: 0, color: 'a' }], 3))).toBe('░░░')
})

test('wrap breaks on words, and cuts a word longer than the line', () => {
  expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrap('abcdefghij kl', 4)).toEqual(['abcd', 'efgh', 'ij', 'kl'])
  expect(wrap('', 5)).toEqual([])
})

test('a button is its label, or key: label, which is what gets drawn', () => {
  expect(button('open', 'open turn', 'o')).toEqual({ text: 'o: open turn', press: { id: 'open', label: 'open turn', hotkey: 'o' } })
  expect(button('tab', 'Turns')).toEqual({ text: 'Turns', press: { id: 'tab', label: 'Turns' } })
})

test('padTo fills or cuts to exactly the size', () => {
  expect(text(padTo([{ text: 'ab' }], 5))).toBe('ab   ')
  expect(text(padTo([{ text: 'abcdefg' }], 5))).toBe('abcd…')
})

test('beside lays two columns side by side, the shorter one padded out', () => {
  const rows = beside([{ key: 'a', segments: [{ text: 'L1' }] }], [{ key: 'x', segments: [{ text: 'R1' }] }, { key: 'y', segments: [{ text: 'R2' }] }], 4, 2)
  expect(rows.map(r => text(r.segments))).toEqual(['L1    R1', '      R2'])
})
