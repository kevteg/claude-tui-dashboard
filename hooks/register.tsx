import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Component, Dashboard, Series, Tone, Width } from '../types'

const PANE = 'dashboard'
const TOOL = 'render_dashboard'
// Change the tag when Dashboard's fields change: it declines what an earlier
// version stored, which outlives a reload.
const dashboard = atom({ plugin: 'terminal-dashboard', key: 'dashboard' } as const, null, {
  shape: 'dashboard-1',
})

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

type Run = { text: string; color?: string; backgroundColor?: string }

// A circle of square "pixels": each cell holds two, top and bottom, drawn with half blocks,
// since a terminal cell is about twice as tall as it is wide. Angles run clockwise from 12.
function pieRows(values: number[], diameter: number, donut: boolean): Run[][] {
  const total = sum(values)
  const bounds: number[] = []
  let acc = 0
  for (const v of values) {
    acc += total > 0 ? v / total : 0
    bounds.push(acc)
  }
  const radius = diameter / 2
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
  for (let row = 0; row < diameter / 2; row++) {
    const runs: Run[] = []
    for (let x = 0; x < diameter; x++) {
      const top = pixel(x, row * 2)
      const bottom = pixel(x, row * 2 + 1)
      const cell: Run =
        top && bottom
          ? { text: '▀', color: top, backgroundColor: bottom }
          : top
            ? { text: '▀', color: top }
            : bottom
              ? { text: '▄', color: bottom }
              : { text: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor) {
        last.text += cell.text
      } else {
        runs.push(cell)
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

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tui-dashboard',
      description: 'Open the dashboard pane Claude draws with render_dashboard',
    })
    await $.tool.register({
      name: TOOL,
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })

    return next(e)
  })

  on('command.run', { command: 'tui-dashboard' }, async $ => {
    const opened = await $.ui
      .open({ id: PANE, title: 'Dashboard' })
      .catch((error: unknown) => ({ isPlaced: false, reason: String(error) }))

    return { text: opened.isPlaced ? 'Dashboard pane opened.' : `Could not open the pane: ${opened.reason}` }
  })

  on('tool.call', { tool: 'mcp__terminal-dashboard__render_dashboard' }, async ($, e) => {
    const input = e as unknown as Partial<Dashboard>
    if (!input.title || !Array.isArray(input.components)) {
      return { deny: 'render_dashboard needs a title and a components array.' }
    }
    const saved = await update($, dashboard, () => ({
      title: input.title as string,
      subtitle: input.subtitle,
      size: input.size,
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

    return { result: `Drew "${input.title}" with ${input.components.length} components. ${where}` }
  }).catch(() => ({ deny: 'render_dashboard failed before drawing; try again.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const board = await read($, dashboard)
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
          const legendWidth = Math.max(...c.slices.map(s => s.label.length)) + 22
          const sideBySide = avail - 4 >= 24 + legendWidth
          const room = sideBySide ? avail - 4 - legendWidth - 2 : avail - 4
          const diameter = Math.max(12, Math.min(28, room - (room % 2)))
          const legend = (
            <Box flexDirection="column" justifyContent="center">
              {c.slices.map((s, i) => (
                <Box flexDirection="row" columnGap={1}>
                  <Text color={PALETTE[i % PALETTE.length]}>■</Text>
                  <Text>{s.label}</Text>
                  <Text bold>{formatNumber(values[i] ?? 0)}</Text>
                  <Text dimColor>{total > 0 ? (((values[i] ?? 0) / total) * 100).toFixed(1) + '%' : ''}</Text>
                </Box>
              ))}
              <Text dimColor>Total {formatNumber(total)}</Text>
            </Box>
          )
          return titled(
            c.title,
            <Box flexDirection={sideBySide ? 'row' : 'column'} columnGap={2}>
              <Box flexDirection="column">
                {pieRows(values, diameter, c.donut ?? false).map(runs => (
                  <Box flexDirection="row">
                    {runs.map(r => (
                      <Text color={r.color} backgroundColor={r.backgroundColor}>
                        {r.text}
                      </Text>
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
          <Text bold>{board.title}</Text>
          {board.subtitle && <Text dimColor>{board.subtitle}</Text>}
          <Text dimColor>Updated {board.updatedAt}</Text>
        </Box>
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
