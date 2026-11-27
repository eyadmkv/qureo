package com.eyadmkv.qureo

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.util.concurrent.TimeUnit

private const val QUREO_PORTAL = "https://me-portal.qureo.education"
private const val QUREO_COURSE = "https://me-tp.qureo.education"
private const val QUREO_API = "$QUREO_COURSE/api/study"
private const val COMMUNITY_ANSWERS_URL =
    "https://raw.githubusercontent.com/kky84rgkjy-maker/mohammad/9e73d17e0667c6eb8f358ceda53c2abec2e9a7db/qureo_answers.json"
private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

data class HttpResult(val status: Int, val body: String) {
    val successful: Boolean get() = status in 200..299
}

class ApiFailure(
    val status: Int,
    val payload: JSONObject?,
    message: String
) : Exception(message) {
    val precondition: Boolean get() = payload?.optBoolean("not_fulfill_preconditions") == true
}

private fun JSONObject.firstObject(vararg keys: String): JSONObject? {
    for (key in keys) optJSONObject(key)?.let { return it }
    return null
}

internal fun JSONObject.firstString(vararg keys: String): String {
    for (key in keys) {
        val value = opt(key)
        if (value != null && value != JSONObject.NULL && value !is JSONObject && value !is JSONArray) {
            val text = value.toString().trim()
            if (text.isNotEmpty()) return text
        }
    }
    return ""
}

internal fun jsonObject(text: String): JSONObject {
    val value = JSONTokener(text).nextValue()
    return value as? JSONObject ?: throw IllegalStateException("The service returned a non-object JSON response.")
}

private fun jsonObjectOrArray(text: String): JSONObject {
    val value = JSONTokener(text).nextValue()
    return when (value) {
        is JSONObject -> value
        is JSONArray -> JSONObject().put("data", value)
        else -> throw IllegalStateException("The service returned an unsupported JSON response.")
    }
}

private fun jsonArrayAt(root: JSONObject, vararg keys: String): JSONArray {
    root.optJSONArray("data")?.let { return it }
    val data = root.optJSONObject("data")
    if (data != null) {
        for (key in keys) data.optJSONArray(key)?.let { return it }
        data.optJSONArray("data")?.let { return it }
    }
    for (key in keys) root.optJSONArray(key)?.let { return it }
    root.optJSONObject("section")?.optJSONArray("chapters")?.let { return it }
    return JSONArray()
}

internal fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }

private fun JSONObject.chapterId(): String =
    firstString("chapter_id", "id")

data class LocalAnswer(
    val type: String,
    val choiceId: Long? = null,
    val code: String? = null,
    val source: String = "local"
) {
    fun toJson(): JSONObject = JSONObject()
        .put("type", type)
        .put("choice_id", choiceId ?: JSONObject.NULL)
        .put("answer_code", code ?: JSONObject.NULL)
        .put("source", source)
}

class QureoClient(context: Context) {
    private val appContext = context.applicationContext
    private val encryptedStore = EncryptedStore(appContext)
    val cookieJar = PersistentCookieJar(context, encryptedStore, "qureo.cookies")
    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()

