import Database from 'better-sqlite3';
import { DB_PATH } from './paths.js';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    course_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chapters (
    chapter_id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    qureo_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS lessons (
    lesson_id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    qureo_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS exercises (
    exercise_id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
    qureo_id TEXT,
    ordinal INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    normalized_prompt TEXT NOT NULL DEFAULT '',
    exercise_type TEXT NOT NULL DEFAULT 'unknown',
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_exercises_prompt ON exercises(normalized_prompt);
  CREATE INDEX IF NOT EXISTS idx_exercises_lesson ON exercises(lesson_id);
  CREATE TABLE IF NOT EXISTS solutions (
    solution_id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id TEXT NOT NULL REFERENCES exercises(exercise_id) ON DELETE CASCADE,
    answer_type TEXT NOT NULL DEFAULT 'text',
    answer_text TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_solutions_exercise ON solutions(exercise_id, active, verified);
  CREATE TABLE IF NOT EXISTS attempts (
    attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id TEXT NOT NULL REFERENCES exercises(exercise_id) ON DELETE CASCADE,
    solution_id INTEGER REFERENCES solutions(solution_id) ON DELETE SET NULL,
    executed INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS api_courses (
    course_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    section_id TEXT NOT NULL DEFAULT '',
    course_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS api_chapters (
    chapter_id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    sequence_number INTEGER,
    title TEXT NOT NULL DEFAULT '',
    test_type TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    diamonds INTEGER,
    chapter_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_api_chapters_course ON api_chapters(course_id, sequence_number);
  CREATE TABLE IF NOT EXISTS api_questions (
    question_id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'unknown',
    prompt TEXT NOT NULL DEFAULT '',
    question_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_api_questions_chapter ON api_questions(chapter_id);
  CREATE TABLE IF NOT EXISTS public_pages (
    url TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS saved_answers (
    answer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_key TEXT NOT NULL DEFAULT '',
    question_text TEXT NOT NULL DEFAULT '',
    answer_type TEXT NOT NULL DEFAULT 'text',
    answer_text TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_saved_answers_key ON saved_answers(question_key);
`);

export function normalizeText(value = '') {
  return String(value)
    .toLocaleLowerCase('ar')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function saveExercise(record) {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO courses(course_id, title) VALUES(?, ?)
      ON CONFLICT(course_id) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE courses.title END`)
      .run(record.courseId, record.courseTitle || record.courseId);
    db.prepare(`INSERT INTO chapters(chapter_id, course_id, qureo_id, title, url) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(chapter_id) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE chapters.title END, url = excluded.url`)
      .run(record.chapterId, record.courseId, record.chapterQureoId || null, record.chapterTitle || '', record.chapterUrl || '');
    db.prepare(`INSERT INTO lessons(lesson_id, chapter_id, qureo_id, title, url) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(lesson_id) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE lessons.title END, url = excluded.url`)
      .run(record.lessonId, record.chapterId, record.lessonQureoId || null, record.lessonTitle || '', record.url);
    if (record.normalizedPrompt) {
      db.prepare(`DELETE FROM exercises WHERE lesson_id = ? AND normalized_prompt = '' AND exercise_id <> ?
        AND NOT EXISTS (SELECT 1 FROM solutions WHERE solutions.exercise_id = exercises.exercise_id)`)
        .run(record.lessonId, record.exerciseId);
    }
    db.prepare(`INSERT INTO exercises(
      exercise_id, lesson_id, qureo_id, ordinal, title, prompt, normalized_prompt, exercise_type, snapshot_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(exercise_id) DO UPDATE SET title = excluded.title, prompt = excluded.prompt,
      normalized_prompt = excluded.normalized_prompt, exercise_type = excluded.exercise_type,
      snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`)
      .run(record.exerciseId, record.lessonId, record.exerciseQureoId || null, record.ordinal || 1,
        record.title || '', record.prompt || '', record.normalizedPrompt || '', record.exerciseType || 'unknown',
        JSON.stringify(record.snapshot || {}), now);
  });
  tx();
  return db.prepare('SELECT * FROM exercises WHERE exercise_id = ?').get(record.exerciseId);
}

export function findSolution(exercise) {
  return db.prepare(`SELECT s.* FROM solutions s JOIN exercises e ON e.exercise_id = s.exercise_id
    WHERE s.active = 1 AND (e.exercise_id = ? OR (e.normalized_prompt = ? AND e.normalized_prompt <> ''))
    ORDER BY (e.exercise_id = ?) DESC, s.verified DESC, s.created_at DESC LIMIT 1`)
    .get(exercise.exerciseId, exercise.normalizedPrompt, exercise.exerciseId);
}

export function addSolution(exerciseId, answerText, answerType = 'code', explanation = '') {
  const result = db.prepare(`INSERT INTO solutions(exercise_id, answer_type, answer_text, explanation)
    VALUES(?, ?, ?, ?)`).run(exerciseId, answerType, answerText, explanation);
  return db.prepare('SELECT * FROM solutions WHERE solution_id = ?').get(result.lastInsertRowid);
}

export function recordAttempt(exerciseId, solutionId, executed, accepted, message = '') {
  return db.prepare(`INSERT INTO attempts(exercise_id, solution_id, executed, accepted, message)
    VALUES(?, ?, ?, ?, ?)`).run(exerciseId, solutionId ?? null, executed ? 1 : 0,
      accepted === null ? null : accepted ? 1 : 0, message).lastInsertRowid;
}

export function markSolutionVerified(solutionId) {
  db.prepare('UPDATE solutions SET verified = 1 WHERE solution_id = ?').run(solutionId);
}

export function listExercises(limit = 30) {
  return db.prepare(`SELECT e.exercise_id, e.title, e.exercise_type, e.prompt, l.title AS lesson_title, l.url,
      (SELECT COUNT(*) FROM solutions s WHERE s.exercise_id = e.exercise_id AND s.active = 1) AS solutions_count
    FROM exercises e JOIN lessons l ON l.lesson_id = e.lesson_id ORDER BY e.updated_at DESC LIMIT ?`).all(limit);
}

export function listSolutions(limit = 30) {
  return db.prepare(`SELECT s.solution_id, s.answer_type, s.verified, s.created_at, e.title, e.exercise_id,
      substr(s.answer_text, 1, 120) AS answer_preview FROM solutions s JOIN exercises e ON e.exercise_id = s.exercise_id
    WHERE s.active = 1 ORDER BY s.created_at DESC LIMIT ?`).all(limit);
}

export function saveApiCourse(courseId, title, sectionId, raw) {
  db.prepare(`INSERT INTO api_courses(course_id,title,section_id,course_json,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(course_id) DO UPDATE SET title=excluded.title,section_id=excluded.section_id,
    course_json=excluded.course_json,updated_at=excluded.updated_at`)
    .run(String(courseId), title || String(courseId), String(sectionId || ''), JSON.stringify(raw || {}), new Date().toISOString());
}

export function saveApiChapter(courseId, chapter, progress = null) {
  const id = chapter?.id;
  if (id === undefined || id === null) return;
  db.prepare(`INSERT INTO api_chapters(chapter_id,course_id,sequence_number,title,test_type,completed,diamonds,chapter_json,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET course_id=excluded.course_id,
    sequence_number=excluded.sequence_number,title=excluded.title,test_type=excluded.test_type,
    completed=excluded.completed,diamonds=excluded.diamonds,chapter_json=excluded.chapter_json,updated_at=excluded.updated_at`)
    .run(String(id), String(courseId), Number.isFinite(Number(chapter.seq)) ? Number(chapter.seq) : null,
      chapter.name || chapter.title || '', chapter.test_type || '', progress?.completed_at ? 1 : 0,
      progress?.diamond ?? null, JSON.stringify({ chapter, progress }), new Date().toISOString());
}

export function saveApiQuestion(chapterId, item) {
  const q = item?.question || item;
  const id = q?.id;
  if (id === undefined || id === null) return;
  const prompt = [q.text, q.title, q.content, q.description, q.body, q.question].find(x => typeof x === 'string') || '';
  db.prepare(`INSERT INTO api_questions(question_id,chapter_id,question_type,prompt,question_json,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(question_id) DO UPDATE SET chapter_id=excluded.chapter_id,
    question_type=excluded.question_type,prompt=excluded.prompt,question_json=excluded.question_json,updated_at=excluded.updated_at`)
    .run(String(id), String(chapterId), q.type || 'unknown', prompt, JSON.stringify(item), new Date().toISOString());
}

export function savePublicPage({ url, source, title, body }) {
  db.prepare(`INSERT INTO public_pages(url,source,title,body,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET source=excluded.source,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at`)
    .run(url, source || '', title || '', body || '', new Date().toISOString());
}

export function saveCustomAnswer({ questionKey = '', questionText = '', answerType = 'text', answerText, explanation = '', sourceUrl = '' }) {
  const result = db.prepare(`INSERT INTO saved_answers(question_key,question_text,answer_type,answer_text,explanation,source_url)
    VALUES(?,?,?,?,?,?)`).run(String(questionKey), questionText, answerType, answerText, explanation, sourceUrl);
  return db.prepare('SELECT * FROM saved_answers WHERE answer_id = ?').get(result.lastInsertRowid);
}


export function saveRetrievedAnswer({ questionKey = '', questionText = '', answerType = 'text', answerText, explanation = '', sourceUrl = '' }) {
  const key = String(questionKey);
  const text = String(answerText);
  const existing = db.prepare(`SELECT answer_id FROM saved_answers WHERE question_key=? AND answer_text=? AND source_url=? LIMIT 1`)
    .get(key, text, sourceUrl);
  if (existing) return null;
  const result = db.prepare(`INSERT INTO saved_answers(question_key,question_text,answer_type,answer_text,explanation,source_url,verified)
    VALUES(?,?,?,?,?,?,1)`).run(key, questionText, answerType, text, explanation, sourceUrl);
  return db.prepare('SELECT * FROM saved_answers WHERE answer_id = ?').get(result.lastInsertRowid);
}

export function findApiQuestion(questionId) {
  return db.prepare('SELECT * FROM api_questions WHERE question_id=?').get(String(questionId));
}

export function getCustomAnswer(answerId) {
  return db.prepare('SELECT * FROM saved_answers WHERE answer_id=?').get(Number(answerId));
}

export function listCustomAnswers(limit = 50) {
  return db.prepare(`SELECT answer_id,question_key,question_text,answer_type,substr(answer_text,1,150) AS answer_preview,
    explanation,source_url,verified,created_at FROM saved_answers ORDER BY created_at DESC LIMIT ?`).all(limit);
}

export function listApiCourses() {
  return db.prepare('SELECT course_id,title,section_id,updated_at FROM api_courses ORDER BY title').all();
}

export function listApiChapters(courseId = null) {
  if (courseId) return db.prepare(`SELECT * FROM api_chapters WHERE course_id=? ORDER BY sequence_number`).all(String(courseId));
  return db.prepare('SELECT * FROM api_chapters ORDER BY course_id,sequence_number').all();
}

export function getApiChapter(chapterId) {
  return db.prepare('SELECT * FROM api_chapters WHERE chapter_id=?').get(String(chapterId));
}

export function getApiQuestions(chapterId) {
  return db.prepare('SELECT * FROM api_questions WHERE chapter_id=? ORDER BY updated_at,question_id').all(String(chapterId));
}

export function searchKnowledge(query, limit = 8) {
  const q = normalizeText(query);
  const terms = q.split(' ').filter(Boolean);
  if (!terms.length) return { pages: [], questions: [], answers: [] };

  const pages = db.prepare('SELECT url,source,title,body FROM public_pages').all()
    .map(row => {
      const normalized = normalizeText(`${row.title}\n${row.body}`);
      const score = terms.reduce((n, term) => n + (normalized.includes(term) ? 1 : 0), 0);
      return { ...row, score };
    }).filter(row => row.score > 0)
    .sort((a,b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);

  const questions = db.prepare('SELECT question_id,chapter_id,question_type,prompt,question_json FROM api_questions').all()
    .map(row => ({ ...row, score: terms.reduce((n, term) => n + (normalizeText(row.prompt).includes(term) ? 1 : 0), 0) }))
    .filter(row => row.score > 0).sort((a,b) => b.score-a.score).slice(0, limit);

  const answers = db.prepare('SELECT * FROM saved_answers').all()
    .map(row => ({ ...row, score: terms.reduce((n, term) => n + (normalizeText(`${row.question_key || ''} ${row.question_text || ''} ${row.answer_text || ''} ${row.explanation || ''}`).includes(term) ? 1 : 0), 0) }))
    .filter(row => row.score > 0).sort((a,b) => b.score-a.score).slice(0, limit);

  return { pages, questions, answers };
}

export function getStats() {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    courses: count('courses'), chapters: count('chapters'), lessons: count('lessons'), exercises: count('exercises'),
    solutions: db.prepare('SELECT COUNT(*) AS n FROM solutions WHERE active=1').get().n,
    verified: db.prepare('SELECT COUNT(*) AS n FROM solutions WHERE active=1 AND verified=1').get().n,
    apiCourses: count('api_courses'), apiChapters: count('api_chapters'), apiQuestions: count('api_questions'),
    publicPages: count('public_pages'), customAnswers: count('saved_answers')
  };
}
