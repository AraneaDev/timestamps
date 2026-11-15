export type LiveCall = {
  /** tool_use_id, or a minted id when the call has none */
  id: string
  tool: string
  /** the command-memory key, for a foreground Bash call */
  key?: string
  /** epoch ms */
  startedAt: number
  /** the subagent or teammate loop it runs in; absent on the main loop */
  agentId?: string
  /** it went to a permission prompt, so its elapsed time includes the person's */
  isAsked?: boolean
}

export type PaneOutcome = 'ok' | 'fail' | 'limit'

/** One turn of the session; every time is epoch seconds. */
export type PaneTurn = { n: number; start: number; secs: number; how: 'stop' | 'interrupted' | 'error' | 'running' }

/** A call that took five seconds or more, or was stopped at its limit. */
export type PaneCall = { at: number; ms: number; tool: string; key: string | null; outcome: PaneOutcome; isSubagent: boolean }

/** A check run this session; `changed` is null where it is not known. */
export type PaneCheck = { key: string; outcome: PaneOutcome; at: number; changed: number | null }

/** One command of this project's command memory. */
export type PaneCommand = {
  key: string
  runs: number
  medianMs: number
  lastMs: number
  failed: number
  stopped: number
  limitMs: number
  maxMs: number
}

/** A note the plugin sent the model. */
export type PaneNote = { at: number; kind: string; text: string }

/** A finished session from the history file. */
export type PaneSession = { when: string; secs: number; turns: number; waited: number; idle: number; project: string | null }

/** Everything the pane draws, as `setup.sh --pane` reported it (hooks/mod/pane-data.ts). */
export type PaneData = {
  /** epoch seconds the report was made */
  now: number
  project: string | null
  /** false where this session has no record yet: the memory and the history are still there */
  hasSession: boolean
  started: number | null
  elapsed: number
  waiting: number
  away: number
  turns: PaneTurn[]
  calls: PaneCall[]
  checks: PaneCheck[]
  commands: PaneCommand[]
  told: PaneNote[]
  history: PaneSession[]
  /** the zone clock times are shown in; null for the machine's own */
  tz: string | null
}

export type PaneTab = 'overview' | 'turns' | 'commands' | 'checks' | 'told' | 'history'

/** Where the person is in the pane: the open tab, the marked row in it, and the order of its list. */
export type PaneView = { tab: PaneTab; marker: number; isByTime: boolean }

declare module 'claude-code' {
  interface PluginState {
    'timestamps': {
      running: LiveCall[]
      /** epoch ms of the open main turn; null between turns */
      turnStartedAt: number | null
      /** the last main turn's duration, ms; null before the first */
      lastTurnMs: number | null
      /** epoch ms, the mod's own fallback when bash's .start is unreadable */
      sessionStartedAt: number | null
      /** the footer label the clock draws; null draws none */
      clockText: string | null
      /** what the /timestamps pane draws; null until it is first opened */
      pane: PaneData | null
      /** the pane's open tab, marked row and list order */
      paneView: PaneView
    }
  }
}
