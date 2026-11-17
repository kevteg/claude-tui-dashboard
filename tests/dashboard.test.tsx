import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'tui-dashboard',
  component: 'Pane',
  requestId: 'dashboard',
  surface: 'terminal',
  viewport: { columns: 70, rows: 60 },
  props: {
    title: 'Dashboard',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const DAYS = ['Mon', 'Tue', 'Wed']

// Saved dashboards go to $HOME/.claude-dashboards/saved.json; the tests keep that file in memory.
const SAVED = '/home/test/.claude-dashboards/saved.json'

function memoryFs(on: any): Map<string, string> {
  const files = new Map<string, string>()
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: files.has(e.path) }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  return files
}

// The harness fills in a command run's origin and presentation, so tests pass only what they set.
function runCommand($: any, args: string): Promise<unknown> {
  return $.command.run({ command: 'tui-dashboard', args })
}

async function start($: any, on: any, store?: Record<string, unknown>) {
  const clock = mock.clock(on)
  mock.store(on, store)
  mock.env(on, { HOME: '/home/test' })
  const files = memoryFs(on)
  on('command.register', () => ({ value: { command: 'tui-dashboard' } }))
  on('tool.register', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { advance: (ms: number) => clock.advance(ms), files }
}

test('the pane says so before any dashboard', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(PANE)

  expect((await ui.find({ type: 'Text', text: /No dashboard yet/ }))?.text).toBe('No dashboard yet.')
  await ui.unmount()
})

test('a render_dashboard call draws metrics, bars, sparklines and a table', async ($, on) => {
  await start($, on)
  const ran = await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Orders shipped per day',
    subtitle: 'Last 3 days',
    components: [
      { type: 'metrics', items: [{ label: 'Total sent', value: '522,009' }] },
      {
        type: 'bar_chart',
        title: 'Shipped per day',
        labels: DAYS,
        series: [
          { name: 'Online', values: [170341, 168720, 166908] },
          { name: 'In store', values: [6100, 4991, 4949] },
        ],
        stacked: true,
      },
      { type: 'sparklines', series: [{ name: 'New customers', values: [18673, 16693, 12066] }] },
      { type: 'table', columns: ['Day', 'Total'], rows: DAYS.map((d, i) => [d, [176441, 173711, 171857][i] ?? 0]) },
      { type: 'callout', tone: 'warning', title: 'Returns high', text: 'Today is 1.7x a normal day.' },
    ],
  })
  expect(String((ran as { result?: unknown }).result)).toMatch(/Drew "Orders/)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /Orders shipped/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^522,009$/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^176,441$/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^█+$/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^█▆▁$/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /Wed\s+171,857/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /1\.7x/ }))).toBeTruthy()
  await ui.unmount()
})

test('a call without components is refused', async ($, on) => {
  await start($, on)
  const ran = await $.tool.call({ tool: 'mcp__tui-dashboard__render_dashboard', title: 'x' })

  expect((ran as { deny?: string }).deny).toMatch(/components/)
})

test('components with width half share a row and still draw', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Side by side',
    size: { columns: 90 },
    components: [
      { type: 'sparklines', width: 'half', series: [{ name: 'A', values: [1, 2, 3] }] },
      { type: 'sparklines', width: 'half', series: [{ name: 'B', values: [3, 2, 1] }] },
      { type: 'table', columns: ['Day', 'Total'], rows: [['Mon', 1]] },
    ],
  })
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: /^▁▅█$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^█▅▁$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Mon\s+1/ })).toBeTruthy()
  await ui.unmount()
})

test('a pie chart draws a round pie and a legend with percentages', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Orders',
    components: [
      {
        type: 'pie_chart',
        title: 'By category',
        slices: [
          { label: 'Online', value: 300 },
          { label: 'In store', value: 100 },
        ],
      },
    ],
  })
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: /^75\.0%$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^25\.0%$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Total 400/ })).toBeTruthy()
  // Painted cells: runs of spaces, two per pixel.
  expect((await ui.findAll({ type: 'Text', text: /^( {2})+$/ })).length).toBeGreaterThan(10)
  await ui.unmount()
})

