// A port of ct_cmdkey (CT_JQ_CMDKEY, hooks/scripts/lib/state.sh). The same
// short key bash files a Bash call's duration under, so the band can look up
// the usual time. cmdkey.cases.ts holds both to the same answers; change one
// and the other's tests fail.

const PLAIN = /^[0-9A-Za-z._\/@:+-]+$/
const PREFIXES = new Set(['env', 'time', 'sudo', 'nice', 'command'])

const len = (s: string) => [...s].length
const words = (s: string) => s.split(' ').filter(w => w.length > 0)
const isPlain = (s: string) => PLAIN.test(s)
const isDigits = (s: string) => /^[0-9]*$/.test(s)

// Quoted text and $(...) / ${...} bodies vanish; quotes and brackets become
// spaces, so nothing inside them can split a command or reach the key.
function unquote(s: string): string {
  let q: string | null = null
  let p = ''
  let out = ''
  for (const c of s) {
    let e: string | null
    if (q !== null) {
      if (c === q) q = null
      e = null
    } else if (p === '$' && c === '(') {
      q = ')'
      e = null
    } else if (p === '$' && c === '{') {
      q = '}'
      e = null
    } else if (c === '"' || c === "'") {
      q = c
      e = ' '
    } else if (c === '(' || c === ')' || c === '{' || c === '}') {
      e = ' '
    } else {
      e = c
    }
    p = c
    if (e !== null) out += e
  }
  return out
}

function stops(w: string): boolean {
  return (
    w.startsWith('-') ||
    w.includes('://') ||
    w.includes('..') ||
    w.startsWith('/') ||
    w.startsWith('~') ||
    isDigits(w) ||
    !isPlain(w) ||
    (w.includes('@') && !w.startsWith('@')) ||
    w.includes(':/') ||
    (len(w) >= 16 && !w.includes('/') && /[A-Za-z]/.test(w) && /[0-9]/.test(w))
  )
}

const isPrefix = (w: string) => w.includes('=') || PREFIXES.has(w)
const base = (w: string) => w.split('/').pop() ?? ''

// Setup before the command or a status report after it: never what took the time.
const IGNORED = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'source', '.', 'echo', 'printf', 'true', ':', 'exit'])
// A loop or a branch: its time belongs to no single command.
const CONTROL = new Set(['until', 'while', 'for', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'case', 'esac'])
const TIMEOUT_VALUE = new Set(['-s', '--signal', '-k', '--kill-after'])
const SHELLS = new Set(['bash', 'sh', 'zsh'])

// Prefixes dropped, and nohup, stdbuf and timeout seen through, options and
// duration included.
function strip(ws: string[]): string[] {
  let i = 0
  for (;;) {
    const w = ws[i]
    if (w === undefined) break
    if (isPrefix(w)) {
      i += 1
    } else if (base(w) === 'nohup') {
      i += 1
    } else if (base(w) === 'stdbuf') {
      i += 1
      while (ws[i]?.startsWith('-')) i += 1
    } else if (base(w) === 'timeout') {
      i += 1
      for (;;) {
        const o = ws[i]
        if (o === undefined) break
        if (TIMEOUT_VALUE.has(o)) i += 2
        else if (o.startsWith('-')) i += 1
        else {
          i += 1
          break
        }
      }
    } else {
      break
    }
  }
  return ws.slice(i)
}

type Piece = { kind: 'ignored' | 'control' } | { kind: 'real'; key: string }

function piece(segment: string): Piece {
  const ws = strip(words(segment.split('|')[0] ?? '').slice(0, 40))
  if (ws[0] === undefined) return { kind: 'ignored' }
  const prog = base(ws[0])
  if (IGNORED.has(prog)) return { kind: 'ignored' }
  if (CONTROL.has(prog)) return { kind: 'control' }
  if (!isPlain(prog) || prog.startsWith('-') || prog === 'xargs' || (SHELLS.has(prog) && ws[1] === '-c')) {
    return { kind: 'real', key: '' }
  }
  const kept: string[] = []
  for (const w of ws.slice(1, 3)) {
    if (stops(w)) break
    kept.push(w)
  }
  return { kind: 'real', key: [...[prog, ...kept].join(' ')].slice(0, 60).join('') }
}

const isBlank = (line: string) => /^[ \t\r]*$/.test(line)

// A call has one duration, so it has a key only when exactly one command in
// it can have taken the time; anything else is not remembered.
export function cmdKey(command: unknown): string {
  if (typeof command !== 'string') return ''
  const lines = command.split('\n')
  const first = lines[0] ?? ''
  // Further lines are a heredoc body, or a script nobody looked at.
  if (lines.slice(1).some(l => !isBlank(l)) && !first.includes('<<')) return ''
  const line = unquote(first).split('\t').join(' ')
  const pieces = ['&&', '||', ';']
    .reduce<string[]>((parts, sep) => parts.flatMap(p => p.split(sep)), [line])
    .filter(seg => words(seg).length > 0)
    .map(piece)
  if (pieces.some(p => p.kind === 'control')) return ''
  const real = pieces.filter((p): p is { kind: 'real'; key: string } => p.kind === 'real')
  return real.length === 1 ? (real[0]?.key ?? '') : ''
}
