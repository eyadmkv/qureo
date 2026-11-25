# Terminal experience

The terminal interface adds local status views and quality-of-life features without introducing additional runtime dependencies.

## Dashboard

```powershell
qureo dashboard
qureo config set dashboard.compact true
qureo dashboard
qureo config set dashboard.compact false
```

The standard dashboard shows separate cache counts and a full-width progress bar for each cached course. Compact mode reduces the cache counts to one line and shows each course on a single line with a shorter progress bar. Set `progressBars` to `false` to show counts without bars.

## Diagnostics and status

```powershell
qureo status
qureo doctor
```

- `status` reports local session-file presence, cache counts, runtime version and platform.
- `doctor` checks the supported Node.js version, Windows DPAPI platform, PowerShell 7, SQLite database, encrypted session, configuration file and QUREO portal authentication when a session exists.

## Configuration

The first CLI invocation creates `qureo.config.json` in the project root. This file is ignored by Git.

Default configuration:

```json
{
  "theme": "auto",
  "progressBars": true,
  "commandSuggestions": true,
  "historyLimit": 100,
  "dashboard": {
    "compact": false
  }
}
```

Supported keys and values:

| Key | Values | Default |
| --- | --- | --- |
| `theme` | `auto`, `cyan`, `green`, `amber`, `monochrome`, `none` | `auto` |
| `progressBars` | `true`, `false` | `true` |
| `commandSuggestions` | `true`, `false` | `true` |
| `historyLimit` | Integer from 10 to 1000 | `100` |
| `dashboard.compact` | `true`, `false` | `false` |

Examples:

```powershell
qureo config show
qureo config set theme cyan
qureo config set progressBars false
qureo config set commandSuggestions false
qureo config set historyLimit 200
qureo config set dashboard.compact true
```

Color output is disabled when stdout is not an interactive terminal, when `NO_COLOR` is set, or when the theme is `none`.

## Command history

`qureo history` displays the most recent 30 entries. The local history file is `data/command-history.json`. Each entry contains only a command label and timestamp. Arguments, passwords, answer text and search terms are not recorded.

## PowerShell completion

Print the completion script:

```powershell
qureo completion powershell
```

Install it into the current user's PowerShell profile:

```powershell
qureo completion powershell --install
. $PROFILE
```

The completion script suggests top-level commands. It does not currently complete command-specific options or argument values.
