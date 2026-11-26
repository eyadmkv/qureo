# SPRIX API CLI

The repository now exposes a standalone `sprix` command and the same API commands under `qureo sprix`. The API client talks to the SPRIX Learning Square host over HTTPS. It is separate from the QUREO login session.

## Sign in with Login ID and password

The CLI supports the same Login ID + Password flow shown on the SPRIX sign-in page. It sends a JSON request to `POST /api/v1/auth/login` with `login_id` and `password`, then validates the returned session with a read-only curriculum request.

Run:

```powershell
sprix login
```

Enter your Login ID when prompted, then type your password at the hidden password prompt. The password is sent directly to SPRIX for authentication and is not saved to disk or included in command history. The resulting session cookies are encrypted with Windows DPAPI in `data/sprix/session.dpapi`.

You can pass the Login ID as an option while keeping the password prompt hidden:

```powershell
sprix login --login-id <login-id>
```

The login route and payload names were cross-checked against the public [SPX Learning Square API client implementation](https://github.com/kky84rgkjy-maker/mohammad/blob/9e73d17e0667c6eb8f358ceda53c2abec2e9a7db/gfq_solver.py). The CLI validates the resulting cookie session immediately. If SPRIX changes its login contract or does not return session cookies, the command stops with an error.

### Optional browser-session import fallback

The previous cookie import remains available if password login is unavailable:

1. Sign in to SPRIX normally in your browser.
2. Open Developer Tools with **F12**, then select **Network**.
3. Select an authenticated request to `/api/v1/subjects/7/curriculum`.
4. Right-click it and choose **Copy → Copy as cURL**.
5. Keep that copied command private. It contains your session cookie.
6. In PowerShell, run `sprix login --clipboard` without copying anything else first.

You can also save the copied cURL request in a local UTF-8 file and use `sprix login --cookie-file .\\sprix-session-curl.txt`. Do not commit or share that file, and delete it after importing the session.

## Read course data

```powershell
sprix session status
sprix sync 7
sprix progress
sprix curriculum 7
sprix chapter <chapter-id>
sprix review items <review-id>
```

The curriculum lists unit learning items and their item types, IDs, unlock state, and completion state. Use those IDs with the matching chapter, review, or test command. The `sync` command saves a local snapshot under `data/sprix/`; `progress` summarizes the latest snapshot.

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

This export is source material for building a separate answer bank. It does not fabricate correct answers. Correct answers should be added only when supported by the lesson explanation or an independently verified source.

## Import your userscript answer bank and preview a solve

The userscript import is optional. The course-source export above works independently and does not require a userscript. The `DATA` import remains available only for users who already have a separate local question bank.

```powershell
sprix bank import --file .\script.js
sprix bank status
```

Use `--replace` to replace an existing local bank after reviewing the source file:

```powershell
sprix bank import --file .\script.js --replace
```

The solver starts in dry-run mode. It fetches the chapter blocks, compares pending questions and option text against the local bank, then prints the planned option IDs and match scores:

```powershell
sprix solve <chapter-id>
```

Review every match. To submit the entire plan, repeat it with `--yes`. If any pending question has no confident, unique question and option match, the solver stops before sending any answer:

```powershell
sprix solve <chapter-id> --yes
```

Chapter completion is a separate action. Add `--complete` only when you also intend to mark the chapter completed:

```powershell
sprix solve <chapter-id> --yes --complete
```

The imported bank is stored at `data/sprix/answer-bank.json`. It is ignored by Git and is not included in this repository. The solver never guesses through answer options, retries answer submissions, or continues after SPRIX fails to confirm an answer as correct.

## Explicit account-changing actions

Every command that changes course state requires `--yes`. Review the IDs and the displayed content before running it.

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
