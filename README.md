# QStudy CLI

[![CI](https://github.com/eyadmkv/qureo/actions/workflows/ci.yml/badge.svg)](https://github.com/eyadmkv/qureo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An unofficial, Windows-focused command-line toolkit that unifies QUREO and SPRIX under one account dashboard and keeps the original `qureo` and `sprix` commands available. It includes QUREO sync and a progress-aware solver, plus a standalone SPRIX CLI for live curriculum and lesson workflows, encrypted browser-session import, and local study data.

This project is independent and is not affiliated with, endorsed by, or supported by QUREO or its operators. It uses undocumented service endpoints that may change without notice.

## Features

- Sign in to QUREO and SPRIX through one shared credential prompt while preserving separate encrypted service sessions.
- Use `qstudy` for a unified dashboard, account checks and cross-platform sync, or keep using `qureo` and `sprix` directly.
- Sync account, course, chapter and progress metadata.
- Cache retrieved question data in a local SQLite database.
- Export course metadata, lessons and available assessment questions to JSON.
- Search locally stored questions, public guides and your own answer notes.
- Run the chapter solver with sequential safeguards, checkpoints and configurable pauses.
- View local progress with `dashboard`, `status` and `doctor`.
- Configure terminal themes, compact dashboard output and PowerShell completion.
- Use a standalone `sprix` CLI to import an authenticated browser session, fetch live curriculum and chapter/review/test data, and submit explicitly selected answers or completions.
- Export all live SPRIX chapter and review question content without a userscript, then build a separate source-backed study bank.
- Capture visible SPRIX lesson text, extract four-choice questions, save personal reference keys and practice offline.

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
qstudy login
qstudy sync
qstudy dashboard
qstudy solve
qstudy qureo me
qstudy sprix progress

# The original commands remain available
qureo login
sprix login
```

`qstudy login` prompts once for the shared student ID/Login ID and hidden password, then authenticates with QUREO and SPRIX independently. The password is not saved. Each service's session cookies are encrypted separately with Windows DPAPI for the current Windows account.

## Common commands

| Command | Purpose |
| --- | --- |
| `qstudy login` / `logout` | Sign in to or clear both QUREO and SPRIX sessions with one command |
| `qstudy dashboard` | Show combined QUREO and SPRIX progress and local data |
| `qstudy sync` / `status` | Refresh both platforms or validate both saved sessions |
| `qstudy solve` | Choose JavaScript, Python and/or SPRIX from an interactive checklist |
| `qstudy solve --dry-run` | Preview selected solvers without submitting answers |
| `qstudy qureo <command>` / `qstudy sprix <command>` | Run existing service commands through the unified entry point |
| `qureo login` / `logout` | Create or remove the QUREO session; remains available directly |
| `qureo me` | Show account identity, completed chapters and reward totals |
| `qureo check` | Check portal and learning API connectivity |
| `qureo courses` / `sync` | List or refresh course metadata and progress |
| `qureo progress` | Display cached course progress |
| `qureo chapter <id>` / `lessons <id>` | Inspect chapter and lesson metadata |
| `qureo questions <id>` | Fetch and cache available question data |
| `qureo export` | Export course, chapter, lesson and assessment data |
| `qureo search <query>` | Search local questions and answer sources |
| `qureo answer save ...` | Save a personal answer or solution note |
| `qureo answers sync-community` | Download the public community answer archive into ignored local data for fallback matching |
| `qureo solve [range]` | Choose a course interactively, then run the chapter solver |
| `qureo python solve [range]` / `qureo solve python [range]` | Solve the Python course directly, refreshing the community fallback archive automatically and using the cached copy offline |
| `qureo dashboard` | Show local cache and progress summary |
| `qureo status` / `doctor` | Inspect local setup and connectivity |
| `sprix sync` / `progress` | Sync the live curriculum and summarize saved progress |
| `sprix curriculum` / `qureo sprix curriculum` | Fetch live SPRIX curriculum and progress |
| `qureo sprix capture` | Capture a visible SPRIX lesson from clipboard or text file |
| `qureo sprix questions` / `practice` | Review captured questions and practice against your own saved keys |
| `sprix chapter`, `answer`, `complete`, `review`, `test` | Read and explicitly submit SPRIX actions |
| `sprix bank harvest` / `sprix bank build` | Export course questions, then build a local answer bank from a separate answer map |
| `sprix solve` | Solve remaining chapters, reviews and tests in curriculum order, skipping completed items |
| `sprix bank import` / `sprix bank import-english` / `sprix bank import-arabic` / `sprix bank status` | Import and inspect local Arabic and English answer maps and text archives |
| `sprix login` / `logout` | Sign in with Login ID and password, or remove the encrypted session |
| `qureo sprix search` / `export` | Search and export your local SPRIX study data |
| `qureo config show` | View terminal configuration |
| `qureo history` | View recent command names and timestamps |

Run `qureo --help` for the complete command list. See the [usage guide](docs/usage.md), [solver guide](docs/solver.md) and [terminal experience guide](docs/terminal-experience.md) for detailed command examples and behavior.

## SPRIX financial-literacy CLI

The standalone `sprix` command works with the Egyptian second-year Baccalaureate financial-literacy course in SPRIX Learning Square. The same API commands are also available under `qureo sprix`. It includes live curriculum and chapter reads, review and test workflows, explicit answer submission, encrypted local session storage, and the existing offline lesson-capture and practice tools.

Sign in with `sprix login`. The CLI prompts for your Login ID and masks your password, sends the credentials directly to SPRIX, validates the session with a read-only curriculum request, then stores the resulting cookies encrypted with Windows DPAPI. The password is never stored. Cookie import remains available as a fallback.

Account-changing actions require an explicit `--yes` confirmation. The CLI does not brute-force choices, submit dummy test answers to reveal keys, or retry a POST/PUT after a network error. SPRIX's API is separate from QUREO's client and session.

For English Financial Literacy (subject 3), run `sprix bank import-english` to install the chapter and test ID maps plus the `answers_archive_subject3.json` text-answer archive. For Arabic Financial Literacy (subject 7), run `sprix bank import-arabic` to fetch the subject-specific API ID map (`spx_api_bank.json`) and question-text archive (`answers_archive.json`) into the ignored local data directory. Exact test-question and chapter-block mappings are checked against live option IDs; the matching text archive is used when an ID mapping is missing, with confidence and ambiguity checks. Course-wide `sprix solve` handles tests in curriculum order, submits a test only after every question has a complete answer plan, and continues only after SPRIX confirms a passing result and updates the curriculum. Missing or ambiguous questions stop the test before any test answers are submitted. Completed tests are skipped. `sprix solve --dry-run` never starts a test and stops its preview at the first pending test boundary. Both upstream answer sources are third-party and unverified; their data files stay local and are not committed. The solver fails closed if a mapped option is missing or SPRIX marks it incorrect. `--answers-only` leaves tests unsubmitted.

See the [SPRIX local study guide](docs/sprix.md) and the [SPRIX API CLI guide](docs/sprix-api.md). Captured lessons, sessions, exports, and personal notes stay under `data/sprix/`, which is excluded from Git.

## Solver safety

The solver processes chapters and lessons sequentially. It checks the live question type and option IDs before submitting. When a stored answer no longer matches the live question type, it can use a type-safe temporary answer to complete an attempt, retrieve the official model answer from QUREO's result, save it, and retry. Temporary answers are reported in the run log; results that do not expose usable official answers stop the run. The solver initializes each lesson before requesting completion and checks QUREO's chapter progress, including the best-correct count, before moving on.

The solver makes state-changing requests to QUREO when you explicitly run it. Review the selected range and answer bank before use. A local checkpoint is a record of the last observed state, not proof that QUREO accepted a request that timed out.

## Local data and privacy

Runtime data is stored in `%LOCALAPPDATA%\QStudy` on Windows, including the SQLite database, encrypted sessions, command history, checkpoints and local answer banks. Existing `data/` and `answers/` folders in a source checkout are copied into the new location on first launch. Set `QSTUDY_DATA_DIR` to use a different data directory.

SPRIX session cookies, lesson captures, extracted questions and personal reference keys are stored under `%LOCALAPPDATA%\QStudy\sprix` on Windows. Session cookies are encrypted with Windows DPAPI. Local captures and notes stay on your computer; API requests are sent directly to SPRIX only when you run the corresponding command. Review any exported content before sharing it.

- Session cookies are encrypted with Windows DPAPI and tied to the Windows user account.
- Passwords are not stored in the database, configuration or command history.
- Command history records command names and timestamps only. It omits arguments and search terms.
- Course exports may contain account-related learning data. Review them before sharing.

This project does not send your database or exports to a third-party server. Requests are made directly to the QUREO and SPRIX hosts and, when syncing public answer guides or the optional community archive, to their documented public source URLs. The community archive is pinned to a source commit, stored only under ignored `data/`, and is not redistributed by this repository.

## Third-party content and redistribution

The repository currently includes generated files under `exports/` containing course metadata and assessment material returned by QUREO's authenticated API, along with a course answer bank under `answers/`. These files are not original project code. The MIT license in this repository does not grant rights to redistribute QUREO-owned material, trademarks or other third-party content. Before making the repository public, review those files and remove any material you do not have permission to publish. Generated exports should generally remain local to your own checkout.

## Limitations

- QUREO endpoints are undocumented and can change.
- Some courses listed by QUREO may return HTTP 404 from the learning API.
- Interactive lesson screens are not fully represented by the metadata export.
- The solver uses your course-specific bank first, then optional community archive answers matched by exact question ID; choice IDs are validated against the live options.
- This project does not bypass paywalls or access controls.

## Contributing

Bug reports, reproducible issue reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) first.

## Package

The npm package is prepared as `@eyadmkv/qstudy-cli` and exposes three executables: `qstudy`, `qureo` and `sprix`. Build and inspect the package with `npm pack --dry-run`. Once published, it can be installed globally with `npm install -g @eyadmkv/qstudy-cli`. Publication is a separate release step.

## License

MIT. See [LICENSE](LICENSE).