    private fun request(
        url: String,
        method: String = "GET",
        body: JSONObject? = null,
        referer: String? = null
    ): HttpResult {
        var currentUrl = url
        var currentMethod = method.uppercase()
        var currentBody = body
        var currentReferer = referer

        for (hop in 0..5) {
            val parsed = currentUrl.toHttpUrl()
            require(parsed.isHttps && parsed.host in setOf("me-portal.qureo.education", "me-tp.qureo.education")) {
                "Blocked request outside the known QUREO HTTPS hosts."
            }

            val builder = Request.Builder()
                .url(parsed)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36")
                .header("Accept", "application/json, text/plain, */*")
                .header("Origin", if (parsed.host == "me-portal.qureo.education") QUREO_PORTAL else QUREO_COURSE)
                .header("Referer", currentReferer ?: if (parsed.host == "me-portal.qureo.education") "$QUREO_PORTAL/login" else "$QUREO_COURSE/")
            val requestBody = currentBody?.toString()?.toRequestBody(JSON_MEDIA)
            when (currentMethod) {
                "GET" -> builder.get()
                "POST" -> builder.post(requestBody ?: "{}".toRequestBody(JSON_MEDIA))
                "PUT" -> builder.put(requestBody ?: "{}".toRequestBody(JSON_MEDIA))
                else -> error("Unsupported QUREO HTTP method: $currentMethod")
            }

            val responseData = client.newCall(builder.build()).execute().use { response ->
                HttpResult(response.code, if (response.code in listOf(301, 302, 303, 307, 308)) {
                    response.header("Location").orEmpty()
                } else {
                    response.body?.string().orEmpty()
                })
            }
            if (responseData.status !in listOf(301, 302, 303, 307, 308)) return responseData
            if (responseData.body.isBlank()) throw IllegalStateException("QUREO returned a redirect without a destination.")
            if (hop == 5) throw IllegalStateException("QUREO redirected too many times.")

            val next = parsed.resolve(responseData.body)
                ?: throw IllegalStateException("QUREO returned an invalid redirect destination.")
            require(next.isHttps && next.host in setOf("me-portal.qureo.education", "me-tp.qureo.education")) {
                "Blocked redirect outside the known QUREO HTTPS hosts."
            }
            if (responseData.status == 303 ||
                ((responseData.status == 301 || responseData.status == 302) && currentMethod == "POST")) {
                currentMethod = "GET"
                currentBody = null
            }
            currentReferer = currentUrl
            currentUrl = next.toString()
        }
        throw IllegalStateException("QUREO redirect handling failed.")
    }

    private fun requestJson(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        referer: String? = null
    ): JSONObject {
        val response = request("$QUREO_API$path", method, body, referer)
        val payload = response.body.takeIf { it.isNotBlank() }?.let {
            runCatching { jsonObjectOrArray(it) }.getOrNull()
        }
        if (!response.successful) {
            val detail = when {
                payload?.optBoolean("not_fulfill_preconditions") == true -> "QUREO has not unlocked this action yet."
                response.status == 401 -> "QUREO session expired. Sign in again."
                response.status == 403 -> "QUREO denied this action."
                else -> "QUREO request failed with HTTP ${response.status}."
            }
            throw ApiFailure(response.status, payload, detail + " $path")
        }
        return payload ?: JSONObject()
    }

    suspend fun login(studentId: String, password: String): String = withContext(Dispatchers.IO) {
        require(studentId.isNotBlank() && password.isNotBlank()) { "Student ID and password are required." }
        cookieJar.clear()
        val login = request(
            "$QUREO_PORTAL/oauth2/password-login",
            "POST",
            JSONObject().put("student_id", studentId.trim()).put("password", password),
            "$QUREO_PORTAL/login"
        )
        if (login.status !in listOf(200, 201, 202, 204, 302, 303)) {
            throw ApiFailure(login.status, null, "QUREO login failed with HTTP ${login.status}. Check the credentials.")
        }

        val user = request("$QUREO_PORTAL/oauth2/userinfo")
        if (!user.successful) throw ApiFailure(user.status, null, "QUREO login could not be verified.")
        if (!user.body.trimStart().startsWith("{")) {
            throw IllegalStateException("QUREO login verification did not return JSON. Complete any required account step and sign in again.")
        }
        val portalUser = runCatching { jsonObject(user.body) }.getOrNull()
        runCatching {
            request("$QUREO_COURSE/?content_id=javascript_ar", referer = "$QUREO_PORTAL/")
        }
        encryptedStore.put("qureo.student", studentId.trim())
        portalUser?.firstString("name", "student_name", "email").orEmpty().ifBlank { "Signed in" }
    }

    fun hasSession(): Boolean = cookieJar.hasCookies()

    fun logout() {
        cookieJar.clear()
        encryptedStore.remove("qureo.student")
        File(appContext.filesDir, "qureo-verified-answers.json").delete()
    }

    fun cookieHeaderForCourse(): String =
        cookieJar.cookieHeader("$QUREO_COURSE/chapter/".toHttpUrl())

