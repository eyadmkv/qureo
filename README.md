# QUREO Personal CLI

[![CI](https://github.com/eyadmkv/qureo/actions/workflows/ci.yml/badge.svg)](https://github.com/eyadmkv/qureo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An unofficial, Windows-focused command-line tool for working with your own QUREO account and studying the SPRIX financial-literacy course. It provides QUREO course and progress sync, local SQLite caching, JSON exports, question and answer search, an optional progress-aware QUREO chapter solver, and a separate local SPRIX lesson-capture and practice workflow.

This project is independent and is not affiliated with, endorsed by, or supported by QUREO or its operators. It uses undocumented service endpoints that may change without notice.

## Features

- Authenticate with QUREO and store the session encrypted using Windows DPAPI.
- Sync account, course, chapter and progress metadata.
- Cache retrieved question data in a local SQLite database.
- Export course metadata, lessons and available assessment questions to JSON.
- Search locally stored questions, public guides and your own answer notes.
- Run the chapter solver with sequential safeguards, checkpoints and configurable pauses.
- View local progress with `dashboard`, `status` and `doctor`.
- Configure terminal themes, compact dashboard output and PowerShell completion.
- Capture visible SPRIX financial-literacy lesson text from the clipboard or a UTF-8 file, extract four-choice questions, save personal reference keys and practice offline.

## Requirements

- Windows 10 or 11
- PowerShell 7
- Node.js 22.12 or newer
- Internet access to reach QUREO

The CLI depends on Windows DPAPI for session encryption. Linux and macOS are not supported for authenticated use.

## Install from source

Clone the repository, then run:

```powershell
git clone https://github.com/eyadmkv/qureo.git
cd qureo
pwsh -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

The setup script installs dependencies, runs the test suite and registers the `qureo` command with `npm link`.

To update an existing checkout:

```powershell
git pull --ff-only
npm install
npm run check
npm link
```

## Quick start

```powershell
qureo login
qureo sync
qureo me
qureo dashboard
qureo export
```

The login command prompts for your student ID and a hidden password. The password is sent to the QUREO login endpoint and is not saved by this CLI. The resulting session cookies are encrypted for the current Windows account.

## Common commands

| Command | Purpose |
| --- | --- |
| `qureo login` / `logout` | Create or remove the local authenticated session |
| `qureo me` | Show account identity, completed chapters and reward totals |
| `qureo check` | Check portal and learning API connectivity |
| `qureo courses` / `sync` | List or refresh course metadata and progress |
| `qureo progress` | Display cached course progress |
| `qureo chapter <id>` / `lessons <id>` | Inspect chapter and lesson metadata |
| `qureo questions <id>` | Fetch and cache available question data |
| `qureo export` | Export course, chapter, lesson and assessment data |
| `qureo search <query>` | Search local questions and answer sources |
| `qureo answer save ...` | Save a personal answer or solution note |
| `qureo solve [range]` | Run the sequential chapter solver |
| `qureo dashboard` | Show local cache and progress summary |
| `qureo status` / `doctor` | Inspect local setup and connectivity |
| `qureo sprix curriculum` | List the six financial-literacy units |
| `qureo sprix capture` | Capture a visible SPRIX lesson from clipboard or text file |
| `qureo sprix questions` / `practice` | Review captured questions and practice against your own saved keys |
| `qureo sprix search` / `export` | Search and export your local SPRIX study data |
| `qureo config show` | View terminal configuration |
| `qureo history` | View recent command names and timestamps |

Run `qureo --help` for the complete command list. See the [usage guide](docs/usage.md), [solver guide](docs/solver.md) and [terminal experience guide](docs/terminal-experience.md) for detailed command examples and behavior.

## SPRIX financial-literacy study companion

The `qureo sprix` command group supports the Egyptian second-year Baccalaureate financial-literacy course shown in the SPRIX Learning Square portal. Its curriculum index contains six units and 134 learning elements.

SPRIX lesson pages are interactive and use a different platform from QUREO. This companion captures text that is already visible to you in the signed-in browser. It does not collect SPRIX credentials, read browser cookies, call guessed private endpoints, submit answers, or change course progress.

See the [SPRIX guide](docs/sprix.md) for capture, question review, local answer keys and practice commands. Captured content and personal notes stay under `data/sprix/`, which is excluded from Git.

For browser-based lesson capture, install the standalone [Tampermonkey lesson exporter](userscripts/sprix-lesson-export.user.js). It downloads the visible lesson text as a UTF-8 file that can be passed to `qureo sprix capture --file`. The script and installation notes are in [`userscripts/`](userscripts/).

## Solver safety

The solver processes chapters and lessons sequentially. It checks that required local answers exist before starting a chapter, waits for lesson completion to succeed before initializing the assessment, and requires QUREO to confirm chapter completion. It stops when a required operation fails.

The solver makes state-changing requests to QUREO when you explicitly run it. Review the selected range and answer bank before use. A local checkpoint is a record of the last observed state, not proof that QUREO accepted a request that timed out.

## Local data and privacy

The `data/` directory contains the SQLite database, encrypted session, command history and checkpoints. It is ignored by Git. Do not upload or commit it.

SPRIX lesson captures, extracted questions and personal reference keys are stored under `data/sprix/`. They are local-only and are not sent to SPRIX. Review any exported content before sharing it.

- Session cookies are encrypted with Windows DPAPI and tied to the Windows user account.
- Passwords are not stored in the database, configuration or command history.
- Command history records command names and timestamps only. It omits arguments and search terms.
- Course exports may contain account-related learning data. Review them before sharing.

This project does not send your database or exports to a third-party server. Requests are made directly to the QUREO hosts and, when syncing public answer guides, to the documented public guide source.

## Third-party content and redistribution

The repository currently includes generated files under `exports/` containing course metadata and assessment material returned by QUREO's authenticated API, along with a course answer bank under `answers/`. These files are not original project code. The MIT license in this repository does not grant rights to redistribute QUREO-owned material, trademarks or other third-party content. Before making the repository public, review those files and remove any material you do not have permission to publish. Generated exports should generally remain local to your own checkout.

## Limitations

- QUREO endpoints are undocumented and can change.
- Some courses listed by QUREO may return HTTP 404 from the learning API.
- Interactive lesson screens are not fully represented by the metadata export.
- The solver can only use answers available in your local answer bank.
- This project does not bypass paywalls or access controls.

## Contributing

Bug reports, reproducible issue reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) first.

## License

MIT. See [LICENSE](LICENSE).
