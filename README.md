# QUREO Personal CLI 0.3.0

A private, local-only, HTTP-based QUREO client for Windows and PowerShell 7. It uses direct HTTPS requests (`POST` for login and `GET` for account/course/question data), SQLite for a personal archive, and Windows DPAPI to encrypt the local session cookie jar.

The CLI does not store the password or send credentials to a third-party service. When QUREO returns HTTP 404 for a lesson-completion request, the solver opens that lesson in your default browser so the QUREO lesson app can initialize, then retries the completion request. Keep the browser signed in to the same QUREO account. The solver submits only answers from the local answer bank and never probes for hidden answer keys.

## Requirements

- Windows 10/11
- PowerShell 7 (`pwsh`)
- Node.js 22 or newer
- Internet access during `npm install` and use

## Install / update

From this folder:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

Your existing `data\qureo.db` is retained. No Chromium or Playwright installation is required.

## Login

```powershell
qureo login
```

Enter your QUREO student ID. The password prompt is hidden. The CLI sends the login request to the QUREO portal, checks the authenticated user-info endpoint, and stores the returned cookies encrypted with Windows DPAPI for the current Windows account. The password is not written to disk, configuration, logs, or command history.

```powershell
qureo me       # show gems earned and completed chapters
qureo check
qureo logout
```

The `qureo me` command refreshes your available courses and chapter progress from QUREO. It lists completed chapters and sums the `diamond` rewards recorded for those chapters. The gem total is derived from chapter reward records returned by QUREO.

## Sync your account and course data

```powershell
qureo sync
qureo courses
qureo progress
qureo progress --course javascript_ar
```

Course and chapter metadata, question lists and existing test results are fetched with GET requests. QUREO's API may change, and the CLI reports HTTP errors rather than guessing undocumented response fields.

## Fetch lesson questions

```powershell
qureo chapter 90013
qureo lessons 90013
qureo questions 90013
qureo result 90013

# Export the complete course index and all chapter assessment question sets
qureo export

# Export just one chapter (for example the mid-term chapter 17)
qureo export --chapter 90017
```

`qureo questions` caches question IDs, types, prompt text and multiple-choice options in `data\qureo.db`. `qureo result` only reads a result already available for an existing attempt. When QUREO includes correct-choice/model-answer fields in that existing result, the CLI caches those fields as retrieved answers.


## Export everything for bulk answering

Run:

```powershell
qureo export
```

This iterates every course QUREO lists for your account, then retrieves each course's chapters, each chapter's lesson metadata (IDs, titles and URLs), and each chapter's test/review question payloads. It also updates the local SQLite cache. The export is written to `exports\qureo-export.json`.

To export one course or one chapter:

```powershell
qureo export --course javascript_ar
qureo export --chapter 90017
```

Upload `exports\qureo-export.json` in ChatGPT. The question JSON includes choice IDs, visible choices and code-description templates when QUREO returns them. A returned lesson list is metadata, not the full rendered lesson content: QUREO builds interactive lesson screens in the client, and this HTTP-only export does not claim to capture every interactive step within each lesson.

After an answer file is prepared with an `answers` array, import it with:

```powershell
qureo answers import .\answers.json
qureo answers list
```

Each answer record should include `question_id` and `answer` (or `answer_text`), and can include `answer_type`, `question_text`, `explanation` and `source_url`. Imported answers are stored as locally supplied answers, not marked as QUREO-verified.

## Solve from your current progress

The solver reads your current account progress and starts at the first unfinished chapter. The optional target can be a chapter sequence number or QUREO chapter ID:

```powershell
qureo solve
qureo solve 20
qureo solve 90044
qureo solve 44 --dry-run
```

Before making changes, the solver checks that every question in a chapter has a matching local answer. It completes lessons in order and stops at the first lesson that cannot be completed. If QUREO returns HTTP 404 before a lesson page has initialized, it opens that lesson in your default browser, waits, and retries. The browser must be signed in to the same account. Only after every lesson succeeds does the solver initialize the chapter assessment and submit answers from `answers/<course_id>.json`. It stops if an answer is rejected or chapter completion is not confirmed.

The current JavaScript answer bank contains the five questions in Chapter 43. Add reviewed answers as further chapters become available.

## Search answer references

```powershell
qureo answers sync
qureo search "س127"
qureo search "Math.floor"
qureo search "function sum"
```

The public-guide sync reads the MI Academy QUREO solutions index and chapter pages that are publicly accessible. Some chapters show only previews and direct readers to paid/member content. The CLI stores only what the pages expose publicly; it does not bypass a paywall or access controls.

## Save your own answers and notes

```powershell
qureo answer save --question-key "س127" --question "رقم صحيح من 0 لـ 9" --type code --answer 'console.log(Math.floor(Math.random() * 10));' --explanation "Generate a random number from 0 up to but excluding 10, then floor it."
qureo answers list
qureo answer show 1
qureo search "س127"
```

## Other commands

```powershell
qureo stats
qureo exercises
qureo answer list-old
qureo database
qureo --help
```

## Storage and privacy

- `data\qureo.db`: courses, chapters, questions, public guide cache and personal answer notes.
- `data\session.dpapi`: encrypted cookies, decryptable only by the same Windows user on this PC.
- The old `data\browser-profile` directory, if present from version 0.1.x, is no longer used.

Do not share the `data` directory. It contains your authenticated session and personal answer archive.

## Network behavior

The login endpoint currently used by QUREO integrations is `POST https://me-portal.qureo.education/oauth2/password-login` with a JSON body containing `student_id` and `password`. The learning API is under `https://me-tp.qureo.education/api/study`. These are service endpoints rather than a documented public API, so QUREO can change them at any time. Requests are restricted in this client to the two HTTPS QUREO hosts.
