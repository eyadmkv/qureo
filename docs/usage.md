# Usage guide

This guide covers the commands most people use after installing the CLI. Run `qureo --help` for the complete command list.

## Authenticate

```powershell
qureo login
qureo me
qureo check
qureo logout
```

The password prompt is hidden. The CLI sends credentials to the QUREO login service, verifies the authenticated session and stores the returned cookies encrypted with Windows DPAPI. The password is not saved.

## Sync and inspect progress

```powershell
qureo sync
qureo courses
qureo progress
qureo progress --course javascript_ar
qureo dashboard
```

The dashboard and progress command read the local cache. Run `qureo sync` to refresh course and chapter metadata. If QUREO lists a course that its Learning API does not expose, the CLI reports the unavailable course and continues with accessible courses.

## Inspect chapters and fetch questions

```powershell
qureo chapter 90013
qureo lessons 90013
qureo questions 90013
qureo result 90013
```

Question retrieval caches question IDs, prompt text and visible choices returned by the API. The result command reads an existing attempt result when QUREO exposes it. It does not create an attempt or call an answer-reveal endpoint.

## Export data

```powershell
qureo export
qureo export --course javascript_ar
qureo export --chapter 90017
```

Exports are written under `exports/`. They may contain course metadata, lesson identifiers and titles, assessment prompts and visible answer choices. Review the contents before sharing them. QUREO's lesson screens are client-rendered, so an API export may not contain every interactive step.

## Search and save answer notes

```powershell
qureo answers sync
qureo search "Math.floor"
qureo answer save --question-key "question-123" --question "Example prompt" --type code --answer 'console.log(1);'
qureo answers list
```

Public guide synchronization stores only material available without bypassing access controls. Personal answer notes are kept in the local database.

## Local files

- `data/qureo.db`: course metadata, cached questions and personal answer notes.
- `data/session.dpapi`: encrypted session cookies.
- `data/command-history.json`: command labels and timestamps.
- `data/solve-checkpoint.json`: last observed solver checkpoint.
- `exports/`: generated JSON exports.
- `answers/`: local answer-bank files used by the solver.
- `qureo.config.json`: local terminal preferences.

Do not commit session files, databases, command history, checkpoints or personal exports. The repository's `.gitignore` excludes the local data directory and configuration.
