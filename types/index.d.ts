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
  refresh?: Refresh
  // How the data was gathered, so a later session can rebuild or update the dashboard.
  recipe?: string
  updatedAt: string
}

// What the Save button stores, under `saved:<name>` in the plugin's store.
export type SavedDashboard = { name: string; savedAt: string; dashboard: Dashboard }

// A command that prints a fresh { title?, subtitle?, components } as JSON on stdout.
export type Refresh = { command: string[]; everySeconds: number }

// Auto-refresh runs only the command the person approved by pressing Start.
export type RefreshState = {
  approved: string | null
  lastRunAt: number
  lastError: string | null
  isRunning: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-dashboard': {
      dashboard: Shaped<Dashboard | null>
      refresh: Shaped<RefreshState>
      lastSaved: Shaped<{ name: string; at: string } | null>
    }
  }
}
