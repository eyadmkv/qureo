package com.eyadmkv.qureo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class QureoAnswerScopeTest {
    @Test
    fun supportedCoursesHaveDistinctQuestionPrefixes() {
        assertEquals("511", communityCoursePrefix("python_short_ar"))
        assertEquals("900", communityCoursePrefix("javascript_ar"))
    }

    @Test
    fun pythonCommunityArchiveIncludesItsQuestionGroupsOnly() {
        assertTrue(isCommunityChapterForCourse("python_short_ar", "511021"))
        assertTrue(isCommunityQuestionForCourse("python_short_ar", "511021", "511021030"))
        assertFalse(isCommunityChapterForCourse("python_short_ar", "90021"))
        assertFalse(isCommunityChapterForCourse("python_short_ar", "531001"))
        assertFalse(isCommunityChapterForCourse("python_short_ar", "30001"))
        assertFalse(isCommunityQuestionForCourse("python_short_ar", "511021", "511022030"))
    }

    @Test
    fun javascriptCommunityArchiveIncludesItsQuestionGroupsOnly() {
        assertTrue(isCommunityChapterForCourse("javascript_ar", "90021"))
        assertTrue(isCommunityQuestionForCourse("javascript_ar", "90021", "90021020"))
        assertFalse(isCommunityChapterForCourse("javascript_ar", "511021"))
        assertFalse(isCommunityChapterForCourse("javascript_ar", "531001"))
        assertFalse(isCommunityChapterForCourse("javascript_ar", "30001"))
        assertFalse(isCommunityQuestionForCourse("javascript_ar", "90021", "90022020"))
    }

    @Test
    fun unrelatedOrMalformedQuestionIdsAreRejected() {
        assertFalse(isCourseQuestionId("python_short_ar", "531001010"))
        assertFalse(isCourseQuestionId("javascript_ar", "30001010"))
        assertFalse(isCourseQuestionId("python_short_ar", "51102x030"))
        assertFalse(isCourseQuestionId("javascript_ar", "900"))
    }
    @Test
    fun liveChoiceOptionsDetermineQuestionKindWhenTypeIsMissing() {
        assertEquals("choice", inferQureoQuestionKind("", true, "description"))
    }

    @Test
    fun missingQuestionTypeUsesStoredAnswerOrDescriptionFallback() {
        assertEquals("choice", inferQureoQuestionKind("", false, "choice"))
        assertEquals("description", inferQureoQuestionKind("", false, null))
    }

    @Test
    fun explicitQuestionTypeTakesPrecedenceWhenOptionsAreAbsent() {
        assertEquals("description", inferQureoQuestionKind("program", false, "choice"))
        assertEquals("choice", inferQureoQuestionKind("multiple_choice", false, "description"))
        assertEquals(null, inferQureoQuestionKind("unsupported", false, null))
    }

    @Test
    fun completedChapterCanBeDetectedFromBestCorrectCount() {
        val chapter = JSONObject().put("question_count", 5)
        assertTrue(isQureoChapterComplete(chapter, JSONObject().put("best_correct_count", 5)))
        assertFalse(isQureoChapterComplete(chapter, JSONObject().put("best_correct_count", 4)))
    }

    @Test
    fun explicitCompletionDoesNotRequireQuestionCount() {
        assertTrue(isQureoChapterComplete(JSONObject(), JSONObject().put("completed", true)))
        assertTrue(isQureoChapterComplete(JSONObject(), JSONObject().put("completed_at", "2026-11-27T10:00:00Z")))
    }

}
