package com.eyadmkv.qureo

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val ink = Color.rgb(20, 25, 30)
    private val panel = Color.rgb(31, 38, 45)
    private val accent = Color.rgb(223, 119, 65)
    private val pale = Color.rgb(238, 240, 242)
    private lateinit var logView: TextView
    private lateinit var statusView: TextView
    private lateinit var qureoId: EditText
    private lateinit var qureoCourse: Spinner
    private lateinit var qureoPassword: EditText
    private lateinit var qureoChapter: EditText
    private lateinit var sprixId: EditText
    private lateinit var sprixPassword: EditText
    private lateinit var sprixSubject: EditText
    private lateinit var webView: WebView
    private val answerBankPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) importQureoAnswerBank(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()
        buildInterface()
        subscribeToProgress()
        refreshSessionStatus()
    }

    private fun buildInterface() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(32))
            setBackgroundColor(ink)
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            addView(page)
        }

        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(18))
            background = rounded(panel, 22)
        }
        val brandRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val mark = TextView(this).apply {
            text = "›"
            textSize = 34f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            background = rounded(accent, 16)
            layoutParams = LinearLayout.LayoutParams(dp(54), dp(54))
        }
        brandRow.addView(mark)
        val brandText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, 0, 0)
            addView(label("QUREO / SPRIX", 22f, Color.WHITE, true))
            addView(label("PERSONAL CONTROL CENTER", 10f, pale, true))
        }
        brandRow.addView(brandText)
        heading.addView(brandRow)
        statusView = label("Checking local sessions...", 12f, accent, true).apply {
            setPadding(0, dp(18), 0, 0)
        }
        heading.addView(statusView)
        page.addView(heading, fullWidth().apply { bottomMargin = dp(18) })

        page.addView(sectionCard("QUREO", "Course automation and answer-bank tools") {
            addFieldLabel("Course")
            qureoCourse = Spinner(this@MainActivity).apply {
                adapter = ArrayAdapter(
                    this@MainActivity,
                    android.R.layout.simple_spinner_dropdown_item,
                    listOf("Python · البرمجة بلغة Python", "JavaScript · البرمجة بلغة JavaScript")
                )
                setSelection(0)
            }
            addView(qureoCourse, fullWidth().apply { bottomMargin = dp(10) })
            qureoId = input("Student ID", InputType.TYPE_CLASS_TEXT)
            qureoPassword = input("Password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
            qureoChapter = input("Chapter number or ID (optional)", InputType.TYPE_CLASS_TEXT)
            addView(qureoId)
            addView(qureoPassword)
            addView(actionButton("Sign in to QUREO") { loginQureo() })
            addView(actionButton("Sign out", true) {
                QureoClient(applicationContext).logout()
                refreshSessionStatus()
                appendLog("QUREO session removed.")
            })
            addView(divider())
            addView(actionButton("Update answer bank", true) { syncQureoAnswerBank(force = true) })
            addView(actionButton("Import answer-bank JSON", true) {
                answerBankPicker.launch(arrayOf("application/json", "text/plain", "*/*"))
            })
            addView(qureoChapter)
            addView(actionButton("Solve selected chapter") {
                val target = qureoChapter.text.toString().trim().ifBlank { null }
                startSolver(SolverService.ACTION_QUREO, target = target, course = currentQureoCourse(), single = true)
            })
            addView(actionButton("Solve all remaining chapters") {
                startSolver(SolverService.ACTION_QUREO, course = currentQureoCourse())
            })
            addView(actionButton("Preview remaining chapters", true) {
                startSolver(SolverService.ACTION_QUREO, course = currentQureoCourse(), dryRun = true)
            })
        })

        page.addView(sectionCard("SPRIX", "Financial Literacy · live curriculum tools") {
            sprixId = input("SPRIX Login ID", InputType.TYPE_CLASS_TEXT)
            sprixPassword = input("Password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
            sprixSubject = input("Subject ID (7 Arabic · 3 English)", InputType.TYPE_CLASS_NUMBER).apply { setText("7") }
            addView(sprixId)
            addView(sprixPassword)
            addView(sprixSubject)
            addView(actionButton("Sign in to SPRIX") { loginSprix() })
            addView(actionButton("Sign out", true) {
                SprixClient(applicationContext).logout()
                refreshSessionStatus()
                appendLog("SPRIX session removed.")
            })
            addView(divider())
            addView(actionButton("Solve all remaining items") {
                startSolver(SolverService.ACTION_SPRIX, subject = currentSubject())
            })
            addView(actionButton("Solve next chapter only") {
                startSolver(SolverService.ACTION_SPRIX, subject = currentSubject(), single = true)
            })
            addView(actionButton("Preview remaining items", true) {
                startSolver(SolverService.ACTION_SPRIX, subject = currentSubject(), dryRun = true)
            })
        })

        val logs = sectionCard("RUN LOG", "Live activity from sign-in, sync and solver tasks") {
            val logActions = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val logHint = label("LATEST OUTPUT", 10f, accent, true)
            logActions.addView(logHint, LinearLayout.LayoutParams(0, dp(36), 1f))
            val clearButton = Button(this@MainActivity).apply {
                text = "Clear logs"
                isAllCaps = false
                textSize = 12f
                minHeight = dp(36)
                minimumHeight = dp(36)
                setPadding(dp(12), 0, dp(12), 0)
                setTextColor(pale)
                backgroundTintList = android.content.res.ColorStateList.valueOf(ink)
                setOnClickListener {
                    logView.text = "Logs cleared."
                    Toast.makeText(this@MainActivity, "Run log cleared", Toast.LENGTH_SHORT).show()
                }
            }
            logActions.addView(clearButton)
            addView(logActions)
            logView = TextView(this@MainActivity).apply {
                text = "No run started."
                textSize = 12f
                setTextColor(pale)
                setPadding(dp(14), dp(14), dp(14), dp(14))
                background = rounded(ink, 14)
                typeface = android.graphics.Typeface.MONOSPACE
                minHeight = dp(170)
                maxHeight = dp(280)
                setTextIsSelectable(true)
                setLineSpacing(dp(2).toFloat(), 1f)
            }
            val logScroll = ScrollView(this@MainActivity).apply {
                isFillViewport = false
                addView(logView)
            }
            addView(logScroll, fullWidth().apply { topMargin = dp(8) })
        }
        page.addView(logs)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            alpha = 0f
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
        val frame = FrameLayout(this)
        frame.addView(scroll, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        frame.addView(webView, FrameLayout.LayoutParams(2, 2, Gravity.BOTTOM or Gravity.END))
        setContentView(frame)
        LessonPageBridge.attach(webView)
    }

    private fun sectionCard(title: String, subtitle: String, content: LinearLayout.() -> Unit): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = rounded(panel, 20)
        }
        card.addView(label(title, 17f, Color.WHITE, true))
        card.addView(label(subtitle, 11f, Color.LTGRAY, false).apply {
            setPadding(0, dp(4), 0, dp(14))
        })
        card.content()
        card.layoutParams = fullWidth().apply { bottomMargin = dp(16) }
        return card
    }

    private fun LinearLayout.addFieldLabel(value: String) {
        addView(label(value, 12f, pale, true).apply { setPadding(0, 0, 0, dp(5)) })
    }

    private fun divider(): View = View(this).apply {
        setBackgroundColor(Color.rgb(55, 63, 71))
        layoutParams = fullWidth().apply {
            height = dp(1)
            topMargin = dp(8)
            bottomMargin = dp(12)
        }
    }

    private fun rounded(color: Int, radius: Int): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
        }

    private fun fullWidth(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun label(value: String, size: Float, color: Int, bold: Boolean): TextView =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

    private fun input(hintText: String, inputTypeValue: Int): EditText =
        EditText(this).apply {
            hint = hintText
            inputType = inputTypeValue
            textSize = 14f
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(151, 159, 167))
            setPadding(dp(13), dp(8), dp(13), dp(8))
            background = rounded(ink, 12)
            backgroundTintList = null
            layoutParams = fullWidth().apply { bottomMargin = dp(8) }
        }

    private fun actionButton(text: String, subtle: Boolean = false, action: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            isAllCaps = false
            textSize = 13f
            minHeight = dp(46)
            minimumHeight = dp(46)
            setPadding(dp(12), dp(5), dp(12), dp(5))
            setTextColor(if (subtle) pale else Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(if (subtle) ink else accent)
            setOnClickListener { action() }
            layoutParams = fullWidth().apply { bottomMargin = dp(7) }
        }

    private fun loginQureo() {
        val id = qureoId.text.toString().trim()
        val password = qureoPassword.text.toString()
        lifecycleScope.launch {
            appendLog("Signing in to QUREO...")
            try {
                val account = QureoClient(applicationContext).login(id, password)
                appendLog("QUREO login verified: " + account)
                qureoPassword.text?.clear()
            } catch (error: Exception) {
                appendLog("QUREO login failed: " + error.message)
            }
            refreshSessionStatus()
        }
    }

    private fun loginSprix() {
        val id = sprixId.text.toString().trim()
        val password = sprixPassword.text.toString()
        val subject = currentSubject()
        lifecycleScope.launch {
            appendLog("Signing in to SPRIX...")
            try {
                val result = SprixClient(applicationContext).login(id, password, subject)
                appendLog(result)
                sprixPassword.text?.clear()
            } catch (error: Exception) {
                appendLog("SPRIX login failed: " + error.message)
            }
            refreshSessionStatus()
        }
    }

    private fun currentSubject(): String = sprixSubject.text.toString().trim().ifBlank { "7" }

    private fun currentQureoCourse(): String =
        if (qureoCourse.selectedItemPosition == 1) "javascript_ar" else "python_short_ar"

    private fun syncQureoAnswerBank(force: Boolean) {
        val courseId = currentQureoCourse()
        lifecycleScope.launch {
            try {
                appendLog("Updating the $courseId answer bank...")
                val count = QureoAnswerBank(applicationContext).sync(courseId, force) { message ->
                    appendLog(message)
                }
                appendLog("Answer bank ready for $courseId: $count answer(s).")
            } catch (error: Exception) {
                appendLog("Answer-bank update failed: ${error.message}")
            }
        }
    }

    private fun importQureoAnswerBank(uri: Uri) {
        val courseId = currentQureoCourse()
        lifecycleScope.launch {
            try {
                val content = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                    ?: throw IllegalStateException("Could not read the selected answer file.")
                val count = QureoAnswerBank(applicationContext).importBank(courseId, content)
                appendLog("Imported $count answer(s) for QUREO course $courseId.")
            } catch (error: Exception) {
                appendLog("Answer-bank import failed: " + error.message)
            }
        }
    }

    private fun startSolver(
        action: String,
        target: String? = null,
        subject: String? = null,
        course: String = "python_short_ar",
        single: Boolean = false,
        dryRun: Boolean = false
    ) {
        if (ProgressBus.running.value) {
            Toast.makeText(this, "A solver task is already running.", Toast.LENGTH_SHORT).show()
            return
        }
        val sessionExists = when (action) {
            SolverService.ACTION_QUREO -> QureoClient(applicationContext).hasSession()
            SolverService.ACTION_SPRIX -> SprixClient(applicationContext).hasSession()
            else -> false
        }
        if (!sessionExists) {
            Toast.makeText(this, "Sign in first.", Toast.LENGTH_SHORT).show()
            return
        }
        val name = if (action == SolverService.ACTION_QUREO) "QUREO" else "SPRIX"
        appendLog(name + " task queued" + if (dryRun) " (preview only)." else ".")
        SolverService.start(this, action, target, subject, course, single, dryRun)
    }

    private fun subscribeToProgress() {
        lifecycleScope.launch {
            ProgressBus.messages.collect { message -> appendLog(message) }
        }
        lifecycleScope.launch {
            ProgressBus.running.collect { refreshSessionStatus() }
        }
    }

    private fun refreshSessionStatus() {
        if (!::statusView.isInitialized) return
        val q = runCatching { QureoClient(applicationContext).hasSession() }.getOrDefault(false)
        val s = runCatching { SprixClient(applicationContext).hasSession() }.getOrDefault(false)
        val running = ProgressBus.running.value
        statusView.text = "QUREO: " + (if (q) "signed in" else "signed out") +
            "    ·    SPRIX: " + (if (s) "signed in" else "signed out") +
            "    ·    " + (if (running) "solver running" else "idle")
    }

    private fun appendLog(message: String) {
        if (!::logView.isInitialized) return
        runOnUiThread {
            val current = logView.text.toString()
            val next = (if (current == "No run started.") "" else current + "\n") + message
            logView.text = next.takeLast(24_000)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 5102)
        }
    }

    override fun onDestroy() {
        LessonPageBridge.detach(webView)
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}
