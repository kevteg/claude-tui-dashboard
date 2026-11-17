# TUI Dashboard 🥧

Tired of staring at walls of numbers? Bored of tables that are longer than your
daily standup? Look no further! TUI Dashboard turns whatever Claude finds
into bar charts, sparklines and, yes, real round pie charts, right in your
terminal, next to the chat.

No browser tabs. No spreadsheets. No headaches.

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

Approval also covers the code the command runs: when you press Start, the pane notes the size and
modification time of the program and of any script file in the command (`.py`, `.js`, `.sh` and
the like). If one of them changes, auto-refresh stops before the next run and asks you to press
Start again. Data files the script reads are not watched, since they change between runs by
design. Files the script imports are not watched either, so still keep refresh scripts somewhere
only you write to.

The plugin includes a `live-dashboards` skill that teaches Claude how to write a good refresh
script: what to print, how often to run, and how to cache the expensive parts.

## Saving dashboards

Press **Save** next to the dashboard's title to keep it, with its refresh command and Claude's
notes on how the data was gathered. Bring it back in any later session:

- `/tui-dashboard <name>` puts it back in the pane right away, no Claude needed
- `/tui-dashboard list` (or the **Saved…** button in the pane) shows your saved dashboards as a
  list: ↑/↓ to move, Enter to open one, Esc to go back to the prompt
- `/tui-dashboard delete <name>` removes one
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

Without Claude doing anything, type `/tui-dashboard list`. The pane lists what you saved:

```
Saved dashboards
↑/↓ to move · Enter opens it · Esc goes back to the prompt

❯ App log errors per hour  ·  saved Nov 12, 7:15 PM  ·  live
  Signups this week  ·  saved Nov 10, 9:02 AM
```

Press Enter on one, or type its name directly: `/tui-dashboard app-log-errors-per-hour`. The pane
shows the dashboard as you saved it. Press **Start auto-refresh** again and it is live.

Or ask Claude, when you want something changed too:

```
> Open my app log errors dashboard and add a pie of errors by module
```

Claude finds it with `list_saved_dashboards`, opens it with `open_saved_dashboard`, reads the
recipe (where the data comes from and where the script lives), changes the script and redraws.
Press **Save** again to keep the new version under the same name.

## What the plugin does on your machine

TUI Dashboard is a mod: its code (`hooks/register.tsx`) runs inside Claude Code. This is
everything it does outside drawing the pane.

- **Its own tools.** It adds three tools, `render_dashboard`, `list_saved_dashboards` and
  `open_saved_dashboard`, and answers calls to them itself; there is no server behind them. It
  answers no other tool's calls.
- **One command.** It adds `/tui-dashboard`, and handles only that command.
- **One file it writes.** It reads and writes `~/.claude-dashboards/saved.json`, and only when you
  press **Save**, open or delete a saved dashboard, or Claude lists or opens one. It reads `HOME`
  from the environment to find that folder. On first use it also copies dashboards that an earlier
  version kept in the plugin's private store into that file. It writes no other file, and nothing
  that other tools run or obey.
- **One program it runs: your refresh command.** When a dashboard has a refresh command, the pane
  runs that exact command on a timer, at most once a minute, with a 5-minute timeout, and only after
  you press **Start auto-refresh**. Claude writes the command when it builds the dashboard, and the
  pane shows it to you in full before you start it. It runs on your machine as you, in the
  session's working directory, with your environment, so it can use whatever credentials and files
  you can. The plugin reads only what the command prints on stdout (the next dashboard) and the
  last line of stderr (shown if it fails). It stops when you press **Stop**, when the command
  changes, or when its program or script file changes.
- **Nothing sent anywhere.** The plugin makes no network requests and sends no data out, including
  your conversation, which it never reads beyond the tool calls above. A refresh command you
  approve can do anything a program you run can do, so read it before you press Start.

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