test('auto-refresh shows its command and waits for Start, then Stop turns it off', async ($, on) => {
  let runs = 0
  on('process.run', () => {
    runs += 1
    return { value: { exitCode: 0, stdout: '{"components": []}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await start($, on)
  const ran = await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Live',
    components: [{ type: 'text', text: 'hello' }],
    refresh: { command: ['./print-dashboard', '--fast'], every_seconds: 5 },
  })
  expect(String((ran as { result?: unknown }).result)).toMatch(/waits for the person to press Start/)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /every 60 s is off/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: './print-dashboard --fast' })).toBeTruthy()
  expect(runs).toBe(0)

  await ui.press({ key: 'start-refresh' })
  expect(await ui.find({ type: 'Text', text: /● Auto-refresh every 60 s/ })).toBeTruthy()

  await ui.press({ key: 'stop-refresh' })
  expect(await ui.find({ type: 'Text', text: /every 60 s is off/ })).toBeTruthy()
  await ui.unmount()
})

test('a refresh command that is not a list of strings is refused', async ($, on) => {
  await start($, on)
  const ran = await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Live',
    components: [],
    refresh: { command: 'rm -rf /', every_seconds: 60 },
  })

  expect((ran as { deny?: string }).deny).toMatch(/argv/)
})

test('Save keeps the dashboard and its recipe, and /tui-dashboard brings it back', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Orders Today!',
    recipe: 'Counted from orders.csv, grouped by channel.',
    components: [{ type: 'metrics', items: [{ label: 'Orders', value: '42' }] }],
    refresh: { command: ['/bin/orders-dashboard'], every_seconds: 120 },
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'save-dashboard' })
  expect(await ui.find({ type: 'Text', text: /saved as orders-today/ })).toBeTruthy()
  await ui.unmount()

  const listed = await $.tool.call({ tool: 'mcp__tui-dashboard__list_saved_dashboards' })
  expect(String((listed as { result?: unknown }).result)).toMatch(/orders-today: "Orders Today!".*\n.*every 120 s: \/bin\/orders-dashboard\n.*recipe: Counted from orders.csv/)

  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Something else',
    components: [{ type: 'text', text: 'other' }],
  })
  const opened = await $.tool.call({ tool: 'mcp__tui-dashboard__open_saved_dashboard', name: 'orders-today' })
  expect(String((opened as { result?: unknown }).result)).toMatch(/back in the pane/)

  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /^42$/ })).toBeTruthy()
  expect(await again.find({ type: 'Text', text: /every 120 s is off/ })).toBeTruthy()
  await again.unmount()
})

test('opening a dashboard nobody saved is refused', async ($, on) => {
  await start($, on)
  const opened = await $.tool.call({ tool: 'mcp__tui-dashboard__open_saved_dashboard', name: 'nope' })

  expect((opened as { deny?: string }).deny).toMatch(/list_saved_dashboards/)
})

test('after Start, the pane runs the command on its timer and draws what it prints', async ($, on) => {
  const ran: string[][] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    ran.push([...e.argv])
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ components: [{ type: 'metrics', items: [{ label: 'Live', value: '7' }] }] }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  const clock = await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Live',
    components: [{ type: 'text', text: 'first frame' }],
    refresh: { command: ['/bin/print-dashboard'], every_seconds: 60 },
  })
  await clock.advance(30_000)
  expect(ran).toHaveLength(0)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'start-refresh' })
  await clock.advance(10_000)
  expect(ran).toEqual([['/bin/print-dashboard']])
  expect(await ui.find({ type: 'Text', text: /^7$/ })).toBeTruthy()

  await clock.advance(30_000)
  expect(ran).toHaveLength(1)
  await clock.advance(30_000)
  expect(ran).toHaveLength(2)
  await ui.unmount()
})

test('the legend goes below the pie with full labels', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Narrow',
    components: [
      {
        type: 'pie_chart',
        width: 'half',
        slices: [
          { label: 'Went quiet: found nothing this week', value: 3 },
          { label: 'Healthy', value: 1 },
        ],
      },
    ],
  })
  const ui = await $.ui.mount({ ...PANE, viewport: { columns: 100, rows: 60 } })

  expect(await ui.find({ type: 'Text', text: 'Went quiet: found nothing this week' })).toBeTruthy()
  // The pie is at most 32 cells wide.
  const cells = await ui.findAll({ type: 'Text', text: /^( {2})+$/ })
  expect(cells.length).toBeGreaterThan(0)
  expect(Math.max(...cells.map(t => t.text.length))).toBeLessThanOrEqual(32)
  await ui.unmount()
})

