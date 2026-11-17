# TUI Dashboard 🥧

Tired of staring at walls of numbers? Bored of tables that are longer than your
daily standup? Look no further! TUI Dashboard turns whatever Claude finds
into bar charts, sparklines and, yes, real round pie charts, right in your
terminal, next to the chat. No browser tabs. No spreadsheets. No headaches.

<img width="1248" height="708" alt="dashboard-example" src="https://github.com/user-attachments/assets/e17f74f1-59de-4ad9-85c1-8ebf57f49e56" />


It's a Claude Code plugin that gives Claude a dashboard pane beside the chat. Ask
for a dashboard of anything Claude can look up, such as logs, query results or
files, and Claude draws it with metrics, charts, tables and callouts. Ask again
to refresh it with new numbers.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install tui-dashboard --marketplace kevteg/claude-tui-dashboard
```

From a shell:

```
claude plugin install tui-dashboard --marketplace kevteg/claude-tui-dashboard
```

The repository is private for now. Installing needs read access to it on GitHub, and a git
credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Use

- Ask Claude for a dashboard, e.g. "make me a dashboard of the errors in this log file by hour".
  Claude calls its `render_dashboard` tool and the pane opens beside the chat.
- The pane opens by itself when the terminal is wide enough. Type `/tui-dashboard` to open it at
  any width.
- To keep it updated, ask Claude to refresh it, or loop it: `/loop 30m refresh the dashboard`.

## What Claude can draw

| Component    | For                                                        |
| ------------ | ---------------------------------------------------------- |
| `metrics`    | A row of headline numbers                                  |
| `bar_chart`  | Horizontal bars, several series side by side or stacked    |
| `pie_chart`  | Shares of a whole, with a legend of values and percentages |
| `sparklines` | Trends over time, one line per series                      |
| `table`      | Rows of values, sized to fit the pane                      |
| `callout`    | Something that needs attention: info, success, warning, error |
| `heading`, `text` | Titles and notes                                      |

Claude chooses the layout: the pane width it asks for, and a width per component (`full`,
`two_thirds`, `half`, `third`) so smaller charts sit side by side. A width you drag the pane to
yourself wins.

## Live dashboards

Claude can give a dashboard a refresh command: a script that prints the next dashboard as JSON
(`{ "title"?, "subtitle"?, "components": [...] }`). The pane then re-runs it on a timer, at most
once a minute, and redraws without asking Claude again.

The pane never runs a command on its own: it shows you the exact command and waits until you
press **Start auto-refresh**. A different command needs a new Start, and **Stop** turns it off.
The command runs on your machine as you, with your credentials.

Approval is tied to the command, not to what the script contains: if the script file changes
while auto-refresh is on, the next run uses the new version without asking. Keep refresh scripts
somewhere only you write to.

The plugin includes a `live-dashboards` skill that teaches Claude how to write a good refresh
script: what to print, how often to run, and how to cache the expensive parts.

## Saving dashboards

Press **Save** next to the dashboard's title to keep it, with its refresh command and Claude's
notes on how the data was gathered. Bring it back in any later session:

- `/tui-dashboard <name>` puts it back in the pane right away, no Claude needed
- `/tui-dashboard list` shows what you saved, and `/tui-dashboard delete <name>` removes one
- Or ask Claude: it can list and open saved dashboards, and uses those notes to update them

A saved refresh command still waits for you to press Start in each new session.

Saved dashboards are kept in one plain file, `~/.claude-dashboards/saved.json`, shared by every
session and every copy of the plugin. To move them to another machine or share one with a
teammate, copy that file (or one entry in it). Saved refresh commands point at scripts on your
machine, so share those along with it.

### Example: build it once, bring it back tomorrow

**Today**, in a Claude Code session:

```
> Make me a live dashboard of the error lines in /var/log/myapp/app.log, per hour,
  and keep it updated every 5 minutes
```

Claude writes a small refresh script, runs it once, and draws the dashboard. In the pane:

1. Press **Start auto-refresh**: the pane shows the exact command first. From now on it redraws
   every 5 minutes by itself.
2. Press **Save** next to the title. A toast confirms the name, here `app-log-errors-per-hour`.

**Tomorrow**, in a brand-new session (`claude` in a new terminal, or `/clear`), there are two ways
back.

Without Claude doing anything:

```
> /tui-dashboard list
app-log-errors-per-hour: "App log errors per hour", saved Nov 12, 7:15 PM, 4 components
  refresh every 300 s: /Users/me/.local/bin/uv run --script /Users/me/claude-dashboards/app_errors.py
  recipe: Counts ERROR lines in /var/log/myapp/app.log per hour; ...

> /tui-dashboard app-log-errors-per-hour
Opened "App log errors per hour", saved Nov 12, 7:15 PM.
```

The pane shows the dashboard as you saved it. Press **Start auto-refresh** again and it is live.

Or ask Claude, when you want something changed too:

```
> Open my app log errors dashboard and add a pie of errors by module
```

Claude finds it with `list_saved_dashboards`, opens it with `open_saved_dashboard`, reads the
recipe (where the data comes from and where the script lives), changes the script and redraws.
Press **Save** again to keep the new version under the same name.

## Limits

- The pane shows one dashboard at a time; drawing a new one replaces it (Save it first to keep it).
- Charts are drawn with Unicode block characters, so they are as sharp as your terminal font.
- Without a refresh command, the numbers stay as drawn: they change only when Claude redraws the
  dashboard. Opening a saved one shows it as it was when saved.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
