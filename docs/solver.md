# Chapter solver

The solver works with the authenticated QUREO account. Run it without a course option to choose an available course interactively. It reads answers from \`answers/<course_id>.json\`.

## Basic usage

\`\`\`powershell
qureo solve
\`\`\`

The CLI lists supported courses and asks you to choose one. You can also select a course directly:

\`\`\`powershell
qureo solve --course javascript_ar
qureo solve --course python_short_ar
qureo solve --course python_short_ar --dry-run
\`\`\`

A chapter number or range keeps its existing meaning after the course is selected:

\`\`\`powershell
qureo solve 20
qureo solve 18-30 --course javascript_ar
qureo solve --course python_short_ar --single
qureo solve --course python_short_ar --max-chapters 5
qureo solve 18-30 --course javascript_ar --interactive
qureo solve --course javascript_ar --pause-between-chapters 5 --pause-between-questions 1
\`\`\`

The solver starts at the first unfinished chapter and refuses to jump over an earlier unfinished chapter.

## Options

- \`--course <id>\`: choose a course without showing the interactive menu.
- \`--single\`: process only the current unfinished chapter.
- \`--max-chapters <count>\`: limit the number of chapters selected for this run.
- \`--pause-between-chapters <seconds>\`: pause after a completed chapter.
- \`--pause-between-questions <seconds>\`: pause between submissions.
- \`--interactive\`: request confirmation before starting each selected chapter.
- \`--no-skip-completed\`: allow completed chapters inside an explicit range to be selected again. QUREO may reject repeated assessments.
- \`--no-resume\`: ignore the previous local checkpoint for the startup message. QUREO's server progress remains authoritative.
- \`--dry-run\`: inspect the selected work without submitting answers or completing lessons.

## Python course support

Python uses the same solver flow as JavaScript. Both QUREO question types currently used by the Python course, \`choice\` and \`description\`, are supported. The description type submits the saved Python code through QUREO's answer endpoint.

The committed \`answers/python_short_ar.json\` currently covers all six assessment questions in chapter 1 (\`511001\`) and all nine assessment questions in chapter 2 (\`511002\`). Chapter 2 answers were matched against the live QUREO export by exact question ID, question type and choice ID, then checked against the public Python guide. The imported 448-item public Python guide remains a separate offline reference because it does not contain QUREO assessment IDs. Later Python chapters still need their own exact QUREO question IDs and verified answer entries. The solver does not map lesson answers to assessment IDs by order or guesswork.

Some Python chapter assessments are unavailable through the API until the chapter lessons are completed. When QUREO returns this precondition response, the solver checks the local answer bank against the chapter's expected question count first. It completes the lessons and retries the assessment request only when the local bank has enough chapter-specific entries. If coverage is incomplete, the solver stops before completing lessons or changing assessment progress.

## Execution order and safeguards

1. Read QUREO progress and select the next eligible chapter.
2. Fetch the assessment questions when QUREO makes them available.
3. Verify that every question has a matching answer of the correct type and, for choices, a valid option ID.
4. Complete lessons sequentially.
5. Initialize the chapter assessment and submit answers from the selected course's local bank.
6. Mark the chapter complete only after QUREO confirms the result.

The solver stops when a required lesson, answer submission, or completion check fails. It does not skip forward after an error.

## Lesson initialization

Some QUREO lesson completion endpoints return HTTP 404 until the lesson page has initialized. In that case, the CLI requests the exact lesson URL through the saved authenticated QUREO session and retries the completion endpoint in the background. It does not open a browser tab. This request does not execute QUREO's frontend JavaScript, so the API may still reject initialization if the lesson requires client-side setup.

## Recovery limitations

The local checkpoint records the last observed course, chapter, lesson, question and run state. If a request times out after QUREO may have accepted it, the checkpoint alone cannot prove the server-side result. Do not assume a timed-out submission failed or blindly retry it. Reconcile the account state before continuing.

## Answer bank

The solver reads course-specific answer files from \`answers/<course_id>.json\`. Keep answer banks local and review them before use. A missing or incorrect answer can cause QUREO to reject a submission.
