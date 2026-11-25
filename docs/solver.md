# Chapter solver

The solver can submit answers and complete learning activities on the authenticated QUREO account. Use it only when you understand the selected chapter range and have reviewed the answer bank.

## Basic usage

```powershell
qureo solve
qureo solve 20
qureo solve 18-30
qureo solve --single
qureo solve --max-chapters 5
qureo solve 18-30 --interactive
qureo solve 18-30 --pause-between-chapters 5 --pause-between-questions 1
qureo solve 44 --dry-run
```

A numeric target preserves the existing through-chapter behavior. An explicit range is inclusive. The solver starts at the first unfinished chapter and refuses to jump over an earlier unfinished chapter.

## Options

- `--single`: process only the current unfinished chapter.
- `--max-chapters <count>`: limit the number of chapters selected for this run.
- `--pause-between-chapters <seconds>`: pause after a completed chapter.
- `--pause-between-questions <seconds>`: pause between submissions.
- `--interactive`: request confirmation before each selected chapter.
- `--no-skip-completed`: allow completed chapters inside an explicit range to be selected again. QUREO may reject repeated assessments.
- `--no-resume`: ignore the previous local checkpoint for the startup message. QUREO's server progress remains authoritative.
- `--dry-run`: inspect the selected work without submitting answers.

## Execution order and safeguards

1. Read QUREO progress and select the next eligible chapter.
2. Verify that the local answer bank contains an answer for every required assessment question.
3. Complete lessons sequentially.
4. Initialize the chapter assessment only after every lesson completion succeeds.
5. Submit answers from the local answer bank.
6. Mark the chapter complete only after QUREO confirms completion.

The solver stops when a required lesson or answer submission fails. It must not skip forward after an error.

## Lesson initialization

Some QUREO lesson completion endpoints return HTTP 404 until the lesson page has initialized in QUREO's browser application. In that case, the CLI opens the exact lesson URL in the default browser and retries while the endpoint becomes available. The browser must be signed in to the same QUREO account.

## Recovery limitations

The local checkpoint records the last observed chapter, lesson, question and run state. If a request times out after QUREO may have accepted it, the checkpoint alone cannot prove the server-side result. Do not assume a timed-out submission failed or blindly retry it. Reconcile the account state before continuing.

## Answer bank

The solver reads course-specific answer files from `answers/<course_id>.json`. Keep answer banks local and review them before use. A missing or incorrect answer can cause QUREO to reject a submission.
