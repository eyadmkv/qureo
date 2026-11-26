# SPRIX lesson exporter

This directory contains a standalone Tampermonkey userscript that exports the visible SPRIX lesson page as a UTF-8 text file.

## Install

1. Install Tampermonkey in your browser.
2. Open `sprix-lesson-export.user.js` from this repository and copy its complete contents.
3. In Tampermonkey, select **Create a new script**, replace the editor contents with the copied script, and save.
4. Refresh the SPRIX lesson page.
5. Click **تصدير نص الدرس الحالي**. The browser downloads a file named `sprix-lesson-*.txt`.

## Capture with the QUREO CLI

```powershell
$lessonFile = Get-ChildItem "$HOME\Downloads\sprix-lesson-*.txt" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName

qureo sprix capture --title "كيف نشأ المال" --unit "أساسيات المال والتمويل" --file "$lessonFile"
qureo sprix questions
```

The exporter reads the rendered page under `main` or `[role="main"]`. It does not access browser cookies, credentials, private API endpoints, or submit answers or progress. Review the downloaded text because page layouts can change and visible interface labels may be included.
