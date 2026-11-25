# Terminal experience

The CLI entrypoint now provides a richer local terminal experience without adding runtime dependencies.

## Commands

```powershell
qureo dashboard
qureo status
qureo doctor
qureo history
qureo config show
qureo config set theme cyan
qureo config set progressBars true
qureo completion powershell
qureo completion powershell --install
```

- `dashboard` summarizes locally cached courses, chapters, questions, and saved answers. Cached progress is shown with terminal progress bars.
- `status` reports local session-file presence, cache counts, runtime version, and platform. It does not print credentials or cookies.
- `doctor` checks the Node.js version, Windows DPAPI platform, local database, configuration, and QUREO portal authentication when a session file exists.
- `history` displays the most recent command names and timestamps. It deliberately does not store command arguments, answer text, search terms, or credentials.
- `config` reads and updates the root-level `qureo.config.json`.
- `completion powershell` prints a PowerShell argument completer. Add `--install` to append it to the current user's PowerShell profile.

## Configuration

The first invocation creates `qureo.config.json` in the project root:

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

Supported themes: `auto`, `cyan`, `green`, `amber`, `monochrome`, and `none`.

Examples:

```powershell
qureo config set theme green
qureo config set commandSuggestions false
qureo config set historyLimit 200
```

Color output is automatically disabled when stdout is not an interactive terminal or when `NO_COLOR` is set.

## Local files

- `qureo.config.json`: user preferences. Keep this local.
- `data/command-history.json`: recent command names and timestamps only.
- `completions/qureo.ps1`: source for PowerShell command completion.

The dashboard reads cached data only. Run `qureo sync` to refresh course metadata.
