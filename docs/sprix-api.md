# SPRIX API CLI

The repository now exposes a standalone `sprix` command and the same API commands under `qureo sprix`. The API client talks to the SPRIX Learning Square host over HTTPS. It is separate from the QUREO login session.

## Sign in with Login ID and password

The CLI supports the same Login ID + Password flow shown on the SPRIX sign-in page. It sends a JSON request to `POST /api/v1/auth/login` with `login_id` and `password`, fetches `GET /api/v1/subjects`, selects the active Financial Literacy course, and validates the session with a read-only curriculum request. The selected subject ID is saved with the encrypted session and reused by later commands.

Run:

```powershell
sprix login
```

Enter your Login ID when prompted, then type your password at the hidden password prompt. The password is sent directly to SPRIX for authentication and is not saved to disk or included in command history. The resulting session cookies are encrypted with Windows DPAPI in `data/sprix/session.dpapi`.

When the account has multiple active courses, the CLI stops and asks you to choose one. Pass `--subject <id>` to select a specific subject. To validate a different course later, pass the same option to the relevant command.

You can pass the Login ID as an option while keeping the password prompt hidden:

```powershell
sprix login --login-id <login-id>
```

The login route and payload names were cross-checked against the public [SPX Learning Square API client implementation](https://github.com/kky84rgkjy-maker/mohammad/blob/9e73d17e0667c6eb8f358ceda53c2abec2e9a7db/gfq_solver.py). The CLI validates the resulting cookie session immediately. If SPRIX changes its login contract or does not return session cookies, the command stops with an error.

### Optional browser-session import fallback

The previous cookie import remains available if password login is unavailable:

1. Sign in to SPRIX normally in your browser.
2. Open Developer Tools with **F12**, then select **Network**.
3. Select an authenticated request to `/api/v1/subjects` or another SPRIX API endpoint.
4. Right-click it and choose **Copy → Copy as cURL**.
5. Keep that copied command private. It contains your session cookie.
6. In PowerShell, run `sprix login --clipboard` without copying anything else first.

You can also save the copied cURL request in a local UTF-8 file and use `sprix login --cookie-file .\\sprix-session-curl.txt`. Do not commit or share that file, and delete it after importing the session.


## Capture an undocumented lesson action safely

Some interactive lesson controls are not represented by the currently documented chapter and review endpoints. To identify one without exposing your session cookie:

1. Open the lesson in Chrome and press **F12**.
2. Select **Network**, then the **Fetch/XHR** filter. Clear the request list.
3. Click one **علّم كمراجع** card.
4. Select the new request, right-click it, and choose **Copy → Copy as cURL**.
5. In PowerShell, run:

   ~~~powershell
   sprix inspect-action
   ~~~

6. Paste only the sanitized JSON printed by the command into your issue or chat. It removes cookies, authorization values, CSRF/XSRF tokens, sensitive URL parameters and sensitive JSON fields. It performs no network request and does not save the copied cURL.

Capture the request produced by the final **راجعت كل حاجة** action separately once that button is enabled. One sample of each action is enough to identify the request patterns; do not share the raw cURL text or browser session data.

## Read course data

```powershell
sprix session status
sprix sync
sprix progress
sprix curriculum
sprix chapter <chapter-id>
sprix review items <review-id>
```

The curriculum lists unit learning items and their item types, IDs, unlock state, and completion state. These commands default to the subject saved by `sprix login`. Pass an explicit subject ID only when switching courses. Use the returned item IDs with the matching chapter, review, or test command. The `sync` command saves a local snapshot under `data/sprix/`; `progress` summarizes the latest snapshot.

Add `--json` to `sprix curriculum`, `sprix chapter`, or `sprix review items` for the complete response data.

## Export all chapter and review source material without a userscript

You can export the course's live chapter blocks and review items directly from your authenticated CLI session. This uses read-only GET requests and does not submit answers, start tests, or change your progress.

```powershell
sprix bank harvest
```

The default output is `data/sprix/course-source.json`. To choose another path:

```powershell
sprix bank harvest --out .\sprix-course-source.json
```

The export includes all units and learning-item metadata, chapter blocks, question prompts, option IDs and text, review items, and a summary of any failed requests. Test items are listed by ID, but the export does not start test attempts or attempt to extract test answer keys.

This export is source material for building a separate answer bank. It does not contain SPRIX correctness flags. A separate answer map can be matched to the exported question and option IDs, then converted into the solver's local text bank.

## Build a local bank from the course export

The course export contains the prompts and option text, but SPRIX does not return correct-option flags for chapter questions. A separate answer map is therefore required. Keep both JSON files under the ignored local `data/sprix/` directory.

Place the course export at `data/sprix/course-source.json` and the matching answer map at `data/sprix/answer-map.json`, then run:

```powershell
sprix bank build
sprix bank status
```

The builder verifies that every source question has a mapped option ID and that each selected option belongs to that question. It converts the selected option text into the local bank format used by `sprix solve`. An incomplete or mismatched map is rejected without saving a bank.

The answer map is separate from the harvested source and should remain local. Correct choices may be inferred from question wording and hints; SPRIX itself did not provide official answer-key fields. Always review the dry-run plan before submitting. The 22 listed tests are not included because their question sets were not fetched.

To use different paths:

```powershell
sprix bank build --source .\\tmp\\course-source.json --answers .\\data\\sprix\\answer-map.json
```

## Solve the entire SPRIX course

The solver uses your local answer bank and the live curriculum. It processes chapters and reviews in their curriculum order, starting at the first unfinished item and skipping completed items. When it reaches a review, it submits the review-completion request directly. The solver does not need to fetch the protected review-item payload first. Test items remain untouched.

Import your local answer source if you have not already done so:

```powershell
sprix bank import --file .\script.js
sprix bank status
```

Preview every remaining chapter without changing your account:

```powershell
sprix solve --dry-run
```

Run the course solver:

```powershell
sprix solve
```

The command asks once before making account changes. It processes chapter and review items in curriculum order. After every chapter has received confirmed correct answers, it requests chapter completion and refreshes the curriculum. At each review, it sends the review-completion request directly, then refreshes the curriculum and confirms completion before continuing. A dry-run only prints the review action and does not request protected review-item data. This allows SPRIX to unlock later items in sequence. It stops at the first locked or inaccessible chapter, unmatched question, rejected answer, or unconfirmed chapter or review completion. It never guesses an option or continues past a failed item.

For non-interactive terminals, pass `--yes` to confirm the full run:

```powershell
sprix solve --yes
```

Useful limits and controls:

```powershell
sprix solve --single
sprix solve --max-chapters 5
sprix solve --pause-between-chapters 2 --pause-between-questions 1
sprix solve --no-skip-completed
```

To work on one specific chapter instead of the whole course:

```powershell
sprix solve <chapter-id> --dry-run
sprix solve <chapter-id> --yes
sprix solve <chapter-id> --complete --yes
```

A specific chapter remains a one-chapter operation. Add `--complete` when you also want the command to mark that selected chapter complete. In a course-wide run, the solver completes reviews as it encounters them and completes chapters after their answers are accepted. Use `--answers-only` to submit chapter answers while leaving chapter and review completion unchanged.

The imported bank is stored at `data/sprix/answer-bank.json`. It is ignored by Git and is not included in this repository. The solver stops before submitting any answers in a chapter if one or more pending questions have no confident, unique match.

## Explicit account-changing actions

Account-changing commands require `--yes` or an interactive confirmation. `sprix solve` asks once before a course run; use `--yes` to confirm it in a non-interactive terminal. Review the dry-run output first when you want to inspect matches.

```powershell
sprix answer <chapter-id> <block-id> <option-id> --yes
sprix complete <chapter-id> --yes
sprix review complete <review-id> --yes

sprix test start <test-id> --yes
sprix test answer <test-id> <test-question-id> <option-id> --yes
sprix test submit <test-id> --yes
```

Starting a test opens an attempt. Answer commands save the option you explicitly selected. The submit command sends that attempt for grading. The CLI does not try options until one is accepted, create dummy submissions to reveal answer keys, or automatically submit a test.

Achievement processing is also state-changing and requires confirmation:

```powershell
sprix achievements unlock 7 --yes
```

## Session management

```powershell
sprix session status
sprix logout
```

If the session expires or the portal rejects the cookie, sign in again and import a fresh cURL request.

## API and safety notes

The client uses these observed API routes:

| Operation | Method | Route |
| --- | --- | --- |
| Curriculum | GET | `/api/v1/subjects/{subjectId}/curriculum` |
| Chapter blocks | GET | `/api/v1/chapters/{chapterId}/blocks` |
| Chapter answer | POST | `/api/v1/chapters/{chapterId}/answer` |
| Chapter completion | POST | `/api/v1/chapters/{chapterId}/complete` |
| Review items | GET | `/api/v1/reviews/{reviewId}/items` |
| Review completion | POST | `/api/v1/reviews/{reviewId}/complete` |
| Start test | POST | `/api/v1/tests/{testId}/start` |
| Test answer | PUT | `/api/v1/tests/{testId}/questions/{testQuestionId}/answer` |
| Submit test | POST | `/api/v1/tests/{testId}/submit` |

These routes and payload shapes were cross-referenced against the public [Qureo & SPX Auto Completer](https://github.com/pola90000/Qureo-SPX-Auto-Completer) browser-extension implementation. They have not yet been validated against every SPRIX account or course state. Session import performs a live read-only curriculum request before saving. If an endpoint changes or your account lacks access, the CLI reports the API response and stops.

The client is restricted to HTTPS `*.spx-learning-square.com` hosts and same-origin `/api/v1/` paths. It does not retry POST or PUT requests after network errors because the server may already have processed a request. Account-changing actions require `--yes`.

Your encrypted session, captures, exports, and personal answer notes stay inside the ignored local `data/` directory. Never commit that directory.