    suspend fun getUser(): JSONObject = withContext(Dispatchers.IO) {
        val response = request("$QUREO_PORTAL/oauth2/userinfo")
        if (!response.successful) throw ApiFailure(response.status, null, "QUREO session is invalid. Sign in again.")
        jsonObject(response.body)
    }

    suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) { requestJson(path) }

    suspend fun put(path: String, body: JSONObject = JSONObject(), referer: String? = null): JSONObject =
        withContext(Dispatchers.IO) { requestJson(path, "PUT", body, referer) }

    suspend fun rawPut(path: String, referer: String): HttpResult = withContext(Dispatchers.IO) {
        request("$QUREO_API$path", "PUT", JSONObject(), referer)
    }

    suspend fun courseData(courseId: String): JSONObject = withContext(Dispatchers.IO) {
        request("$QUREO_COURSE/?content_id=${java.net.URLEncoder.encode(courseId, "UTF-8")}")
        requestJson("/courses/$courseId")
    }
}


class QureoAnswerBank(private val context: Context) {
    private val verifiedFile = File(context.filesDir, "qureo-verified-answers.json")
    private val importedDirectory = File(context.filesDir, "answer-banks")

    fun load(courseId: String): MutableMap<String, LocalAnswer> {
        require(courseId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid QUREO course ID." }
        val result = linkedMapOf<String, LocalAnswer>()
        val asset = runCatching {
            context.assets.open("$courseId.json").bufferedReader().use { it.readText() }
        }.getOrNull()
        asset?.let { raw ->
            runCatching { JSONObject(raw).optJSONObject("answers") }.getOrNull()
                ?.let { addFlatAnswers(result, it, "course") }
        }

        val importedFile = File(importedDirectory, "$courseId.json")
        if (importedFile.exists()) {
            runCatching { JSONObject(importedFile.readText()).optJSONObject("answers") }.getOrNull()
                ?.let { addFlatAnswers(result, it, "imported") }
        }

        if (verifiedFile.exists()) {
            runCatching { JSONObject(verifiedFile.readText()) }.getOrNull()
                ?.let { addFlatAnswers(result, it, "qureo-result") }
        }
        return result
    }

    fun importBank(courseId: String, content: String): Int {
        require(courseId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid QUREO course ID." }
        val root = jsonObject(content)
        val declaredCourse = root.optString("course_id")
        require(declaredCourse.isBlank() || declaredCourse == courseId) {
            "The selected answer file belongs to course $declaredCourse, not $courseId."
        }
        val source = root.optJSONObject("answers")
            ?: throw IllegalArgumentException("The answer file must contain an answers object.")
        val normalized = JSONObject()
        var imported = 0
        for (questionId in source.keys()) {
            val row = source.optJSONObject(questionId) ?: continue
            val type = row.optString("type")
            when (type) {
                "choice" -> {
                    val choiceId = row.opt("choice_id")?.toString()?.toLongOrNull() ?: continue
                    if (choiceId <= 0) continue
                    normalized.put(questionId, JSONObject().put("type", "choice").put("choice_id", choiceId))
                }
                "description" -> {
                    val code = row.optString("answer_code")
                    if (code.isBlank()) continue
                    normalized.put(questionId, JSONObject().put("type", "description").put("answer_code", code))
                }
                else -> continue
            }
            imported++
        }
        require(imported > 0) { "No valid choice or description answers were found in the file." }
        importedDirectory.mkdirs()
        val destination = File(importedDirectory, "$courseId.json")
        val temporary = File(importedDirectory, "$courseId.json.tmp")
        temporary.writeText(JSONObject().put("course_id", courseId).put("answers", normalized).toString(2))
        if (!temporary.renameTo(destination)) {
            destination.writeText(temporary.readText())
            temporary.delete()
        }
        return imported
    }

    fun mergeCommunity(target: MutableMap<String, LocalAnswer>, archive: JSONObject) {
        for (chapterKey in archive.keys()) {
            val chapter = archive.optJSONObject(chapterKey) ?: continue
            for (questionId in chapter.keys()) {
                if (target.containsKey(questionId)) continue
                val row = chapter.optJSONArray(questionId) ?: continue
                if (row.length() != 2) continue
                val type = row.optString(0)
                val value = row.opt(1)
                val answer = when (type) {
                    "choice" -> LocalAnswer(type, choiceId = value?.toString()?.toLongOrNull(), source = "community")
                    "description" -> LocalAnswer(type, code = value?.toString(), source = "community")
                    else -> null
                }
                if (answer != null) target[questionId] = answer
            }
        }
    }

    fun saveVerified(answers: Map<String, LocalAnswer>) {
        val json = JSONObject()
        for ((id, answer) in answers) {
            if (answer.source == "qureo-result") json.put(id, answer.toJson())
        }
        val temporary = File(verifiedFile.parentFile, verifiedFile.name + ".tmp")
        temporary.writeText(json.toString(2))
        if (!temporary.renameTo(verifiedFile)) {
            verifiedFile.writeText(json.toString(2))
            temporary.delete()
        }
    }

    private fun addFlatAnswers(
        destination: MutableMap<String, LocalAnswer>,
        source: JSONObject,
        answerSource: String
    ) {
        for (questionId in source.keys()) {
            val row = source.optJSONObject(questionId) ?: continue
            val type = row.optString("type")
            val answer = when (type) {
                "choice" -> LocalAnswer(
                    type,
                    choiceId = row.opt("choice_id")?.toString()?.toLongOrNull(),
                    source = answerSource
                )
                "description" -> LocalAnswer(
                    type,
                    code = row.optString("answer_code").takeIf { it.isNotBlank() },
                    source = answerSource
                )
                else -> null
            }
            if (answer != null && (answer.choiceId != null || answer.code != null)) destination[questionId] = answer
        }
    }

    companion object {
        suspend fun downloadCommunity(): JSONObject = withContext(Dispatchers.IO) {
            val client = OkHttpClient.Builder()
                .followRedirects(true)
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(40, TimeUnit.SECONDS)
                .build()
            val request = Request.Builder().url(COMMUNITY_ANSWERS_URL).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Community answer archive download failed with HTTP ${response.code}.")
                val parsed = jsonObject(response.body?.string().orEmpty())
                var total = 0
                for (chapterId in parsed.keys()) total += parsed.optJSONObject(chapterId)?.length() ?: 0
                require(total >= 100) { "Downloaded community archive looks incomplete ($total answers)." }
                parsed
            }
        }
    }
}

class QureoSolver(
    private val context: Context,
    private val api: QureoClient,
    private val onProgress: (String) -> Unit
) {
    private val bank = QureoAnswerBank(context)

    suspend fun solveCourse(
        courseId: String = "python_short_ar",
        chapterTarget: String? = null,
        single: Boolean = false,
        dryRun: Boolean = false
    ) {
        require(courseId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid QUREO course ID." }
        val answers = bank.load(courseId)
        if (courseId == "python_short_ar") {
            try {
                val community = QureoAnswerBank.downloadCommunity()
                bank.mergeCommunity(answers, community)
                onProgress("Loaded community fallback answers.")
            } catch (error: Exception) {
                onProgress("Community archive unavailable: ${error.message}")
            }
        }

        val course = api.courseData(courseId)
        val sectionId = course.firstObject("basic_section")?.firstString("id")
            ?: course.firstObject("course")?.firstObject("basic_section")?.firstString("id")
            ?: throw IllegalStateException("QUREO course $courseId response did not include a section ID.")
        val section = api.get("/sections/$sectionId")
        val chapters = jsonArrayAt(section, "chapters").objects()
            .sortedBy { it.optDouble("seq", it.optDouble("sequence", 0.0)) }
        require(chapters.isNotEmpty()) { "No Python chapters were found." }

        val progress = api.get("/students/sections/$sectionId/chapters")
        val progressRows = jsonArrayAt(progress, "chapters").objects()
        val completed = progressRows.associate { row ->
            row.chapterId() to (
                row.optBoolean("completed") ||
                    row.optBoolean("is_completed") ||
                    row.optString("completed_at").isNotBlank()
                )
        }

        val target = chapterTarget?.trim().orEmpty()
        val targetIndex = if (target.isBlank()) -1 else chapters.indexOfFirst {
            it.firstString("id") == target ||
                it.optInt("seq", it.optInt("sequence", -1)).toString() == target
        }
        if (target.isNotBlank() && targetIndex < 0) throw IllegalArgumentException("Chapter '$target' was not found.")

        val startIndex = if (targetIndex >= 0) targetIndex else chapters.indexOfFirst { !completed[it.firstString("id")].orFalse() }
        if (startIndex < 0) {
            onProgress("All Python chapters are already complete.")
            return
        }
        val endIndex = when {
            targetIndex >= 0 -> targetIndex
            single -> startIndex
            else -> chapters.lastIndex
        }

        for (index in startIndex..endIndex) {
            val chapter = chapters[index]
            val chapterId = chapter.firstString("id")
            val sequence = chapter.optInt("seq", chapter.optInt("sequence", index + 1))
            val title = chapter.firstString("name", "title").ifBlank { "Chapter $sequence" }
            if (completed[chapterId] == true) {
                onProgress("Skipping completed chapter $sequence: $title")
                continue
            }
            solveChapter(chapter, chapterId, sectionId, sequence, title, answers, dryRun)
        }
        onProgress(if (dryRun) "Dry run complete." else "QUREO solve run complete.")
    }

    private suspend fun solveChapter(
        chapter: JSONObject,
        chapterId: String,
        sectionId: String,
        sequence: Int,
        title: String,
        answers: MutableMap<String, LocalAnswer>,
        dryRun: Boolean
    ) {
        onProgress("\nChapter $sequence: $title")
        val meta = api.get("/chapters/$chapterId")
        val testType = chapter.optString("test_type")
            .ifBlank { meta.optString("test_type").ifBlank { meta.optJSONObject("chapter")?.optString("test_type", "review") ?: "review" } }
        val lectures = meta.optJSONArray("lectures")
            ?: meta.optJSONObject("chapter")?.optJSONArray("lectures")
            ?: meta.optJSONObject("data")?.optJSONArray("lectures")
            ?: JSONArray()
        var questions: JSONArray? = null
        var lessonsDone = false

        try {
            questions = api.get("/chapters/$chapterId/test").let { jsonArrayAt(it, "questions") }
        } catch (error: ApiFailure) {
            if (!error.precondition) throw error
            val expected = meta.optJSONObject("chapter")?.optInt("question_count", meta.optInt("question_count", 0))
                ?: meta.optInt("question_count", 0)
            val covered = answers.keys.count { it.startsWith(chapterId) }
            if (dryRun) {
                throw IllegalStateException(
                    "Chapter $sequence is still locked. Dry-run will not complete lessons or change course progress."
                )
            }
            if (expected > 0 && covered < expected) {
                throw IllegalStateException(
                    "Chapter $sequence is locked and the installed answer sources cover $covered/$expected question IDs. Nothing was changed."
                )
            }
            if (lectures.length() == 0) throw IllegalStateException("The locked chapter did not return its lesson list.")
            completeLessons(chapterId, lectures)
            lessonsDone = true
            questions = api.get("/chapters/$chapterId/test").let { jsonArrayAt(it, "questions") }
        }

        if (!lessonsDone && !dryRun) completeLessons(chapterId, lectures)
        val rows = questions?.objects().orEmpty()
        require(rows.isNotEmpty()) { "Chapter $sequence returned no assessment questions." }

        var prepared = prepareAnswers(rows, answers)
        if (prepared.second.isNotEmpty()) {
            throw IllegalStateException(
                "No verified answer for ${prepared.second.joinToString()}. No assessment answers were submitted."
            )
        }
        if (dryRun) {
            prepared.first.forEach { row ->
                onProgress("Preview question ${row.first}: ${row.second.type}")
            }
            return
        }

        val endpointKind = if (testType == "review") "review-questions" else "test-questions"
        val resultType = if (testType == "test") "test" else "review"
        var totalSubmitted = 0
        var latestScore = 0

        repeat(3) { attemptIndex ->
            val attempt = attemptIndex + 1
            val initReferer = "$QUREO_COURSE/chapter/$chapterId/$resultType"
            api.put("/students/chapters/$chapterId/test", referer = initReferer)
            var correct = 0
            val rejected = mutableListOf<String>()

            for ((questionId, answer) in prepared.first) {
                val body = if (answer.type == "choice") {
                    JSONObject().put("choice_id", answer.choiceId)
                } else {
                    JSONObject().put("answer_code", answer.code)
                }
                val response = api.put(
                    "/students/$endpointKind/$questionId/answer/${answer.type}",
                    body,
                    initReferer
                )
                val isCorrect = response.optJSONObject("result")?.optBoolean("correct")
                if (isCorrect == true) correct++ else if (isCorrect == false) rejected.add(questionId)
                totalSubmitted++
                onProgress("Attempt $attempt: submitted ${prepared.first.indexOfFirst { it.first == questionId } + 1}/${prepared.first.size} | $questionId" +
                    when (isCorrect) { true -> " | correct"; false -> " | incorrect"; else -> "" })
            }

            val result = api.get("/students/chapters/$chapterId/$resultType/result")
            val data = result.optJSONObject("result") ?: result
            latestScore = data.optInt("correct_count", correct)
            val recovered = extractOfficialAnswers(data)
            var changed = 0
            for ((questionId, recoveredAnswer) in recovered) {
                val old = answers[questionId]
                val different = old?.type != recoveredAnswer.type ||
                    (recoveredAnswer.type == "choice" && old?.choiceId != recoveredAnswer.choiceId) ||
                    (recoveredAnswer.type == "description" && old?.code != recoveredAnswer.code)
                answers[questionId] = recoveredAnswer
                if (different) changed++
            }
            bank.saveVerified(answers)
            onProgress("QUREO result: $latestScore/${rows.size}; recovered ${recovered.size} official answer(s).")

            if (correct == rows.size || latestScore == rows.size) {
                verifyChapterComplete(sectionId = sectionId, chapterId = chapterId, expectedQuestions = rows.size)
                return
            }
            if (attempt == 3 || changed == 0) {
                throw IllegalStateException(
                    "QUREO returned $latestScore/${rows.size}. No new official answer was recovered for the rejected questions ${rejected.joinToString()}."
                )
            }
            prepared = prepareAnswers(rows, answers)
            if (prepared.second.isNotEmpty()) {
                throw IllegalStateException("QUREO's result did not provide a usable model answer for ${prepared.second.joinToString()}.")
            }
            onProgress("Retrying the same chapter with $changed recovered answer(s).")
        }
    }

    private fun prepareAnswers(
        questions: List<JSONObject>,
        answers: Map<String, LocalAnswer>
    ): Pair<List<Pair<String, LocalAnswer>>, List<String>> {
        val prepared = mutableListOf<Pair<String, LocalAnswer>>()
        val missing = mutableListOf<String>()
        for (item in questions) {
            val question = item.optJSONObject("question") ?: item
            val id = question.firstString("id")
            val answer = answers[id]
            if (answer == null || id.isBlank()) {
                missing.add(id.ifBlank { "unknown" })
                continue
            }
            val options = sequenceOf(
                item.optJSONArray("choices"), item.optJSONArray("options"),
                question.optJSONArray("choices"), question.optJSONArray("options")
            ).filterNotNull().firstOrNull { it.length() > 0 } ?: JSONArray()
            when (answer.type) {
                "choice" -> {
                    val type = question.optString("type").lowercase()
                    if (options.length() > 0) {
                        val exists = options.objects().any { it.opt("id")?.toString() == answer.choiceId.toString() }
                        if (exists) prepared.add(id to answer) else missing.add(id)
                    } else if (type.contains("choice") || type.contains("select") || type.contains("radio") || type == "mcq") {
                        prepared.add(id to answer)
                    } else {
                        missing.add(id)
                    }
                }
                "description" -> {
                    val type = question.optString("type").lowercase()
                    if (answer.code.isNullOrBlank() || options.length() > 0 ||
                        type.contains("choice") || type.contains("select") || type.contains("radio")) {
                        missing.add(id)
                    } else {
                        prepared.add(id to answer)
                    }
                }
                else -> missing.add(id)
            }
        }
        return prepared to missing
    }

    private suspend fun completeLessons(chapterId: String, lectures: JSONArray) {
        for (lesson in lectures.objects()) {
            val lessonId = lesson.firstString("id", "lecture_id")
            if (lessonId.isBlank()) continue
            val referer = "$QUREO_COURSE/chapter/$chapterId/lecture/$lessonId"
            val direct = runCatching {
                api.rawPut("/students/lectures/$lessonId/complete", referer)
            }.getOrNull()
            when {
                direct?.successful == true -> onProgress("Lesson $lessonId completed.")
                direct?.status == 400 || direct?.status == 409 -> onProgress("Lesson $lessonId already completed.")
                direct?.status == 404 || direct == null -> {
                    val result = LessonPageBridge.complete(
                        chapterId,
                        lessonId,
                        api.cookieHeaderForCourse()
                    )
                    if (result.optBoolean("ok") || result.optInt("status") in listOf(400, 409)) {
                        onProgress("Lesson $lessonId completed through the QUREO lesson page.")
                    } else {
                        throw IllegalStateException("QUREO could not complete lesson $lessonId (HTTP ${result.optInt("status")}).")
                    }
                }
                else -> throw IllegalStateException("QUREO lesson $lessonId completion failed (HTTP ${direct.status}).")
            }
        }
    }

    private suspend fun verifyChapterComplete(sectionId: String, chapterId: String, expectedQuestions: Int) {
        repeat(6) { attempt ->
            val progress = api.get("/students/sections/$sectionId/chapters")
            val rows = jsonArrayAt(progress, "chapters").objects()
            val current = rows.firstOrNull { it.chapterId() == chapterId }
            if (current?.optBoolean("completed") == true || current?.optBoolean("is_completed") == true ||
                current?.optString("completed_at").orEmpty().isNotBlank()) {
                onProgress("QUREO confirmed chapter $chapterId as complete.")
                return
            }
            if (attempt < 5) kotlinx.coroutines.delay(500)
        }
        throw IllegalStateException(
            "QUREO accepted $expectedQuestions/$expectedQuestions answers for chapter $chapterId, but its progress endpoint did not confirm completion. Stopping before the next chapter."
        )
    }

    private fun extractOfficialAnswers(result: JSONObject): Map<String, LocalAnswer> {
        val recovered = linkedMapOf<String, LocalAnswer>()
        val choices = result.optJSONArray("choice_results") ?: JSONArray()
        for (index in 0 until choices.length()) {
            val row = choices.optJSONObject(index) ?: continue
            val options = row.optJSONArray("choices") ?: JSONArray()
            val correct = options.objects().firstOrNull { it.optBoolean("correct") }
            val choice = correct?.optJSONObject("choice")
            val id = choice?.opt("id") ?: correct?.opt("id") ?: if (row.optBoolean("correct")) row.opt("choice_id") else null
            val questionId = row.firstString("question_id")
            val choiceId = id?.toString()?.toLongOrNull()
            if (questionId.isNotBlank() && choiceId != null) {
                recovered[questionId] = LocalAnswer("choice", choiceId = choiceId, source = "qureo-result")
            }
        }

        val descriptions = result.optJSONArray("description_results") ?: JSONArray()
        for (index in 0 until descriptions.length()) {
            val row = descriptions.optJSONObject(index) ?: continue
            val questionId = row.firstString("question_id")
            val model = row.optString("model_answer").ifBlank {
                if (row.optBoolean("correct")) row.optString("answer_code") else ""
            }
            if (questionId.isNotBlank() && model.isNotBlank()) {
                recovered[questionId] = LocalAnswer("description", code = model, source = "qureo-result")
            }
        }
        return recovered
    }
}

private fun Boolean?.orFalse(): Boolean = this ?: false
