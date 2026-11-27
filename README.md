# QUREO Personal CLI

[![CI](https://github.com/eyadmkv/qureo/actions/workflows/ci.yml/badge.svg)](https://github.com/eyadmkv/qureo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An unofficial, Windows-focused command-line toolkit for your own QUREO account and the SPRIX financial-literacy course. It includes QUREO sync and a progress-aware solver, plus a standalone SPRIX CLI for live curriculum and lesson workflows, encrypted browser-session import, and local study data.

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

For English Financial Literacy (subject 3), run `sprix bank import-english` to install the chapter and test answer maps. For Arabic Financial Literacy (subject 7), run `sprix bank import-arabic` to fetch the subject-specific API ID map (`spx_api_bank.json`) and question-text archive (`answers_archive.json`) into the ignored local data directory. The exact test-question and chapter-block mappings are checked against the live option IDs; the text archive is used as a fallback with confidence and ambiguity checks. Course-wide `sprix solve` handles tests in curriculum order, submits a test only after every question has a complete answer plan, and continues only after SPRIX confirms a passing result and updates the curriculum. Missing or ambiguous questions stop the test before any test answers are submitted. Completed tests are skipped. `sprix solve --dry-run` never starts a test and stops its preview at the first pending test boundary. Both upstream answer sources are third-party and unverified; their data files stay local and are not committed. The solver fails closed if a mapped option is missing or SPRIX marks it incorrect. `--answers-only` leaves tests unsubmitted.

See the [SPRIX local study guide](docs/sprix.md) and the [SPRIX API CLI guide](docs/sprix-api.md). Captured lessons, sessions, exports, and personal notes stay under `data/sprix/`, which is excluded from Git.

## Solver safety

The solver processes chapters and lessons sequentially. It checks that required local answers exist before starting a chapter, waits for lesson completion to succeed before initializing the assessment, and requires QUREO to confirm chapter completion. It stops when a required operation fails.

The solver makes state-changing requests to QUREO when you explicitly run it. Review the selected range and answer bank before use. A local checkpoint is a record of the last observed state, not proof that QUREO accepted a request that timed out.

## Local data and privacy

The `data/` directory contains the SQLite database, encrypted session, command history and checkpoints. It is ignored by Git. Do not upload or commit it.

SPRIX session cookies, lesson captures, extracted questions and personal reference keys are stored under `data/sprix/`. Session cookies are encrypted with Windows DPAPI. Local captures and notes stay on your computer; API requests are sent directly to SPRIX only when you run the corresponding command. Review any exported content before sharing it.

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

## License

MIT. See [LICENSE](LICENSE).
