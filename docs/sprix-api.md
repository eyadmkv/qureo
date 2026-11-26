# SPRIX API CLI

The repository now exposes a standalone `sprix` command and the same API commands under `qureo sprix`. The API client talks to the SPRIX Learning Square host over HTTPS. It is separate from the QUREO login session.

## Import a browser session

The portal login process is handled by SPRIX in your browser. This CLI does not guess a login endpoint or ask for your SPRIX password.

1. Sign in to SPRIX normally in your browser.
2. Open Developer Tools with **F12**, then select **Network**.
3. Open or refresh the SPRIX curriculum page.
4. Select the authenticated request to `/api/v1/subjects/7/curriculum`.
5. Right-click it and choose **Copy → Copy as cURL**.
6. Keep that copied command private. It contains your session cookie.
7. In PowerShell, type the command below manually so the clipboard still contains the cURL request:

```powershell
sprix login --clipboard
```

The CLI extracts only the `Cookie` header, validates it with a read-only curriculum request, and saves the session encrypted with Windows DPAPI in `data/sprix/session.dpapi`. The cookie is never printed.

You can also save the copied cURL request in a local UTF-8 file and use:

```powershell
sprix login --cookie-file .\sprix-session-curl.txt
```

Do not commit that file, upload it, paste it into a chat, or share it. Delete the temporary cURL file after importing the session.

## Read course data

```powershell
sprix session status
sprix curriculum 7
sprix chapter <chapter-id>
sprix review items <review-id>
```

The curriculum lists unit learning items and their item types, IDs, unlock state, and completion state. Use those IDs with the matching chapter, review, or test command.

Add `--json` to `sprix curriculum`, `sprix chapter`, or `sprix review items` for the complete response data.

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

These routes and payload shapes were identified from a public browser extension implementation and have not yet been validated against every SPRIX account or course state. Session import performs a live read-only curriculum request before saving. If an endpoint changes or your account lacks access, the CLI reports the API response and stops.

The client is restricted to HTTPS `*.spx-learning-square.com` hosts and same-origin `/api/v1/` paths. It does not retry POST or PUT requests after network errors because the server may already have processed a request. Account-changing actions require `--yes`.

Your encrypted session, captures, exports, and personal answer notes stay inside the ignored local `data/` directory. Never commit that directory.
