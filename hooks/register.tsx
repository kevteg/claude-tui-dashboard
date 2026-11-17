import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Component, Dashboard, Refresh, RefreshState, SavedDashboard, Series, Tone, Width } from '../types'

const PANE = 'dashboard'
const TOOL = 'render_dashboard'
// Change the tag when Dashboard's fields change: it declines what an earlier
// version stored, which outlives a reload.
const dashboard = atom({ plugin: 'tui-dashboard', key: 'dashboard' } as const, null, {
  shape: 'dashboard-1',
})

const refreshState = atom(
  { plugin: 'tui-dashboard', key: 'refresh' } as const,
  { approved: null, fingerprint: null, lastRunAt: 0, lastError: null, isRunning: false } as RefreshState,
  { shape: 'refresh-2' },
)
const lastSaved = atom({ plugin: 'tui-dashboard', key: 'lastSaved' } as const, null, {
  shape: 'last-saved-1',
})
// Saved dashboards live in one ordinary file, so every copy of the plugin (installed from any
// marketplace, or loaded from a folder while developing) sees the same list, and a person can copy
// or share it. Before this they were in $.store, which is private to each install.
const SAVED_FILE = '.claude-dashboards/saved.json'
const LEGACY_PREFIX = 'saved:'

// Refresh no faster than once a minute, and check for due refreshes this often.
const MIN_REFRESH_SECONDS = 60
const TICK_MS = 10_000

const PALETTE = ['cyan', 'yellow', 'magenta', 'green', 'blue', 'red', 'white', 'gray']
const TONE_COLOR: Record<Tone, string> = {
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
}
const FRACTION: Record<Width, number> = { full: 1, two_thirds: 2 / 3, half: 1 / 2, third: 1 / 3 }
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SPARKS = '▁▂▃▄▅▆▇█'

const series = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      values: { type: 'array', items: { type: 'number' } },
    },
    required: ['name', 'values'],
  },
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string', description: 'Time range, filters, source.' },
    components: {
      type: 'array',
      description: 'Drawn top to bottom.',
      items: {
        anyOf: [
          {
            type: 'object',
            properties: { type: { const: 'heading' }, text: { type: 'string' } },
            required: ['type', 'text'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'text' },
              text: { type: 'string' },
              dim: { type: 'boolean' },
            },
            required: ['type', 'text'],
          },
          {
            type: 'object',
            description: 'Headline numbers in a row of small boxes. 2-5 items.',
            properties: {
              type: { const: 'metrics' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string', description: 'Already formatted, e.g. "1,189,308".' },
                    hint: { type: 'string' },
                  },
                  required: ['label', 'value'],
                },
              },
            },
            required: ['type', 'items'],
          },
          {
            type: 'object',
            description:
              'Horizontal bars, one row per label. Several series draw one bar each per label, or one stacked bar with stacked: true. Up to ~20 labels.',
            properties: {
              type: { const: 'bar_chart' },
              title: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              series,
              stacked: { type: 'boolean' },
              unit: { type: 'string' },
            },
            required: ['type', 'labels', 'series'],
          },
          {
            type: 'object',
            description:
              'One sparkline row per series, for trends over time. labels (optional) names the first and last point.',
            properties: {
              type: { const: 'sparklines' },
              title: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              series,
            },
            required: ['type', 'series'],
          },
          {
            type: 'object',
            description: 'Rows of values. Keep it under ~25 rows.',
            properties: {
              type: { const: 'table' },
              title: { type: 'string' },
              columns: { type: 'array', items: { type: 'string' } },
              rows: {
                type: 'array',
                items: { type: 'array', items: { type: ['string', 'number'] } },
              },
            },
            required: ['type', 'columns', 'rows'],
          },
          {
            type: 'object',
            description:
              'Shares of a whole as a round pie with a legend of values and percentages. 2-8 slices; fold the smallest into "Other". Needs about 40 columns.',
            properties: {
              type: { const: 'pie_chart' },
              title: { type: 'string' },
              slices: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, value: { type: 'number' } },
                  required: ['label', 'value'],
                },
              },
              donut: { type: 'boolean' },
            },
            required: ['type', 'slices'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'callout' },
              tone: { enum: ['info', 'success', 'warning', 'error'] },
              title: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['type', 'tone', 'text'],
          },
        ],
      },
    },
  },
  required: ['title', 'components'],
}

