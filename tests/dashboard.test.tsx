import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'terminal-dashboard',
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

async function start($: any, on: any) {
  const clock = mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'terminal-dashboard' } }))
  on('tool.register', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return clock
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
    tool: 'mcp__terminal-dashboard__render_dashboard',
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
  const ran = await $.tool.call({ tool: 'mcp__terminal-dashboard__render_dashboard', title: 'x' })

  expect((ran as { deny?: string }).deny).toMatch(/components/)
})

test('components with width half share a row and still draw', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'mcp__terminal-dashboard__render_dashboard',
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
    tool: 'mcp__terminal-dashboard__render_dashboard',
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
  expect((await ui.findAll({ type: 'Text', text: /[▀▄]/ })).length).toBeGreaterThan(10)
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
    tool: 'mcp__terminal-dashboard__render_dashboard',
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
    tool: 'mcp__terminal-dashboard__render_dashboard',
    title: 'Live',
    components: [],
    refresh: { command: 'rm -rf /', every_seconds: 60 },
  })

  expect((ran as { deny?: string }).deny).toMatch(/argv/)
})

test('Save keeps the dashboard and its recipe, and /terminal-dashboard brings it back', async ($, on) => {
  await start($, on)
  await $.tool.call({
    tool: 'mcp__terminal-dashboard__render_dashboard',
    title: 'Orders Today!',
    recipe: 'Counted from orders.csv, grouped by channel.',
    components: [{ type: 'metrics', items: [{ label: 'Orders', value: '42' }] }],
    refresh: { command: ['/bin/orders-dashboard'], every_seconds: 120 },
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'save-dashboard' })
  expect(await ui.find({ type: 'Text', text: /saved as orders-today/ })).toBeTruthy()
  await ui.unmount()

  const listed = await $.tool.call({ tool: 'mcp__terminal-dashboard__list_saved_dashboards' })
  expect(String((listed as { result?: unknown }).result)).toMatch(/orders-today: "Orders Today!".*\n.*every 120 s: \/bin\/orders-dashboard\n.*recipe: Counted from orders.csv/)

  await $.tool.call({
    tool: 'mcp__terminal-dashboard__render_dashboard',
    title: 'Something else',
    components: [{ type: 'text', text: 'other' }],
  })
  const opened = await $.tool.call({ tool: 'mcp__terminal-dashboard__open_saved_dashboard', name: 'orders-today' })
  expect(String((opened as { result?: unknown }).result)).toMatch(/back in the pane/)

  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Text', text: /^42$/ })).toBeTruthy()
  expect(await again.find({ type: 'Text', text: /every 120 s is off/ })).toBeTruthy()
  await again.unmount()
})

test('opening a dashboard nobody saved is refused', async ($, on) => {
  await start($, on)
  const opened = await $.tool.call({ tool: 'mcp__terminal-dashboard__open_saved_dashboard', name: 'nope' })

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
    tool: 'mcp__terminal-dashboard__render_dashboard',
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
