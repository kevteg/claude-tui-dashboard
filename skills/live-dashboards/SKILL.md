---
name: live-dashboards
description: How to write the refresh script that keeps a terminal-dashboard pane live without model turns. Use when giving render_dashboard a refresh command, or when the person asks for a dashboard that updates by itself, every N minutes, "live", or "keep it updated".
---

# Live dashboards

`render_dashboard` takes an optional `refresh`: a command the pane re-runs on a timer, drawing
whatever it prints. You write that command once; after that the dashboard updates with no model
turns. The pane runs it only after the person presses **Start auto-refresh**, which shows them the
exact command, so make the command short and obviously what it claims to be.

## The contract

- **Command:** an argument list, run **without a shell**: no pipes, `&&`, `~` or `$VAR`. Use
  absolute paths for the interpreter and the script; `PATH` may not hold `uv` or `python`.
- **Output:** exactly one JSON object on stdout, and nothing else:
  `{ "title"?, "subtitle"?, "components": [...] }`. Components are the same as
  `render_dashboard`'s. Leaving out `title` or `subtitle` keeps the current ones.
- **Logging:** anything for humans goes to stderr. A non-zero exit keeps the last good dashboard
  and shows the last stderr line in the pane, so make that line useful.
- **Timing:** runs at most once every `every_seconds`, never more often than once a minute, in
  the session's working directory, and is killed after 5 minutes.
- **Approval:** changing the command needs a new Start. Calling `render_dashboard` again with the
  same command keeps it running.

## Writing a good one

1. **Find out how often the data changes, and refresh no faster.** A source that publishes once
   a minute gains nothing from a faster timer. Daily data needs an hourly timer at most.
2. **Work out the cost of one run before choosing the interval, and tell the person.** A query
   that is cheap once becomes expensive at 1,440 runs a day. Price a day of runs.
3. **Cache the expensive parts.** Split the data into fast and slow: re-read cheap numbers every
   run, re-run costly queries only every N minutes and cache the result in a file (for example under
   `~/.cache/claude-dashboards/`). Show in the dashboard when each part was last checked.
4. **Keep drawing when a source fails.** On a transient error, fall back to the cached value and
   say so on stderr; exit non-zero only when there is nothing to draw.
5. **Compute the conclusions in the script.** Callouts that a person reads ("backlog: 23 h of
   work", "3 queues filling up") must come from the data of that run, not from the text you wrote
   when you set it up.
6. **Keep it self-contained.** One file, with its dependencies declared inline (a `uv` script
   header for Python), so it runs with nothing installed by hand.
7. **Put it somewhere private.** Scripts often hold internal names, hosts or account ids. Keep
   them outside shared repositories (for example `~/claude-dashboards/`) unless the person says
   otherwise.
8. **Run it yourself first.** Run the exact command once, check the JSON parses and that the
   dashboard reads well, and only then pass it as `refresh` along with that first output as
   `components`.

## Saving it for later

The pane has a **Save** button; `/terminal-dashboard <name>` and `open_saved_dashboard` bring a saved
dashboard back in a later session, refresh command included (it needs a new Start). Always pass a
`recipe` to `render_dashboard`: the data sources, the queries, the filters and where the refresh
script lives, written for a session that never saw this conversation. That recipe is what lets
the next session update or change the dashboard instead of starting over.

## Example

A dashboard of a log file's error lines, refreshed every 5 minutes:

```python
# /// script
# requires-python = ">=3.11"
# ///
"""Prints a dashboard of ERROR lines per hour in app.log, for terminal-dashboard."""
import json
import sys
from collections import Counter
from pathlib import Path

LOG = Path("/var/log/myapp/app.log")

try:
    lines = LOG.read_text().splitlines()
except OSError as error:
    print(f"cannot read {LOG}: {error}", file=sys.stderr)
    sys.exit(1)

errors = [line for line in lines if " ERROR " in line]
by_hour = Counter(line[11:13] + ":00" for line in errors)  # "2026-01-02 14:..." -> "14:00"
hours = sorted(by_hour)[-12:]

print(json.dumps({
    "subtitle": f"{LOG} · last {len(hours)} hours",
    "components": [
        {"type": "metrics", "items": [{"label": "Errors", "value": f"{len(errors):,}"}]},
        {"type": "bar_chart", "title": "Errors per hour", "labels": hours,
         "series": [{"name": "Errors", "values": [by_hour[h] for h in hours]}]},
        {"type": "table", "title": "Latest errors", "columns": ["Line"],
         "rows": [[line[:120]] for line in errors[-5:]]},
    ],
}))
```

Passed as:

```json
"refresh": {
  "command": ["/Users/me/.local/bin/uv", "run", "--script", "/Users/me/claude-dashboards/app_errors.py"],
  "every_seconds": 300
}
```
