import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';

export const COMMUNITY_ANSWER_ARCHIVE_URL =
  'https://raw.githubusercontent.com/kky84rgkjy-maker/mohammad/9e73d17e0667c6eb8f358ceda53c2abec2e9a7db/qureo_answers.json';
export const COMMUNITY_ANSWER_ARCHIVE_PATH = path.join(DATA_DIR, 'community-qureo-answers.json');

export function parseCommunityAnswerArchive(value, { minimumAnswers = 100 } = {}) {
  const archive = typeof value === 'string' ? JSON.parse(value) : value;
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
    throw new Error('Community answer archive must be a JSON object grouped by chapter ID.');
  }

  const answers = {};
  let chapterCount = 0;
  let choiceCount = 0;
  let descriptionCount = 0;

  for (const [chapterId, questions] of Object.entries(archive)) {
    if (!/^\d{5,6}$/.test(chapterId) || !questions || typeof questions !== 'object' || Array.isArray(questions)) {
      throw new Error(`Invalid chapter group in community answer archive: ${chapterId}`);
    }
    chapterCount++;

    for (const [questionId, entry] of Object.entries(questions)) {
      if (!/^\d{7,10}$/.test(questionId) || !Array.isArray(entry) || entry.length !== 2) {
        throw new Error(`Invalid answer record for question ${questionId}.`);
      }

      const [type, answer] = entry;
      let normalized;
      if (type === 'choice') {
        const choiceId = Number(answer);
        if (!Number.isSafeInteger(choiceId) || choiceId <= 0) {
          throw new Error(`Invalid choice ID for question ${questionId}.`);
        }
        normalized = { type: 'choice', choice_id: choiceId };
        choiceCount++;
      } else if (type === 'description') {
        if (typeof answer !== 'string' || !answer.trim()) {
          throw new Error(`Invalid code answer for question ${questionId}.`);
        }
        normalized = { type: 'description', answer_code: answer };
        descriptionCount++;
      } else {
        throw new Error(`Unsupported answer type for question ${questionId}: ${type}`);
      }

      if (answers[questionId] && JSON.stringify(answers[questionId]) !== JSON.stringify(normalized)) {
        throw new Error(`Conflicting duplicate answer for question ${questionId}.`);
      }
      answers[questionId] = normalized;
    }
  }

  if (chapterCount < 1 || Object.keys(answers).length < minimumAnswers) {
    throw new Error('Community answer archive is unexpectedly small or empty; refusing to install it.');
  }

  return {
    answers,
    chapterCount,
    answerCount: Object.keys(answers).length,
    choiceCount,
    descriptionCount
  };
}

export async function syncCommunityAnswers({
  fetchImpl = fetch,
  outputPath = COMMUNITY_ANSWER_ARCHIVE_PATH
} = {}) {
  const response = await fetchImpl(COMMUNITY_ANSWER_ARCHIVE_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`Community answer archive download failed: HTTP ${response.status}.`);
  }

  const content = await response.text();
  const parsed = parseCommunityAnswerArchive(content);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = outputPath + '.tmp';
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, outputPath);

  return {
    ...parsed,
    answers: undefined,
    outputPath,
    sourceUrl: COMMUNITY_ANSWER_ARCHIVE_URL
  };
}

export function loadCommunityAnswers(filePath = COMMUNITY_ANSWER_ARCHIVE_PATH) {
  if (!fs.existsSync(filePath)) return {};
  return parseCommunityAnswerArchive(fs.readFileSync(filePath, 'utf8')).answers;
}
