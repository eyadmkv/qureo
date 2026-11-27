package com.eyadmkv.qureo

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

private const val SPRIX_ORIGIN = "https://egy.app.spx-learning-square.com"
private const val SPRIX_ARCHIVE_ROOT =
    "https://raw.githubusercontent.com/kky84rgkjy-maker/mohammad/9e73d17e0667c6eb8f358ceda53c2abec2e9a7db/"
private val SPRIX_JSON = "application/json; charset=utf-8".toMediaType()

data class SprixCourseItem(
    val id: String,
    val type: String,
    val sequence: Int,
    val title: String,
    val unitTitle: String,
    val completed: Boolean,
    val unlocked: Boolean
)

class SprixClient(context: Context) {
    private val secureStore = EncryptedStore(context)
    private val cookies = PersistentCookieJar(context, secureStore, "sprix.cookies")
    private val client = OkHttpClient.Builder()
        .cookieJar(cookies)
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()

    private fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val url = if (path.startsWith("https://")) path else "$SPRIX_ORIGIN/api/v1/${path.removePrefix("/")}"
        val parsed = url.toHttpUrl()
        require(parsed.isHttps &&
            (parsed.host == "spx-learning-square.com" || parsed.host.endsWith(".spx-learning-square.com")) &&
            parsed.encodedPath.startsWith("/api/v1/")) {
            "Blocked SPRIX request outside HTTPS *.spx-learning-square.com /api/v1/."
        }

        val builder = Request.Builder()
            .url(parsed)
            .header("Accept", "application/json, text/plain, */*")
            .header("Origin", SPRIX_ORIGIN)
            .header("Referer", "$SPRIX_ORIGIN/dashboard")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36")
        when (method.uppercase(Locale.ROOT)) {
            "GET" -> builder.get()
            "POST" -> builder.post((body ?: JSONObject()).toString().toRequestBody(SPRIX_JSON))
            "PUT" -> builder.put((body ?: JSONObject()).toString().toRequestBody(SPRIX_JSON))
            else -> error("Unsupported SPRIX HTTP method: $method")
        }

        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val payload = text.takeIf { it.isNotBlank() }?.let {
                runCatching { jsonObject(it) }.getOrNull()
            }
            if (response.code in listOf(301, 302, 303, 307, 308)) {
                throw ApiFailure(response.code, payload, "SPRIX redirected the request. The saved session may have expired.")
            }
            if (!response.isSuccessful) {
                val message = when (response.code) {
                    401 -> "SPRIX session expired. Sign in again."
                    403 -> "SPRIX denied this request (HTTP 403)."
                    else -> "SPRIX request failed with HTTP ${response.code}."
                }
                throw ApiFailure(response.code, payload, message)
            }
            val result = payload ?: throw IllegalStateException("SPRIX returned non-JSON data for ${parsed.encodedPath}.")
            if (result.optBoolean("success") == false) {
                throw ApiFailure(response.code, result, result.optString("message").ifBlank { "SPRIX rejected the request." })
            }
            return result
        }
    }

    suspend fun login(loginId: String, password: String, subjectId: String = "7"): String = withContext(Dispatchers.IO) {
        require(loginId.isNotBlank() && password.isNotBlank()) { "SPRIX Login ID and password are required." }
        cookies.clear()
        val payload = request(
            "auth/login",
            "POST",
            JSONObject().put("login_id", loginId.trim()).put("password", password)
        )
        if (payload.optBoolean("success") == false) throw IllegalStateException("SPRIX rejected the login.")
        val resolved = resolveSubjectId(subjectId)
        val curriculum = curriculum(resolved)
        secureStore.put("sprix.subject", resolved)
        secureStore.put("sprix.login", loginId.trim())
        "Signed in, subject $resolved (${curriculum.length()} curriculum units)"
    }

    fun hasSession(): Boolean = cookies.hasCookies()

    fun logout() {
        cookies.clear()
        secureStore.remove("sprix.subject")
        secureStore.remove("sprix.login")
    }

    suspend fun resolveSubjectId(requested: String? = null): String = withContext(Dispatchers.IO) {
        val value = requested?.trim().orEmpty()
        if (value.isNotBlank() && value != "auto") {
            require(value.toLongOrNull() != null && value.toLong() > 0) { "SPRIX subject ID must be a positive number." }
            return@withContext value
        }
        val saved = secureStore.get("sprix.subject")
        if (!saved.isNullOrBlank()) return@withContext saved

        val subjects = request("subjects").optJSONArray("data") ?: JSONArray()
        val active = subjects.objects().filter {
            it.optString("status") == "active" &&
                it.optString("kind") != "game" &&
                it.optInt("total_items") > 0
        }
        val financial = active.filter {
            it.optString("subject_type") == "financial_literacy" ||
                it.optString("course_code") == "financial_literacy"
        }
        val candidates = financial.ifEmpty { active }
        if (candidates.size != 1) {
            throw IllegalStateException(
                if (candidates.isEmpty()) "No active SPRIX subject with learning items was found."
                else "Multiple SPRIX subjects are available. Enter the subject ID explicitly."
            )
        }
        candidates.first().firstString("id")
    }

    suspend fun curriculum(subjectId: String? = null): JSONArray = withContext(Dispatchers.IO) {
        val id = resolveSubjectId(subjectId)
        request("subjects/$id/curriculum").optJSONArray("data")
            ?: throw IllegalStateException("SPRIX curriculum response did not contain a data array.")
    }

    suspend fun chapterBlocks(chapterId: String): JSONObject = withContext(Dispatchers.IO) {
        request("chapters/$chapterId/blocks").optJSONObject("data")
            ?: throw IllegalStateException("SPRIX chapter response did not contain data.")
    }

    suspend fun answerChapter(chapterId: String, blockId: String, optionId: String): JSONObject =
        withContext(Dispatchers.IO) {
            request(
                "chapters/$chapterId/answer",
                "POST",
                JSONObject()
                    .put("block_id", blockId.toLong())
                    .put("selected_option_id", optionId.toLong())
                    .put("hint_used", 0)
            )
        }

    suspend fun completeChapter(chapterId: String): JSONObject =
        withContext(Dispatchers.IO) { request("chapters/$chapterId/complete", "POST") }

    suspend fun completeReview(reviewId: String): JSONObject =
        withContext(Dispatchers.IO) { request("reviews/$reviewId/complete", "POST") }

    suspend fun startTest(testId: String): JSONObject =
        withContext(Dispatchers.IO) { request("tests/$testId/start", "POST") }

    suspend fun answerTest(testId: String, questionId: String, optionId: String): JSONObject =
        withContext(Dispatchers.IO) {
            request(
                "tests/$testId/questions/$questionId/answer",
                "PUT",
                JSONObject().put("selected_option_id", optionId.toLong())
            )
        }

    suspend fun submitTest(testId: String): JSONObject =
        withContext(Dispatchers.IO) { request("tests/$testId/submit", "POST") }
}