INPUT_SCHEMA.properties = {
  ...INPUT_SCHEMA.properties,
  recipe: {
    type: 'string',
    description:
      'How the data was gathered: sources, queries, filters, scripts and anything non-obvious, written for a later session with none of this conversation. Saved with the dashboard when the person presses Save, so it can be rebuilt or updated.',
  },
  refresh: {
    type: 'object',
    description:
      'Optional auto-refresh: a command (argv, no shell) that prints the next dashboard as JSON on stdout ({ "title"?, "subtitle"?, "components": [...] }, components as in this tool). The pane runs it every every_seconds (at least 60) with no model turn, but only after the person presses Start in the pane, which shows them the command. Changing the command needs a new Start.',
    properties: {
      command: { type: 'array', items: { type: 'string' } },
      every_seconds: { type: 'number' },
    },
    required: ['command', 'every_seconds'],
  },
  size: {
    type: 'object',
    description:
      'The pane size wanted. columns: body width when docked beside the chat (capped at 45% of the terminal; 60-90 suits most dashboards, more for wide tables). rows: body height when shown above the prompt.',
    properties: { columns: { type: 'number' }, rows: { type: 'number' } },
  },
} as typeof INPUT_SCHEMA.properties
// Every component takes a width, so small charts can sit side by side.
for (const item of INPUT_SCHEMA.properties.components.items.anyOf) {
  ;(item.properties as Record<string, unknown>).width = {
    enum: ['full', 'two_thirds', 'half', 'third'],
    description:
      'Share of the pane row; consecutive components fill a row left to right. Default full. Use half or third for compact charts and metrics, full for tables and long labels.',
  }
}

const DESCRIPTION = [
  'Draws a dashboard in the terminal pane beside the chat, replacing what it showed.',
  'Use it when the person asks for a dashboard, a chart or a visual summary, and call it again with fresh numbers to update it.',
  'Lead with metrics, then charts, then a table of the detail, then callouts for anything that needs attention.',
  'Pass raw numbers to charts (the pane scales and formats them); pass formatted strings to metrics and tables.',
  'You decide the layout: size.columns asks for a pane width, and each component\'s width (full, two_thirds, half, third) places components side by side.',
  'Give charts room: a bar chart needs about 40 columns, a table the sum of its widest values.',
  'To keep a dashboard live without calling this tool again, pass refresh with a command that prints the next dashboard as JSON.',
  'Always pass a recipe, so a saved dashboard can be rebuilt later; list_saved_dashboards and open_saved_dashboard reach the saved ones.',
].join(' ')

function formatNumber(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
  const [whole = '', frac] = String(Math.abs(rounded)).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (rounded < 0 ? '-' : '') + grouped + (frac ? '.' + frac : '')
}

// Eighth-block precision keeps bars of close values visibly different.
function bar(value: number, max: number, width: number): string {
  if (max <= 0 || value <= 0) return ''
  const eighths = Math.round((value / max) * width * 8)
  return '█'.repeat(Math.floor(eighths / 8)) + EIGHTHS[eighths % 8]
}

function sparkline(values: number[]): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  return values
    .map(v => SPARKS[max === min ? 3 : Math.round(((v - min) / (max - min)) * 7)])
    .join('')
}

function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text
}

type Run = { text: string; backgroundColor?: string }

