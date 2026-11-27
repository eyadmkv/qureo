package com.eyadmkv.qureo

import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

object LessonPageBridge {
    private val attached = AtomicReference<WebView?>(null)

    fun attach(webView: WebView) {
        attached.set(webView)
    }

    fun detach(webView: WebView) {
        attached.compareAndSet(webView, null)
    }

    suspend fun complete(chapterId: String, lessonId: String, cookieHeader: String): JSONObject =
        withTimeout(90_000) {
            val view = attached.get() ?: throw IllegalStateException(
                "Keep the QUREO app open while a lesson needs browser initialization."
            )
            withContext(Dispatchers.Main) {
                suspendCancellableCoroutine { continuation ->
                    val targetUrl = "https://me-tp.qureo.education/chapter/$chapterId/lecture/$lessonId"
                    val expectedPath = "/chapter/$chapterId/lecture/$lessonId"
                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    cookieHeader.split(';')
                        .map { it.trim() }
                        .filter { it.contains('=') }
                        .forEach { pair ->
                            cookieManager.setCookie(
                                "https://me-tp.qureo.education/",
                                "$pair; Path=/; Secure"
                            )
                        }
                    cookieManager.flush()

                    var completed = false
                    fun finish(result: JSONObject) {
                        if (completed) return
                        completed = true
                        if (continuation.isActive) continuation.resume(result)
                    }

                    continuation.invokeOnCancellation {
                        view.post {
                            if (!completed) completed = true
                            view.stopLoading()
                        }
                    }

                    view.webViewClient = object : WebViewClient() {
                        override fun onPageFinished(webView: WebView, url: String) {
                            if (completed) return
                            val parsed = runCatching { android.net.Uri.parse(url) }.getOrNull()
                            if (parsed?.host != "me-tp.qureo.education") return
                            if (parsed.path != expectedPath) {
                                if (parsed.path?.contains("/login") == true) {
                                    if (continuation.isActive) continuation.resumeWithException(
                                        IllegalStateException("QUREO redirected the lesson to login. Sign in again.")
                                    )
                                    completed = true
                                }
                                return
                            }

                            val script = """
                                (async () => {
                                  try {
                                    const response = await fetch('/api/study/students/lectures/$lessonId/complete', {
                                      method: 'PUT',
                                      credentials: 'include',
                                      headers: { Accept: '*/*', 'Content-Type': 'application/json' }
                                    });
                                    return JSON.stringify({
                                      status: response.status,
                                      ok: response.ok,
                                      body: (await response.text()).slice(0, 500)
                                    });
                                  } catch (error) {
                                    return JSON.stringify({ status: 0, ok: false, body: String(error) });
                                  }
                                })()
                            """.trimIndent()
                            webView.evaluateJavascript(script) { encoded ->
                                try {
                                    val decoded = JSONTokener(encoded ?: "null").nextValue()?.toString()
                                        ?: throw IllegalStateException("QUREO lesson returned no completion result.")
                                    finish(JSONObject(decoded))
                                } catch (error: Exception) {
                                    if (continuation.isActive) continuation.resumeWithException(error)
                                    completed = true
                                }
                            }
                        }
                    }
                    view.loadUrl(targetUrl)
                }
            }
        }
}