private data class SprixBank(
    val subjectId: Int,
    val blockAnswers: JSONObject,
    val testAnswers: JSONObject,
    val archive: List<Pair<String, String>>
)

class SprixSolver(
    private val context: Context,
    private val api: SprixClient,
    private val onProgress: (String) -> Unit
) {
    private val rawClient = OkHttpClient.Builder()
        .followRedirects(true)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    suspend fun solve(subjectInput: String = "7", single: Boolean = false, dryRun: Boolean = false) {
        val subjectId = api.resolveSubjectId(subjectInput).toInt()
        val bank = loadBank(subjectId)
        var units = api.curriculum(subjectId.toString())
        val items = flattenCurriculum(units)
        if (items.isEmpty()) throw IllegalStateException("No SPRIX chapters, reviews or tests were found.")
        val firstPending = items.indexOfFirst { !it.completed }
        if (firstPending < 0) {
            onProgress("All SPRIX course items are already complete.")
            return
        }
        val end = if (single) {
            val chapterIndex = items.indexOfFirst { it.sequence >= items[firstPending].sequence && it.type == "chapter" && !it.completed }
            if (chapterIndex >= 0) chapterIndex else firstPending
        } else items.lastIndex

        val selection = items.subList(firstPending, end + 1).filterNot { it.completed }
        onProgress("SPRIX subject $subjectId: selected ${selection.size} remaining course item(s).")
        if (dryRun) onProgress("Dry run: no answers or completion requests will be sent.")

        for (item in selection) {
            onProgress("\n${item.type.replaceFirstChar { it.uppercase() }} ${item.sequence}: ${item.title}")
            when (item.type) {
                "review" -> {
                    if (dryRun) onProgress("Would complete review ${item.id}.")
                    else {
                        api.completeReview(item.id)
                        units = confirmItem(subjectId.toString(), item, units)
                        onProgress("SPRIX confirmed review ${item.id} as complete.")
                    }
                }
                "test" -> {
                    if (dryRun) {
                        onProgress("Would start test ${item.id}, apply mapped answers and submit for grading.")
                        break
                    }
                    if (!item.unlocked) throw IllegalStateException("Test ${item.id} is locked. No test attempt was started.")
                    val started = api.startTest(item.id)
                    val data = started.optJSONObject("data") ?: started
                    val plan = buildTestPlan(data, bank)
                    if (plan.second.isNotEmpty() || plan.first.isEmpty()) {
                        throw IllegalStateException("Test ${item.id} has unmatched questions: ${plan.second.joinToString()}. No test answers were submitted.")
                    }
                    for ((questionId, optionId) in plan.first) {
                        val saved = api.answerTest(item.id, questionId, optionId)
                        if (saved.optJSONObject("data")?.optBoolean("saved") == false) {
                            throw IllegalStateException("SPRIX did not save test question $questionId.")
                        }
                        onProgress("Saved test answer for question $questionId.")
                    }
                    val submitted = api.submitTest(item.id)
                    val dataResult = submitted.optJSONObject("data")
                    val graded = dataResult?.optJSONObject("response")
                        ?: dataResult?.optJSONObject("result")?.optJSONObject("response")
                        ?: dataResult
                    if (graded?.optBoolean("passed") != true) {
                        throw IllegalStateException(
                            "SPRIX test ${item.id} did not pass" +
                                (graded?.opt("total_score")?.toString()?.let { " (score $it%)" } ?: "") +
                                ". Stopped before the next course item."
                        )
                    }
                    units = confirmItem(subjectId.toString(), item, units)
                    onProgress("SPRIX confirmed test ${item.id} passed.")
                }
                "chapter" -> {
                    if (!item.unlocked) onProgress("Curriculum marks this chapter locked; checking the live chapter endpoint.")
                    val data = api.chapterBlocks(item.id)
                    val plan = buildChapterPlan(data, bank)
                    onProgress("Pending questions: ${plan.first.size + plan.second.size}; mapped: ${plan.first.size}.")
                    if (plan.second.isNotEmpty()) {
                        throw IllegalStateException("Chapter ${item.id} has unmatched blocks: ${plan.second.joinToString()}. No chapter answers were submitted.")
                    }
                    if (dryRun) {
                        for ((blockId, optionId) in plan.first) onProgress("Would submit block $blockId -> option $optionId.")
                    } else {
                        for ((blockId, optionId) in plan.first) {
                            val response = api.answerChapter(item.id, blockId, optionId)
                            val result = response.optJSONObject("data")
                            if (result?.optBoolean("is_correct") != true) {
                                throw IllegalStateException("SPRIX did not confirm block $blockId as correct. Stopping this chapter.")
                            }
                            onProgress("Accepted block $blockId.")
                        }
                        val completed = api.completeChapter(item.id)
                        val score = completed.optJSONObject("data")?.opt("star_score")
                        if (score != null) onProgress("Star score: $score")
                        units = confirmItem(subjectId.toString(), item, units)
                        onProgress("SPRIX confirmed chapter ${item.id} as complete.")
                    }
                }
            }
        }
        onProgress(if (dryRun) "SPRIX preview complete." else "SPRIX solve run complete.")
    }

    private suspend fun loadBank(subjectId: Int): SprixBank {
        val mapName = if (subjectId == 7) "spx_api_bank.json" else "spx_api_bank_subject3.json"
        val mapUrl = SPRIX_ARCHIVE_ROOT + mapName
        val map = downloadJson(mapUrl)
        val blocks = map.optJSONObject("block") ?: throw IllegalStateException("SPRIX block map is missing.")
        val tests = map.optJSONObject("test") ?: throw IllegalStateException("SPRIX test map is missing.")
        if (blocks.length() < 200 || tests.length() < 100) {
            throw IllegalStateException("SPRIX answer map looks incomplete (${blocks.length()} blocks, ${tests.length()} test answers).")
        }
        val archive = if (subjectId == 7) {
            val archiveJson = downloadJson(SPRIX_ARCHIVE_ROOT + "answers_archive.json")
            val lessons = archiveJson.optJSONArray("lessons") ?: JSONArray()
            buildList {
                for (lesson in lessons.objects()) {
                    val questions = lesson.optJSONArray("questions") ?: JSONArray()
                    for (row in questions.objects()) {
                        val question = row.optString("question").trim()
                        val answer = row.optJSONObject("answer")?.optString("text").orEmpty().trim()
                        if (question.isNotBlank() && answer.isNotBlank()) add(question to answer)
                    }
                }
            }
        } else emptyList()
        onProgress("Loaded SPRIX answer maps: ${blocks.length()} block IDs, ${tests.length()} test IDs.")
        return SprixBank(subjectId, blocks, tests, archive)
    }

    private suspend fun downloadJson(url: String): JSONObject = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).get().build()
        rawClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("Could not download answer data (HTTP ${response.code}): $url")
            jsonObject(response.body?.string().orEmpty())
        }
    }

    private fun flattenCurriculum(units: JSONArray): List<SprixCourseItem> {
        val result = mutableListOf<SprixCourseItem>()
        for (unit in units.objects()) {
            val sections = unit.optJSONArray("sections")
                ?: JSONArray().apply {
                    put(JSONObject().put("items", unit.optJSONArray("items") ?: JSONArray()))
                }
            for (section in sections.objects()) {
                val learningItems = section.optJSONArray("items") ?: JSONArray()
                for (item in learningItems.objects()) {
                    val type = item.optString("item_type").lowercase()
                    if (type !in setOf("chapter", "review", "test")) continue
                    val id = item.firstString("id")
                    if (id.isBlank()) throw IllegalStateException("A SPRIX $type item has no ID.")
                    result.add(
                        SprixCourseItem(
                            id = id,
                            type = type,
                            sequence = result.size + 1,
                            title = item.firstString("title", "name").ifBlank { "Untitled $type" },
                            unitTitle = unit.firstString("title", "name"),
                            completed = item.optBoolean("is_completed"),
                            unlocked = unit.optBoolean("is_accessible", true) &&
                                item.optBoolean("is_accessible", true) &&
                                item.optBoolean("is_unlocked", true)
                        )
                    )
                }
            }
        }
        return result
    }

    private suspend fun confirmItem(subjectId: String, item: SprixCourseItem, original: JSONArray): JSONArray {
        repeat(4) { attempt ->
            val refreshed = api.curriculum(subjectId)
            val current = flattenCurriculum(refreshed).firstOrNull { it.type == item.type && it.id == item.id }
                ?: throw IllegalStateException("SPRIX item ${item.id} disappeared after completion.")
            if (current.completed) return refreshed
            if (attempt < 3) delay(350)
        }
        return original
    }

    private fun buildChapterPlan(data: JSONObject, bank: SprixBank): Pair<List<Pair<String, String>>, List<String>> {
        val chapter = data.optJSONObject("chapter") ?: JSONObject()
        val cleared = chapter.optJSONArray("cleared_block_ids") ?: JSONArray()
        val clearedIds = (0 until cleared.length()).map { cleared.opt(it).toString() }.toSet()
        val blocks = data.optJSONArray("blocks")?.objects().orEmpty()
        val plan = mutableListOf<Pair<String, String>>()
        val unmatched = mutableListOf<String>()
        for (block in blocks) {
            val isQuestion = block.optString("type") == "question" ||
                (block.optJSONObject("question") != null && block.optJSONArray("options") != null)
            if (!isQuestion || block.opt("id")?.toString() in clearedIds) continue
            val blockId = block.opt("id")?.toString().orEmpty()
            val options = block.optJSONArray("options")?.objects().orEmpty()
            if (blockId.isBlank() || options.isEmpty()) {
                unmatched.add(blockId.ifBlank { "unknown" })
                continue
            }
            val mapped = bank.blockAnswers.opt(blockId)?.toString()
            var selected = mapped?.let { optionId -> options.firstOrNull { it.opt("id")?.toString() == optionId } }
            if (mapped != null && selected == null) {
                unmatched.add(blockId + " (mapped option missing from live options)")
                continue
            }
            if (selected == null) {
                val prompt = blockPrompt(block)
                val archiveAnswer = bestArchiveAnswer(prompt, bank.archive)
                selected = archiveAnswer?.let { answer ->
                    bestOption(answer, options)
                }
            }
            if (selected == null) unmatched.add(blockId) else {
                plan.add(blockId to selected.opt("id").toString())
            }
        }
        return plan to unmatched
    }

    private fun buildTestPlan(data: JSONObject, bank: SprixBank): Pair<List<Pair<String, String>>, List<String>> {
        val questions = data.optJSONArray("test_questions")?.objects().orEmpty().sortedBy {
            it.optInt("sort_order")
        }
        if (questions.isEmpty()) return emptyList<Pair<String, String>>() to listOf("no test questions")
        val optionsByQuestion = data.optJSONObject("options") ?: JSONObject()
        val result = mutableListOf<Pair<String, String>>()
        val unmatched = mutableListOf<String>()
        for (row in questions) {
            val testQuestionId = row.firstString("id")
            val sourceQuestionId = row.firstString("question_id")
            val options = optionsByQuestion.optJSONArray(sourceQuestionId)?.objects().orEmpty()
            val mappedId = bank.testAnswers.opt(testQuestionId)?.toString()
            val selected = mappedId?.let { id -> options.firstOrNull { it.opt("id")?.toString() == id } }
                ?: if (mappedId == null && bank.archive.isNotEmpty()) {
                    val question = data.optJSONObject("questions")?.optJSONObject(sourceQuestionId)
                    bestArchiveAnswer(blockPrompt(question ?: JSONObject()), bank.archive)?.let { answer ->
                        bestOption(answer, options)
                    }
                } else null

            if (mappedId != null && selected == null) unmatched.add("$testQuestionId (mapped option missing)")
            else if (selected == null) unmatched.add(testQuestionId.ifBlank { "unknown" })
            else if (selected.optBoolean("is_correct") == false) unmatched.add("$testQuestionId (source marks option incorrect)")
            else result.add(testQuestionId to selected.opt("id").toString())
        }
        return result to unmatched
    }

    private fun blockPrompt(block: JSONObject): String {
        val question = block.optJSONObject("question") ?: block
        return question.firstString(
            "question_text", "text", "title", "content", "description", "prompt", "question"
        ).ifBlank { block.firstString("text", "description", "content") }
    }

    private fun normalizeText(value: String): String =
        value.lowercase(Locale("ar"))
            .replace(Regex("[\\u064B-\\u065F\\u0670\\u0640]"), "")
            .replace(Regex("[أإآ]"), "ا")
            .replace("ى", "ي")
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
            .trim()
            .replace(Regex("\\s+"), " ")

    private fun similarity(left: String, right: String): Double {
        val a = normalizeText(left).split(' ').filter { it.length > 2 }.toSet()
        val b = normalizeText(right).split(' ').filter { it.length > 2 }.toSet()
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val common = a.intersect(b).size.toDouble()
        return 0.68 * common / minOf(a.size, b.size) + 0.32 * common / maxOf(a.size, b.size)
    }

    private fun bestArchiveAnswer(prompt: String, archive: List<Pair<String, String>>): String? {
        val ranked = archive.map { it to similarity(prompt, it.first) }.sortedByDescending { it.second }
        val best = ranked.firstOrNull() ?: return null
        val second = ranked.getOrNull(1)
        if (best.second < 0.28 || normalizeText(prompt).split(' ').filter { it.length > 2 }.size < 3) return null
        if (second != null && best.second - second.second < 0.035) return null
        return best.first.second
    }

    private fun bestOption(answer: String, options: List<JSONObject>): JSONObject? {
        val ranked = options.map { option ->
            val text = option.firstString("text", "title", "content", "label", "name", "value")
            option to similarity(answer, text)
        }.sortedByDescending { it.second }
        val best = ranked.firstOrNull() ?: return null
        if (best.second < 0.24 || (ranked.getOrNull(1)?.let { best.second - it.second < 0.025 } == true)) return null
        return best.first
    }
}