// A circle of square "pixels", each two cells wide (a terminal cell is about twice as tall as it
// is wide), painted with background colour. Half blocks would double the resolution, but they
// only fill the glyph's height, so terminals with extra line spacing show gaps between rows and
// stretch the circle into an oval. Angles run clockwise from 12.
function pieRows(values: number[], diameter: number, donut: boolean): Run[][] {
  const total = sum(values)
  const bounds: number[] = []
  let acc = 0
  for (const v of values) {
    acc += total > 0 ? v / total : 0
    bounds.push(acc)
  }
  const size = Math.max(1, Math.floor(diameter / 2))
  const radius = size / 2
  const pixel = (x: number, y: number): string | undefined => {
    const dx = x + 0.5 - radius
    const dy = y + 0.5 - radius
    const r = Math.sqrt(dx * dx + dy * dy) / radius
    if (r > 1 || (donut && r < 0.5)) return undefined
    const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1
    const slice = bounds.findIndex(b => turn < b)
    return PALETTE[(slice < 0 ? values.length - 1 : slice) % PALETTE.length]
  }
  const out: Run[][] = []
  for (let y = 0; y < size; y++) {
    const runs: Run[] = []
    for (let x = 0; x < size; x++) {
      const colour = pixel(x, y)
      const last = runs[runs.length - 1]
      if (last && last.backgroundColor === colour) {
        last.text += '  '
      } else {
        runs.push({ text: '  ', backgroundColor: colour })
      }
    }
    out.push(runs)
  }
  return out
}

// Consecutive components share a row until their widths would pass the full width.
function rows(components: Component[]): Component[][] {
  const out: Component[][] = []
  let used = 1
  for (const c of components) {
    const share = FRACTION[c.width ?? 'full']
    const last = out[out.length - 1]
    if (last && used + share <= 1.001) {
      last.push(c)
      used += share
    } else {
      out.push([c])
      used = share
    }
  }
  return out
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'dashboard'
  )
}

type SavedFile = { version: 1; dashboards: Record<string, SavedDashboard> }

function isSaved(v: unknown): v is SavedDashboard {
  return !!v && typeof v === 'object' && 'dashboard' in v && 'name' in v
}

async function savedPath($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set, so there is nowhere to keep saved dashboards')
  return `${home}/${SAVED_FILE}`
}

async function readSaved($: EngineInterface): Promise<SavedFile> {
  const path = await savedPath($)
  if (await $.fs.exists(path)) {
    const parsed = JSON.parse(await $.fs.read(path)) as Partial<SavedFile>
    return { version: 1, dashboards: parsed.dashboards ?? {} }
  }
  // First use of the file: bring along anything this install saved in $.store before it existed.
  const file: SavedFile = { version: 1, dashboards: {} }
  for (const key of await $.store.keys()) {
    const value = await $.store.get(key)
    if (key.startsWith(LEGACY_PREFIX) && isSaved(value)) file.dashboards[value.name] = value
  }
  if (Object.keys(file.dashboards).length > 0) await writeSaved($, file)
  return file
}

async function writeSaved($: EngineInterface, file: SavedFile): Promise<void> {
  await $.fs.write(await savedPath($), JSON.stringify(file, null, 2) + '\n')
}

async function savedList($: EngineInterface): Promise<SavedDashboard[]> {
  return Object.values((await readSaved($)).dashboards).filter(isSaved)
}

async function savedNamed($: EngineInterface, name: string): Promise<SavedDashboard | undefined> {
  const found = (await readSaved($)).dashboards[name]
  return isSaved(found) ? found : undefined
}

async function saveDashboard($: EngineInterface, entry: SavedDashboard): Promise<void> {
  const file = await readSaved($)
  file.dashboards[entry.name] = entry
  await writeSaved($, file)
}

async function deleteSaved($: EngineInterface, name: string): Promise<boolean> {
  const file = await readSaved($)
  if (!file.dashboards[name]) return false
  delete file.dashboards[name]
  await writeSaved($, file)
  return true
}

