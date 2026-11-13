# Terminal Dashboard 🥧

Tired of staring at walls of numbers? Bored of tables that are longer than your
daily standup? Look no further! Terminal Dashboard turns whatever Claude finds
into bar charts, sparklines and, yes, real round pie charts, right in your
terminal, next to the chat. No browser tabs. No spreadsheets. No headaches.

It's a Claude Code plugin that gives Claude a dashboard pane beside the chat. Ask
for a dashboard of anything Claude can look up, such as logs, query results or
files, and Claude draws it with metrics, charts, tables and callouts. Ask again
to refresh it with new numbers.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install terminal-dashboard --marketplace kevteg/claude-terminal-dashboard
```

From a shell:

```
claude plugin install terminal-dashboard --marketplace kevteg/claude-terminal-dashboard
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

The plugin includes a `live-dashboards` skill that teaches Claude how to write a good refresh
script: what to print, how often to run, and how to cache the expensive parts.

## Limits

- The pane shows one dashboard at a time; drawing a new one replaces it.
- Charts are drawn with Unicode block characters, so they are as sharp as your terminal font.
- Without a refresh command, the dashboard only changes when Claude redraws it.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
