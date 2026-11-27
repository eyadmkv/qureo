package com.eyadmkv.qureo

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SprixArchiveTest {
    @Test
    fun extractsEnglishAndArabicArchiveRowsWithTheSameSchema() {
        val archive = JSONObject(
            """
            {
              "lessons": [
                {
                  "questions": [
                    {
                      "question": "  What is cash?  ",
                      "answer": { "text": " Cash " }
                    },
                    {
                      "question": "What is credit?",
                      "answer": { "text": "Borrowed money" }
                    }
                  ]
                }
              ]
            }
            """.trimIndent()
        )

        assertEquals(
            listOf("What is cash?" to "Cash", "What is credit?" to "Borrowed money"),
            extractSprixArchiveAnswers(archive)
        )
    }

    @Test
    fun ignoresIncompleteArchiveRows() {
        val archive = JSONObject(
            """
            {
              "lessons": [
                {
                  "questions": [
                    { "question": "Missing answer", "answer": { "text": "" } },
                    { "question": "", "answer": { "text": "Answer without question" } },
                    { "question": "Valid", "answer": { "text": "Answer" } }
                  ]
                }
              ]
            }
            """.trimIndent()
        )

        assertEquals(listOf("Valid" to "Answer"), extractSprixArchiveAnswers(archive))
    }
}
