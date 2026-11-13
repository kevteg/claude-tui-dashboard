export type Tone = 'info' | 'success' | 'warning' | 'error'

export type Series = { name: string; values: number[] }

export type Width = 'full' | 'two_thirds' | 'half' | 'third'

export type Component = (
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; dim?: boolean }
  | { type: 'metrics'; items: { label: string; value: string; hint?: string }[] }
  | { type: 'bar_chart'; title?: string; labels: string[]; series: Series[]; stacked?: boolean; unit?: string }
  | { type: 'sparklines'; title?: string; labels?: string[]; series: Series[] }
  | { type: 'table'; title?: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'callout'; tone: Tone; title?: string; text: string }
  | { type: 'pie_chart'; title?: string; slices: { label: string; value: number }[]; donut?: boolean }
) & { width?: Width }

export type Dashboard = {
  title: string
  subtitle?: string
  components: Component[]
  size?: { columns?: number; rows?: number }
  updatedAt: string
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-dashboard': { dashboard: Shaped<Dashboard | null> }
  }
}