test('saves go to saved.json, which another install of the plugin reads', async ($, on) => {
  const { files } = await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Shared',
    components: [{ type: 'text', text: 'hi' }],
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'save-dashboard' })
  await ui.unmount()

  const written = JSON.parse(files.get(SAVED) ?? '{}')
  expect(Object.keys(written.dashboards)).toEqual(['shared'])
  expect(written.dashboards.shared.dashboard.title).toBe('Shared')
})

test('the first read brings along dashboards saved in the old private store', async ($, on) => {
  const old = { name: 'old-one', savedAt: 'Nov 1, 9:00 AM', dashboard: { title: 'Old one', components: [], updatedAt: 'x' } }
  const { files } = await start($, on, { 'saved:old-one': old, unrelated: 1 })

  const listed = await $.tool.call({ tool: 'mcp__tui-dashboard__list_saved_dashboards' })
  expect(String((listed as { result?: unknown }).result)).toMatch(/old-one: "Old one"/)
  expect(Object.keys(JSON.parse(files.get(SAVED) ?? '{}').dashboards)).toEqual(['old-one'])
})

test('when the refresh script changes after Start, the pane stops and asks for a new Start', async ($, on) => {
  const ran: string[][] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    ran.push([...e.argv])
    return {
      value: { exitCode: 0, stdout: '{"components": []}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  let mtimeMs = 1_000
  const statted: string[] = []
  on('fs.stat', (_: unknown, e: { path: string }) => {
    statted.push(e.path)
    if (e.path === '/home/test/dash.py') return { value: { kind: 'file', size: 120, mtimeMs, isLink: false } }
    if (e.path === '/usr/bin/python3') return { value: { kind: 'file', size: 9000, mtimeMs: 1, isLink: false } }
    throw new Error(`ENOENT: ${e.path}`)
  })
  const clock = await start($, on)
  await $.tool.call({
    tool: 'mcp__tui-dashboard__render_dashboard',
    title: 'Live',
    components: [{ type: 'text', text: 'first frame' }],
    refresh: { command: ['/usr/bin/python3', '/home/test/dash.py', '/var/log/app.log'], every_seconds: 60 },
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'start-refresh' })
  await clock.advance(10_000)
  expect(ran).toHaveLength(1)
  // The data file the script reads is not watched: it changes between runs by design.
  expect(statted).not.toContain('/var/log/app.log')

  mtimeMs = 2_000
  await clock.advance(70_000)
  expect(ran).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /every 60 s is off/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /changed since Start/ })).toBeTruthy()

  await ui.press({ key: 'start-refresh' })
  await clock.advance(10_000)
  expect(ran).toHaveLength(2)
  await ui.unmount()
})

test('/tui-dashboard list opens a picker, and picking one opens that dashboard', async ($, on) => {
  await start($, on)
  for (const title of ['Orders Today', 'Signups']) {
    await $.tool.call({
      tool: 'mcp__tui-dashboard__render_dashboard',
      title,
      components: [{ type: 'metrics', items: [{ label: title, value: title.length.toString() }] }],
    })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'save-dashboard' })
    await ui.unmount()
  }

  const listed = await runCommand($, 'list')
  expect(String((listed as { text?: unknown }).text)).toMatch(/2 saved dashboards in the pane/)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: 'Saved dashboards' })).toBeTruthy()
  await ui.select({ key: 'saved-picker', value: 'orders-today' })
  expect(await ui.find({ type: 'Text', text: 'Orders Today' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Saved dashboards' })).toBeFalsy()
  await ui.unmount()
})

test('/tui-dashboard list with nothing saved says so', async ($, on) => {
  await start($, on)
  const listed = await runCommand($, 'list')

  expect(String((listed as { text?: unknown }).text)).toMatch(/No saved dashboards yet/)
})