// Puts a saved dashboard back in the pane. Its refresh command still needs a Start in this session.
async function restore($: EngineInterface, saved: SavedDashboard): Promise<void> {
  await update($, dashboard, () => ({ ...saved.dashboard, updatedAt: `saved ${saved.savedAt}` }))
  await $.ui
    .open({
      id: PANE,
      title: saved.dashboard.title,
      columns: saved.dashboard.size?.columns,
      rows: saved.dashboard.size?.rows,
    })
    .catch(() => undefined)
}

function describeSaved(s: SavedDashboard): string {
  const d = s.dashboard
  return [
    `${s.name}: "${d.title}", saved ${s.savedAt}, ${d.components.length} components`,
    d.refresh ? `  refresh every ${d.refresh.everySeconds} s: ${d.refresh.command.join(' ')}` : '  no refresh command',
    d.recipe ? `  recipe: ${d.recipe}` : '  no recipe',
  ].join('\n')
}

function commandKey(refresh: Refresh): string {
  return JSON.stringify(refresh.command)
}

// Files in the command that hold code: the program itself and any script it is given. Data files
// the script reads are left out, since they change between runs by design.
const SCRIPT_FILE = /\.(py|js|mjs|cjs|ts|mts|tsx|jsx|sh|bash|zsh|fish|rb|pl|php|lua|r|jl|ps1)$/i

// Size and modification time of the command's code files, taken when the person presses Start.
// If any of them changes, the approval lapses and the pane asks for a new Start.
async function fingerprint($: EngineInterface, refresh: Refresh): Promise<string> {
  const parts: string[] = []
  for (const [index, arg] of refresh.command.entries()) {
    if (index > 0 && !SCRIPT_FILE.test(arg)) continue
    try {
      const stat = (await $.fs.stat(arg, { resolve: true })) as {
        kind?: string
        size?: number
        mtimeMs?: number
        realPath?: string
      }
      if (stat.kind === 'file') parts.push(`${stat.realPath ?? arg}:${stat.size}:${stat.mtimeMs}`)
    } catch {
      // Not a file this plugin can see (a program found on PATH, a flag): nothing to watch.
    }
  }
  return parts.join('\n')
}

