import { expect, test } from 'claude-code/testing'

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
  on('command.register', () => ({ value: { command: 'tui-dashboard' } }))
  on('tool.register', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
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
