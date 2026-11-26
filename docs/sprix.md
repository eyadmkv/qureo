# SPRIX financial-literacy study guide

This guide covers the local study companion for **الثقافة المالية** in the Egyptian second-year Baccalaureate curriculum.

The curriculum index currently lists six units:

| Unit | Learning elements |
| --- | ---: |
| أساسيات المال والتمويل | 28 |
| أساسيات الأعمال والاقتصاد | 23 |
| التمويل الشخصي والائتمان واتخاذ القرار | 23 |
| ريادة الأعمال | 23 |
| أساسيات الاستثمار وإدارة الثروات | 23 |
| الذكاء الاصطناعي والتمويل ومستقبل الأعمال | 14 |
| **Total** | **134** |

The course page is [SPRIX Learning Square](https://egy.app.spx-learning-square.com/subjects/7/curriculum).

## Capture a lesson

Open a learning element in your signed-in browser. Click inside the lesson dialogue/content area, then copy its visible text with **Ctrl+A**, followed by **Ctrl+C**. Before saving, check what Windows actually copied:

```powershell
qureo sprix clipboard
qureo sprix capture --title "كيف نشأ المال" --unit "أساسيات المال والتمويل"
```

The clipboard diagnostic prints the character count, non-empty line count, question count and a short preview. A full interactive lesson is expected to be substantially longer than 500 characters. Captures under 500 characters are rejected by default so a selection containing only one dialogue line is not mistaken for a complete lesson. Use `--allow-short` only for an intentional excerpt.

The command reads the clipboard through PowerShell, saves the full text locally, and extracts multiple-choice blocks that use the lesson's visible “اختار إجابة واحدة” prompt and A-D options. It supports both standalone option labels and labels followed by option text on the same line. Re-capturing a lesson with the same title and unit updates its existing record.

To capture a text file instead:

```powershell
qureo sprix capture --title "كيف نشأ المال" --unit "أساسيات المال والتمويل" --file .\lesson.txt
```

## Review captured material

```powershell
qureo sprix status
qureo sprix lessons
qureo sprix lesson <capture-id>
qureo sprix questions
qureo sprix questions --unit "أساسيات المال والتمويل"
qureo sprix question <question-id>
qureo sprix search "التضخم"
```

Question IDs are deterministic for the same prompt and options, so recapturing an unchanged lesson does not create duplicate question records.

## Save personal reference answers and practice

```powershell
qureo sprix key <question-id> C --explanation "Write the reason for this answer."
qureo sprix practice
qureo sprix practice <question-id>
```

A reference key is a personal study note that you entered. The program does not claim that it was verified by the platform. Practice mode compares your selected option with your saved key and displays your explanation.

## Export and local storage

```powershell
qureo sprix export
qureo sprix export --out .\sprix-study.json
```

The default store is `data/sprix/study.json`. It contains captured lesson text, extracted questions, and personal reference keys. The entire `data/` directory is ignored by Git. Review exports before sharing because they may contain copyrighted course material and personal notes.

## Scope and limitations

- The tool works with content that is already visible in your browser and that you explicitly copy.
- It does not request or store SPRIX passwords, session cookies, or browser tokens.
- It does not use guessed private API endpoints.
- It does not submit answers, mark lessons complete, reset attempts, or change your SPRIX account.
- The question parser currently targets four-option A-D questions. Other exercise types remain in the captured lesson text but are not converted into practice questions.
- If the platform changes its visible wording or option layout, some questions may need to be captured from a text file with minor cleanup.

The material is stored on your computer. The QUREO login session and QUREO solver are separate and are not used by these SPRIX commands.
