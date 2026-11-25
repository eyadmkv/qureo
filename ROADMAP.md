# QUREO Feature Roadmap

This roadmap records the feature groups selected for the personal QUREO CLI.

## Phase 1: Solver controls

- [x] 1. Inclusive chapter ranges: `qureo solve 18-30`
- [x] 2. Maximum chapter count: `--max-chapters <count>`
- [x] 3. Single-chapter mode: `--single`
- [ ] 4. Complete interruption recovery. Checkpoint recording and server-progress-based restart are implemented; safe recovery of a request interrupted during assessment submission is still pending.
- [x] 5. Pause between chapters
- [x] 6. Pause between questions
- [x] 7. Interactive confirmation before each chapter
- [x] 8. Configurable completed-chapter handling for explicit ranges

## Phase 2: Reliability and request recovery

- [ ] 11. Shared retry engine for API operations
- [ ] 12. Exponential backoff
- [ ] 13. Respect the server's `Retry-After` header
- [ ] 14. Connection-state reporting during operations
- [ ] 15. Automatic reconnection after transient network failures
- [ ] 16. Configurable request-timeout profiles
- [x] 17. Persistent lesson/question checkpoints
- [ ] 18. Reconcile timed-out submissions with QUREO state before retrying
- [ ] 19. Consistent session-expiration detection
- [ ] 20. Structured failure and recovery reports

## Phase 3: CLI experience

- [ ] 66. Rich terminal interface
- [ ] 67. Live progress bars
- [ ] 68. Configurable terminal themes
- [ ] 69. Context-aware command suggestions
- [ ] 70. Local command history
- [ ] 71. `qureo dashboard`
- [ ] 72. `qureo doctor`
- [ ] 73. `qureo status`
- [ ] 74. Central configuration file
- [ ] 75. PowerShell autocomplete

## Phase 4: Profiles, isolation, and privacy

- [ ] 76. Multiple QUREO profiles
- [ ] 77. Named profile switching
- [ ] 78. Separate database, session, and answer-bank storage per profile
- [ ] 79. Profile-specific settings
- [ ] 80. Secure encrypted-session backup
- [ ] 81. Expired-session cleanup
- [ ] 82. Sensitive-data and Git-leak scanner
- [ ] 83. Local privacy audit
- [ ] 84. Read-only mode
- [ ] 85. Local activity log

## Phase 5: Dashboards and notifications

- [ ] 96. Local web dashboard
- [ ] 97. Desktop notifications
- [ ] 98. Optional Telegram notifications
- [ ] 99. Study scheduler and daily progress target

## Safety invariants

1. Chapters are processed sequentially. A requested range must never cause the solver to jump over an earlier unfinished chapter.
2. A chapter assessment is initialized only after every lesson in that chapter has been completed successfully.
3. A chapter is counted as complete only after QUREO confirms completion.
4. A timed-out answer submission must be reconciled with QUREO before the client decides whether to submit it again.
5. Account profiles must isolate sessions, databases, answer banks, checkpoints, and logs.
6. Read-only mode must never issue a state-changing QUREO request.
