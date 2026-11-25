# QUREO Feature Roadmap

This roadmap records selected feature groups and their implementation status.

## Solver controls

- [x] Inclusive chapter ranges
- [x] Maximum chapter count
- [x] Single-chapter mode
- [x] Pause between chapters and questions
- [x] Interactive confirmation before each chapter
- [x] Configurable handling of completed chapters in explicit ranges
- [ ] Complete interruption recovery, including safe reconciliation of timed-out assessment submissions

## Reliability and request recovery

- [ ] Shared retry engine for API operations
- [ ] Exponential backoff
- [ ] Respect the server's `Retry-After` header
- [ ] Connection-state reporting during operations
- [ ] Automatic reconnection after transient network failures
- [ ] Configurable request-timeout profiles
- [x] Persistent lesson/question checkpoints
- [ ] Reconcile timed-out submissions with QUREO state before retrying
- [ ] Consistent session-expiration detection
- [ ] Structured failure and recovery reports

## CLI experience

- [x] Rich terminal interface
- [x] Live progress bars
- [x] Configurable terminal themes
- [x] Context-aware command suggestions
- [x] Local command history
- [x] `qureo dashboard`
- [x] `qureo doctor`
- [x] `qureo status`
- [x] Central configuration file
- [x] PowerShell autocomplete
- [x] Compact dashboard layout

## Profiles, isolation and privacy

- [ ] Multiple QUREO profiles
- [ ] Named profile switching
- [ ] Separate database, session and answer-bank storage per profile
- [ ] Profile-specific settings
- [ ] Secure encrypted-session backup
- [ ] Expired-session cleanup
- [ ] Sensitive-data and Git-leak scanner
- [ ] Local privacy audit
- [ ] Read-only mode
- [ ] Local activity log

## Dashboards and notifications

- [ ] Local web dashboard
- [ ] Desktop notifications
- [ ] Optional Telegram notifications
- [ ] Study scheduler and daily progress target

## Safety invariants

1. Chapters are processed sequentially. A requested range must never cause the solver to jump over an earlier unfinished chapter.
2. A chapter assessment is initialized only after every lesson in that chapter has been completed successfully.
3. A chapter is counted as complete only after QUREO confirms completion.
4. A timed-out answer submission must be reconciled with QUREO before the client decides whether to submit it again.
5. Account profiles must isolate sessions, databases, answer banks, checkpoints and logs.
6. Read-only mode must never issue a state-changing QUREO request.