async function approve($: EngineInterface, refresh: Refresh): Promise<void> {
  const print = await fingerprint($, refresh)
  await update($, refreshState, () => ({
    approved: commandKey(refresh),
    fingerprint: print,
    lastRunAt: 0,
    lastError: null,
    isRunning: false,
  }))
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

// Runs the approved refresh command when it is due and swaps in the dashboard it prints.
async function refreshIfDue($: EngineInterface): Promise<void> {
  const board = await read($, dashboard)
  const state = await read($, refreshState)
  const r = board?.refresh
  if (!board || !r || state.approved !== commandKey(r) || state.isRunning) return
  const now = await $.clock.now()
  if (state.lastRunAt > 0 && now - state.lastRunAt < r.everySeconds * 1000) return

  if ((await fingerprint($, r)) !== state.fingerprint) {
    await update($, refreshState, s => ({
      ...s,
      approved: null,
      fingerprint: null,
      isRunning: false,
      lastError: 'A file in the refresh command changed since Start. Check it, then press Start again.',
    }))
    return
  }

  await update($, refreshState, s => ({ ...s, isRunning: true }))
  let error: string | null = null
  try {
    const ran = await $.process.run(r.command, { timeoutMs: 5 * 60_000 })
    if (ran.exitCode !== 0) {
      error = `exit ${ran.exitCode}: ${ran.stderr.trim().split('\n').slice(-1)[0] ?? ''}`
    } else {
      const next = JSON.parse(ran.stdout) as Partial<Dashboard>
      if (!Array.isArray(next.components)) {
        error = 'output has no components array'
      } else {
        await update($, dashboard, b =>
          b && commandKey(b.refresh ?? { command: [], everySeconds: 0 }) === commandKey(r)
            ? {
                ...b,
                title: next.title ?? b.title,
                subtitle: next.subtitle ?? b.subtitle,
                components: next.components as Component[],
                updatedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              }
            : b,
        )
      }
    }
  } catch (caught) {
    error = String(caught)
  }
  await update($, refreshState, s => ({ ...s, isRunning: false, lastRunAt: now, lastError: error }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tui-dashboard',
      description: 'Open the dashboard pane; with a name, bring back a saved dashboard',
      argumentHint: '[name | list | delete <name>]',
    })
    await $.tool.register({
      name: 'list_saved_dashboards',
      description:
        'Lists the dashboards the person saved with the pane\'s Save button, in any session: name, title, when, its refresh command and its recipe (how the data was gathered).',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'open_saved_dashboard',
      description:
        'Puts a saved dashboard back in the pane as it was saved, and returns its recipe and components, so you can refresh or change it with render_dashboard. A saved refresh command needs the person to press Start again.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'A name from list_saved_dashboards.' } },
        required: ['name'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: TOOL,
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    // One ticker for the session; it does nothing unless the person approved the current command.
    $.clock.every(TICK_MS, () => {
      void refreshIfDue($)
    })

    return next(e)
  })

  on('command.run', { command: 'tui-dashboard' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    if (verb === 'list') {
      const all = await savedList($)
      return {
        text: all.length
          ? all.map(describeSaved).join('\n')
          : 'No saved dashboards yet. Press Save in the dashboard pane to keep one.',
      }
    }
    if (verb === 'delete') {
      const name = rest.join(' ')
      if (!(await deleteSaved($, name))) return { text: `No saved dashboard named "${name}".` }
      return { text: `Deleted the saved dashboard "${name}".` }
    }
    if (verb) {
      const saved = await savedNamed($, verb)
      if (!saved) return { text: `No saved dashboard named "${verb}". Try /tui-dashboard list.` }
      await restore($, saved)
      return { text: `Opened "${saved.dashboard.title}", saved ${saved.savedAt}.` }
    }
    const opened = await $.ui
      .open({ id: PANE, title: 'Dashboard' })
      .catch((error: unknown) => ({ isPlaced: false, reason: String(error) }))

    return { text: opened.isPlaced ? 'Dashboard pane opened.' : `Could not open the pane: ${opened.reason}` }
  }).catch(() => ({ text: 'The dashboard command failed; try again.' }))

  on('tool.call', { tool: 'mcp__tui-dashboard__list_saved_dashboards' }, async $ => {
    const all = await savedList($)
    return { result: all.length ? all.map(describeSaved).join('\n\n') : 'No saved dashboards.' }
  }).catch(() => ({ deny: 'Could not read the saved dashboards; try again.' }))

  on('tool.call', { tool: 'mcp__tui-dashboard__open_saved_dashboard' }, async ($, e) => {
    const name = String((e as unknown as { name?: unknown }).name ?? '')
    const saved = await savedNamed($, name)
    if (!saved) return { deny: `No saved dashboard named "${name}"; call list_saved_dashboards.` }
    await restore($, saved)
    return {
      result: [
        describeSaved(saved),
        'It is back in the pane as saved. To update it, call render_dashboard with the same title, recipe and refresh.',
        `Components as saved: ${JSON.stringify(saved.dashboard.components)}`,
      ].join('\n\n'),
    }
  }).catch(() => ({ deny: 'Could not open the saved dashboard; try again.' }))

  on('tool.call', { tool: 'mcp__tui-dashboard__render_dashboard' }, async ($, e) => {
    const input = e as unknown as Partial<Dashboard> & {
      refresh?: { command?: unknown; every_seconds?: unknown }
    }
    if (!input.title || !Array.isArray(input.components)) {
      return { deny: 'render_dashboard needs a title and a components array.' }
    }
    let refresh: Refresh | undefined
    if (input.refresh) {
      const { command, every_seconds } = input.refresh
      if (!Array.isArray(command) || command.length === 0 || !command.every(a => typeof a === 'string')) {
        return { deny: 'refresh.command must be a non-empty array of strings (argv, no shell).' }
      }
      refresh = {
        command: command as string[],
        everySeconds: Math.max(MIN_REFRESH_SECONDS, Number(every_seconds) || MIN_REFRESH_SECONDS),
      }
    }
    const saved = await update($, dashboard, () => ({
      title: input.title as string,
      subtitle: input.subtitle,
      size: input.size,
      refresh,
      recipe: typeof (input as { recipe?: unknown }).recipe === 'string' ? (input as { recipe: string }).recipe : undefined,
      components: input.components as Component[],
      updatedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    })).then(
      () => true,
      () => false,
    )
    if (!saved) return { deny: 'The dashboard could not be saved; try again.' }
    const opened = await $.ui
      .open({ id: PANE, title: input.title, columns: input.size?.columns, rows: input.size?.rows })
      .catch((error: unknown) => ({ isPlaced: false, reason: String(error) }))
    const where = opened.isPlaced
      ? 'It is showing in the dashboard pane.'
      : 'The pane is not showing yet (a narrow terminal holds it back); the person can open it with /tui-dashboard.'
    const state = await read($, refreshState)
    const auto = !refresh
      ? ''
      : state.approved === commandKey(refresh)
        ? ` Auto-refresh is on, every ${refresh.everySeconds} s.`
        : ' Auto-refresh waits for the person to press Start in the pane.'

    return { result: `Drew "${input.title}" with ${input.components.length} components. ${where}${auto}` }
  }).catch(() => ({ deny: 'render_dashboard failed before drawing; try again.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { Button } = $.ui.resolve(e)
    const board = await read($, dashboard)
    const auto = await read($, refreshState)
    const saved = await read($, lastSaved)
    const props = e.props as { bodyColumns?: number }
    const columns = e.viewport?.columns ?? props.bodyColumns ?? 60

    if (!board) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No dashboard yet.</Text>
          <Text dimColor>Ask Claude for one, e.g. "make me a dashboard of …".</Text>
        </Box>
      )
    }

    const refreshBar = (r: Refresh) => {
      const key = commandKey(r)
      if (auto.approved !== key) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text bold color="yellow">Auto-refresh every {r.everySeconds} s is off</Text>
            <Text dimColor>Pressing Start lets this pane run, on your machine, as you:</Text>
            <Text>{r.command.join(' ')}</Text>
            {auto.lastError && <Text color="red">{fit(auto.lastError, 100)}</Text>}
            <Button
              key="start-refresh"
              variant="primary"
              onPress={() => {
                void approve($, r)
              }}
            >
              Start auto-refresh
            </Button>
          </Box>
        )
      }
      return (
        <Box flexDirection="row" columnGap={2}>
          <Text color="green">● Auto-refresh every {r.everySeconds} s</Text>
          <Text dimColor>
            {auto.isRunning ? 'refreshing…' : auto.lastRunAt ? `last run ${clockTime(auto.lastRunAt)}` : 'starting…'}
          </Text>
          {auto.lastError && <Text color="red">{fit(auto.lastError, 80)}</Text>}
          <Button
            key="stop-refresh"
            onPress={() => {
              void update($, refreshState, s => ({ ...s, approved: null, fingerprint: null, lastError: null, isRunning: false }))
            }}
          >
            Stop
          </Button>
        </Box>
      )
    }

    const legend = (list: Series[]) =>
      list.length > 1 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {list.map((s, i) => (
            <Text color={PALETTE[i % PALETTE.length]}>■ {s.name}</Text>
          ))}
        </Box>
      )

    const titled = (title: string | undefined, body: RenderChildren) => (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {title && <Text bold>{title}</Text>}
        {body}
      </Box>
    )

    // avail is the columns this component was given; a bordered box takes 2 of border and 2 of padding.
    const draw = (c: Component, avail: number) => {
      switch (c.type) {
        case 'heading':
          return <Text bold color="cyan">{c.text}</Text>
        case 'text':
          return <Text dimColor={c.dim}>{c.text}</Text>
        case 'metrics':
          return (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {c.items.map(m => (
                <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                  <Text dimColor>{m.label}</Text>
                  <Text bold>{m.value}</Text>
                  {m.hint && <Text dimColor>{m.hint}</Text>}
                </Box>
              ))}
            </Box>
          )
        case 'bar_chart': {
          const labelWidth = Math.min(18, Math.max(...c.labels.map(l => l.length)))
          const values = c.labels.map((_, i) => c.series.map(s => s.values[i] ?? 0))
          const totals = values.map(sum)
          const valueWidth =
            Math.max(...(c.stacked ? totals : values.flat()).map(v => formatNumber(v).length)) +
            (c.unit ? c.unit.length + 1 : 0)
          const width = Math.max(5, avail - 4 - labelWidth - valueWidth - 2)
          const show = (v: number) => formatNumber(v) + (c.unit ? ' ' + c.unit : '')

          if (c.stacked) {
            const max = Math.max(...totals)
            return titled(
              c.title,
              <Box flexDirection="column">
                {c.labels.map((label, i) => (
                  <Box flexDirection="row" columnGap={1}>
                    <Text>{fit(label, labelWidth).padEnd(labelWidth)}</Text>
                    <Box flexDirection="row" width={width}>
                      {(values[i] ?? []).map((v, s) => (
                        <Text color={PALETTE[s % PALETTE.length]}>
                          {'█'.repeat(Math.round((v / max) * width))}
                        </Text>
                      ))}
                    </Box>
                    <Text>{show(totals[i] ?? 0)}</Text>
                  </Box>
                ))}
                {legend(c.series)}
              </Box>,
            )
          }

          const max = Math.max(...values.flat())
          return titled(
            c.title,
            <Box flexDirection="column">
              {c.labels.map((label, i) =>
                c.series.map((s, j) => (
                  <Box flexDirection="row" columnGap={1}>
                    <Text>{(j === 0 ? fit(label, labelWidth) : '').padEnd(labelWidth)}</Text>
                    <Box width={width}>
                      <Text color={PALETTE[j % PALETTE.length]}>{bar(values[i]?.[j] ?? 0, max, width)}</Text>
                    </Box>
                    <Text>{show(values[i]?.[j] ?? 0)}</Text>
                  </Box>
                )),
              )}
              {legend(c.series)}
            </Box>,
          )
        }
        case 'sparklines': {
          const nameWidth = Math.min(22, Math.max(...c.series.map(s => s.name.length)))
          return titled(
            c.title,
            <Box flexDirection="column">
              {c.series.map((s, i) => (
                <Box flexDirection="row" columnGap={1}>
                  <Text>{fit(s.name, nameWidth).padEnd(nameWidth)}</Text>
                  <Text color={PALETTE[i % PALETTE.length]}>{sparkline(s.values)}</Text>
                  <Text dimColor>
                    {formatNumber(Math.min(...s.values))}–{formatNumber(Math.max(...s.values))}, last{' '}
                    {formatNumber(s.values[s.values.length - 1] ?? 0)}
                  </Text>
                </Box>
              ))}
              {c.labels && c.labels.length > 1 && (
                <Text dimColor>
                  {c.labels[0]} → {c.labels[c.labels.length - 1]}
                </Text>
              )}
            </Box>,
          )
        }
        case 'table': {
          const cells = c.rows.map(r => r.map(v => (typeof v === 'number' ? formatNumber(v) : v)))
          const isNumeric = c.columns.map((_, j) => c.rows.every(r => typeof r[j] === 'number'))
          const natural = c.columns.map((h, j) =>
            Math.max(h.length, ...cells.map(r => (r[j] ?? '').length)),
          )
          // Shrink the widest column until the table fits the pane.
          const widths = [...natural]
          const room = Math.max(8, avail - 4 - (widths.length - 1) * 2)
          while (sum(widths) > room && Math.max(...widths) > 4) {
            const widest = widths.indexOf(Math.max(...widths))
            widths[widest] = (widths[widest] ?? 0) - 1
          }
          const line = (row: string[]) =>
            row
              .map((v, j) => {
                const w = widths[j] ?? 0
                return isNumeric[j] ? fit(v ?? '', w).padStart(w) : fit(v ?? '', w).padEnd(w)
              })
              .join('  ')
          return titled(
            c.title,
            <Box flexDirection="column">
              <Text bold>{line(c.columns)}</Text>
              <Text dimColor>{'─'.repeat(Math.min(room, sum(widths) + (widths.length - 1) * 2))}</Text>
              {cells.map(r => (
                <Text>{line(r)}</Text>
              ))}
            </Box>,
          )
        }
        case 'pie_chart': {
          const values = c.slices.map(s => Math.max(0, s.value))
          const total = sum(values)
          // The legend always goes below, so the pie gets the column's width, up to 32 cells.
          const room = avail - 4
          const diameter = Math.max(12, Math.min(32, room - (room % 2)))
          const legend = (
            <Box flexDirection="column">
              {c.slices.map((s, i) => (
                <Box flexDirection="row" columnGap={1}>
                  <Text color={PALETTE[i % PALETTE.length]}>■</Text>
                  <Box flexShrink={1}>
                    <Text wrap="wrap">{s.label}</Text>
                  </Box>
                  <Text bold>{formatNumber(values[i] ?? 0)}</Text>
                  <Text dimColor>{total > 0 ? (((values[i] ?? 0) / total) * 100).toFixed(1) + '%' : ''}</Text>
                </Box>
              ))}
              <Text dimColor>Total {formatNumber(total)}</Text>
            </Box>
          )
          return titled(
            c.title,
            <Box flexDirection="column" rowGap={1}>
              <Box flexDirection="column">
                {pieRows(values, diameter, c.donut ?? false).map(runs => (
                  <Box flexDirection="row">
                    {runs.map(r => (
                      <Text backgroundColor={r.backgroundColor}>{r.text}</Text>
                    ))}
                  </Box>
                ))}
              </Box>
              {legend}
            </Box>,
          )
        }
        case 'callout':
          return (
            <Box flexDirection="column" borderStyle="round" borderColor={TONE_COLOR[c.tone]} paddingX={1}>
              {c.title && (
                <Text bold color={TONE_COLOR[c.tone]}>
                  {c.title}
                </Text>
              )}
              <Text>{c.text}</Text>
            </Box>
          )
        default:
          return <Text dimColor>(unknown component)</Text>
      }
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={2}>
            <Text bold>{board.title}</Text>
            <Button
              key="save-dashboard"
              onPress={() => {
                const name = slug(board.title)
                const at = new Date().toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
                const entry: SavedDashboard = { name, savedAt: at, dashboard: board }
                void saveDashboard($, entry)
                  .then(() => update($, lastSaved, () => ({ name, at })))
                  .then(() => $.ui.toast(`Saved as "${name}". Bring it back with /tui-dashboard ${name}`))
                  .catch((error: unknown) => $.ui.toast(`Could not save: ${String(error)}`))
              }}
            >
              Save
            </Button>
            {saved && saved.name === slug(board.title) && <Text dimColor>saved as {saved.name}, {saved.at}</Text>}
          </Box>
          {board.subtitle && <Text dimColor>{board.subtitle}</Text>}
          <Text dimColor>Updated {board.updatedAt}</Text>
        </Box>
        {board.refresh && refreshBar(board.refresh)}
        {rows(board.components).map(row => {
          const gaps = row.length - 1
          return (
            <Box flexDirection="row" columnGap={1}>
              {row.map(c => {
                const share = Math.max(12, Math.floor((columns - gaps) * FRACTION[c.width ?? 'full']))
                return (
                  <Box flexDirection="column" width={share}>
                    {draw(c, share)}
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
