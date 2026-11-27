package com.eyadmkv.qureo

import android.net.Uri
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume

object LessonPageBridge {
    private const val COURSE_HOST = "me-tp.qureo.education"
    private const val COURSE_ORIGIN = "https://$COURSE_HOST"
    private const val TIMEOUT_MS = 90_000L
    private val attached = AtomicReference<WebView?>(null)

    class CompletionResultBridge(
        private val webView: WebView,
        private val callback: (String) -> Unit
    ) {
        @JavascriptInterface
        fun onResult(payload: String) {
            webView.post { callback(payload) }
        }
    }

    fun attach(webView: WebView) {
        attached.set(webView)
    }

    fun detach(webView: WebView) {
        attached.compareAndSet(webView, null)
    }

    suspend fun complete(
        chapterId: String,
        lessonId: String,
        cookies: List<String>
    ): JSONObject {
        require(chapterId.matches(Regex("\\d{5,10}"))) { "Invalid QUREO chapter ID." }
        require(lessonId.matches(Regex("\\d{5,12}"))) { "Invalid QUREO lesson ID." }

        return try {
            withTimeout(TIMEOUT_MS) {
                val view = attached.get() ?: throw IllegalStateException(
                    "The QUREO lesson WebView is unavailable. Return to the app and retry."
                )
                withContext(Dispatchers.Main) {
                    suspendCancellableCoroutine { continuation ->
                        val cookieManager = CookieManager.getInstance()
                        cookieManager.setAcceptCookie(true)

                        val targetUrl = "$COURSE_ORIGIN/chapter/$chapterId/lecture/$lessonId"
                        val expectedPath = "/chapter/$chapterId/lecture/$lessonId"
                        val settled = AtomicBoolean(false)
                        val remainingCookies = AtomicInteger(cookies.size)
                        val rejectedCookies = AtomicInteger(0)
                        val navigationStarted = AtomicBoolean(false)
                        val completionStarted = AtomicBoolean(false)

                        fun finish(result: JSONObject) {
                            if (!settled.compareAndSet(false, true)) return
                            view.removeJavascriptInterface("QureoNative")
                            if (continuation.isActive) continuation.resume(result)
                        }

                        fun fail(message: String, status: Int = 0) {
                            finish(
                                JSONObject()
                                    .put("ok", false)
                                    .put("status", status)
                                    .put("error", message)
                            )
                        }

                        fun loadLessonPage() {
                            if (settled.get() || !navigationStarted.compareAndSet(false, true)) return
                            try {
                                cookieManager.flush()
                                view.addJavascriptInterface(
                                    CompletionResultBridge(view) { payload ->
                                        try {
                                            finish(JSONObject(payload))
                                        } catch (error: Exception) {
                                            fail(
                                                "Could not decode the QUREO lesson completion response: " +
                                                    (error.message ?: error.javaClass.simpleName)
                                            )
                                        }
                                    },
                                    "QureoNative"
                                )
                                view.webViewClient = object : WebViewClient() {
                                    override fun onReceivedError(
                                        webView: WebView,
                                        request: WebResourceRequest,
                                        error: WebResourceError
                                    ) {
                                        if (!request.isForMainFrame) return
                                        fail(
                                            "Lesson page navigation failed " +
                                                "(${error.errorCode}): ${error.description}"
                                        )
                                    }

                                    override fun onReceivedHttpError(
                                        webView: WebView,
                                        request: WebResourceRequest,
                                        response: WebResourceResponse
                                    ) {
                                        if (!request.isForMainFrame || response.statusCode < 400) return
                                        fail(
                                            "QUREO lesson page returned HTTP ${response.statusCode} " +
                                                response.reasonPhrase.orEmpty(),
                                            response.statusCode
                                        )
                                    }

                                    override fun onReceivedSslError(
                                        webView: WebView,
                                        handler: SslErrorHandler,
                                        error: SslError
                                    ) {
                                        handler.cancel()
                                        fail("TLS error while loading the QUREO lesson page (code ${error.primaryError}).")
                                    }

                                    override fun onPageFinished(webView: WebView, url: String) {
                                        if (settled.get()) return
                                        val parsed = runCatching { Uri.parse(url) }.getOrNull() ?: return
                                        if (parsed.scheme != "https") return

                                        if (parsed.host != COURSE_HOST) {
                                            if (parsed.host == "me-portal.qureo.education" ||
                                                parsed.path.orEmpty().contains("login", ignoreCase = true)) {
                                                fail("QUREO redirected the lesson page to sign-in. Sign in again.")
                                            }
                                            return
                                        }

                                        if (parsed.path != expectedPath) {
                                            fail("QUREO redirected the lesson page to an unexpected URL: $url")
                                            return
                                        }

                                        if (!completionStarted.compareAndSet(false, true)) return
                                        val script = """
                                            (async () => {
                                              let result;
                                              try {
                                                const response = await fetch('/api/study/students/lectures/$lessonId/complete', {
                                                  method: 'PUT',
                                                  credentials: 'include',
                                                  cache: 'no-store',
                                                  headers: {
                                                    Accept: 'application/json, text/plain, */*',
                                                    'Content-Type': 'application/json'
                                                  },
                                                  body: '{}'
                                                });
                                                const body = await response.text();
                                                result = {
                                                  status: response.status,
                                                  ok: response.ok,
                                                  body: body.slice(0, 1000)
                                                };
                                              } catch (error) {
                                                const detail = error instanceof Error
                                                  ? error.name + ': ' + error.message
                                                  : String(error);
                                                result = {
                                                  status: 0,
                                                  ok: false,
                                                  error: detail
                                                };
                                              }
                                              QureoNative.onResult(JSON.stringify(result));
                                            })();
                                        """.trimIndent()

                                        try {
                                            webView.evaluateJavascript(script, null)
                                        } catch (error: Exception) {
                                            fail(
                                                "Could not start the QUREO lesson completion request: " +
                                                    (error.message ?: error.javaClass.simpleName)
                                            )
                                        }
                                    }
                                }
                                view.stopLoading()
                                view.loadUrl(targetUrl)
                            } catch (error: Exception) {
                                fail(
                                    "Could not open the QUREO lesson page: " +
                                        (error.message ?: error.javaClass.simpleName)
                                )
                            }
                        }

                        continuation.invokeOnCancellation {
                            view.post {
                                if (settled.compareAndSet(false, true)) {
                                    view.removeJavascriptInterface("QureoNative")
                                    view.stopLoading()
                                }
                            }
                        }

                        if (cookies.isEmpty()) {
                            fail("No QUREO session cookies are available for the lesson WebView. Sign in again.")
                        } else {
                            cookies.forEach { cookie ->
                                try {
                                    cookieManager.setCookie(COURSE_ORIGIN, cookie) { accepted ->
                                        if (accepted != true) rejectedCookies.incrementAndGet()
                                        if (remainingCookies.decrementAndGet() == 0 && !settled.get()) {
                                            if (rejectedCookies.get() > 0) {
                                                fail(
                                                    "Android rejected ${rejectedCookies.get()} QUREO session cookie(s). " +
                                                        "Sign in again and retry."
                                                )
                                            } else {
                                                loadLessonPage()
                                            }
                                        }
                                    }
                                } catch (error: Exception) {
                                    rejectedCookies.incrementAndGet()
                                    if (remainingCookies.decrementAndGet() == 0 && !settled.get()) {
                                        fail(
                                            "Could not install QUREO session cookies: " +
                                                (error.message ?: error.javaClass.simpleName)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (error: TimeoutCancellationException) {
            throw IllegalStateException(
                "Timed out waiting for QUREO to initialize the lesson page or finish its completion request after 90 seconds.",
                error
            )
        }
    }
}
