package com.eyadmkv.qureo

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
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
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
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
    private lateinit var qureoPassword: EditText
    private lateinit var qureoChapter: EditText
    private lateinit var sprixId: EditText
    private lateinit var sprixPassword: EditText
    private lateinit var sprixSubject: EditText
    private lateinit var webView: WebView

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
            setPadding(18, 22, 18, 28)
            setBackgroundColor(ink)
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(page)
        }

        page.addView(label("QUREO + SPRIX", 27f, Color.WHITE, true))
        page.addView(label("Native Android course solver", 14f, pale, false))
        statusView = label("Checking local sessions...", 13f, accent, true)
        statusView.setPadding(0, 12, 0, 18)
        page.addView(statusView)

        page.addView(sectionTitle("QUREO · Python"))
        qureoId = input("Student ID", InputType.TYPE_CLASS_TEXT)
        qureoPassword = input("Password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        qureoChapter = input("Chapter number or ID (optional)", InputType.TYPE_CLASS_TEXT)
        page.addView(qureoId)
        page.addView(qureoPassword)
        page.addView(button("Sign in to QUREO") { loginQureo() })
        page.addView(button("Sign out of QUREO", true) {
            QureoClient(applicationContext).logout()
            refreshSessionStatus()
            appendLog("QUREO session removed.")
        })
        page.addView(qureoChapter)
        page.addView(button("Solve selected chapter") {
            val target = qureoChapter.text.toString().trim().ifBlank { null }
            startSolver(SolverService.ACTION_QUREO, target = target, single = true)
        })
        page.addView(button("Solve all remaining Python chapters") {
            startSolver(SolverService.ACTION_QUREO)
        })
        page.addView(button("Preview remaining Python chapters", true) {
            startSolver(SolverService.ACTION_QUREO, dryRun = true)
        })

        page.addView(sectionTitle("SPRIX · Financial Literacy"))
        sprixId = input("SPRIX Login ID", InputType.TYPE_CLASS_TEXT)
        sprixPassword = input("Password", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        sprixSubject = input("Subject ID (7 Arabic · 3 English)", InputType.TYPE_CLASS_NUMBER).apply { setText("7") }
        page.addView(sprixId)
        page.addView(sprixPassword)
        page.addView(sprixSubject)
        page.addView(button("Sign in to SPRIX") { loginSprix() })
        page.addView(button("Sign out of SPRIX", true) {
            SprixClient(applicationContext).logout()
            refreshSessionStatus()
            appendLog("SPRIX session removed.")
        })
        page.addView(button("Solve all remaining SPRIX items") {
            startSolver(SolverService.ACTION_SPRIX, subject = currentSubject())
        })
        page.addView(button("Solve next SPRIX chapter only") {
            startSolver(SolverService.ACTION_SPRIX, subject = currentSubject(), single = true)
        })
        page.addView(button("Preview remaining SPRIX items", true) {
            startSolver(SolverService.ACTION_SPRIX, subject = currentSubject(), dryRun = true)
        })

        page.addView(sectionTitle("Run log"))
        logView = TextView(this).apply {
            text = "No run started."
            textSize = 12f
            setTextColor(pale)
            setPadding(14, 14, 14, 14)
            setBackgroundColor(panel)
            typeface = android.graphics.Typeface.MONOSPACE
            minHeight = 160
            textIsSelectable = true
        }
        page.addView(logView)

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

    private fun sectionTitle(value: String): TextView =
        label(value, 19f, Color.WHITE, true).apply { setPadding(0, 24, 0, 10) }

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
            textSize = 15f
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.LTGRAY)
            setPadding(14, 8, 14, 8)
            backgroundTintList = android.content.res.ColorStateList.valueOf(accent)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 7 }
        }

    private fun button(text: String, subtle: Boolean = false, action: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            isAllCaps = false
            textSize = 14f
            setTextColor(if (subtle) pale else Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(if (subtle) panel else accent)
            setOnClickListener { action() }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 5 }
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

    private fun startSolver(
        action: String,
        target: String? = null,
        subject: String? = null,
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
        SolverService.start(this, action, target, subject, single, dryRun)
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
