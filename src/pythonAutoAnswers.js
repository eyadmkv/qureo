function stripQureoMarkup(value) {
  return String(value ?? '')
    .replace(/\[\[(?:\/?(?:bdi|code|bold|italic|underline)|br)\]\]/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&quot;/giu, '"')
    .replace(/&amp;/giu, '&')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b-\u200d\ufeff]/gu, '')
    .normalize('NFKC')
    .trim();
}

const STOP_WORDS = new Set([
  'اختر', 'البرنامج', 'الصحيح', 'لطباعة', 'في', 'وحدة', 'التحكم',
  'اجعل', 'الكمبيوتر', 'يطبع', 'اطبع', 'النتيجة', 'نتيجة', 'حساب',
  'الحساب', 'ما', 'هو', 'هي', 'اكتب', 'كما', 'وردت', 'الاجابة',
  'السؤال', 'التالي', 'بشكل', 'صحيح', 'اعرض', 'نوع', 'البيانات',
  'جملة', 'داخل', 'بايثون', 'python', 'print', 'the', 'a', 'an',
  'is', 'to', 'of', 'in', 'what', 'which', 'correct', 'following'
]);

function tokens(value) {
  return stripQureoMarkup(value)
    .toLocaleLowerCase('ar')
    .replace(/[\u064b-\u065f\u0670\u0640]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/[٠-٩]/gu, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .split(/[^\p{L}\p{N}_]+/gu)
    .filter(token => token && !STOP_WORDS.has(token));
}

function similarity(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  const coverage = common / Math.min(a.size, b.size);
  const dice = (2 * common) / (a.size + b.size);
  return coverage * 0.65 + dice * 0.35;
}

function questionText(item) {
  const question = item?.question || item || {};
  return [
    question.content, question.text, question.title, question.prompt,
    question.question, question.description, question.question_text
  ].map(stripQureoMarkup).find(Boolean) || '';
}

function choiceText(choice) {
  return stripQureoMarkup(
    choice?.content ?? choice?.text ?? choice?.label ?? choice?.name ?? choice?.value ?? ''
  );
}

function compact(value) {
  return stripQureoMarkup(value)
    .replace(/^\s{0,3}#{1,6}\s*/gmu, '')
    .toLocaleLowerCase('ar')
    .replace(/[\u064b-\u065f\u0670\u0640\s]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي');
}

function extractCodeAnswer(answer) {
  const source = String(answer ?? '').replace(/\r/gu, '');
  const fenced = [...source.matchAll(/```(?:python)?\s*([\s\S]*?)```/giu)]
    .map(match => match[1].trim())
    .filter(Boolean);
  if (fenced.length) return fenced.join('\n');

  const lines = source.split('\n').map(line => line.trimEnd());
  const start = lines.findIndex(line => {
    const clean = line.trim();
    return /^(?:print|if|elif|else|for|while|def|return|import|from|class|pass|break|continue|raise|try|except|finally)\b/u.test(clean) ||
      /^#[^!]/u.test(clean) ||
      /^[A-Za-z_][\w]*\s*(?:=|\+=|-=|\*=|\/=)/u.test(clean);
  });
  if (start >= 0) {
    const code = [];
    for (const line of lines.slice(start)) {
      if (/^(?:نسخ|السؤال\s*\d+|Made with intention|إعلان)/u.test(line.trim())) break;
      code.push(line);
    }
    while (code.length && !code.at(-1).trim()) code.pop();
    if (code.length) return code.join('\n').trim();
  }

  const inline = source.match(/(?:print\(|type\(|str\(|int\(|float\(|round\(|max\(|min\(|random\.|math\.)[^\n]*/u);
  return inline?.[0]?.trim() || '';
}

function resolvePromptChoice(question, choices) {
  const prompt = stripQureoMarkup(questionText(question))
    .replace(/\s+/gu, ' ')
    .trim();

  if (/إذا كان/u.test(prompt) && /وإلا/u.test(prompt) &&
      /فافعل\s*A/u.test(prompt) && /فافعل\s*B/u.test(prompt)) {
    const expected = compact('if condition: A else: B');
    const matches = choices.filter(choice => compact(choiceText(choice)) === expected);
    if (matches.length === 1) return Number(matches[0].id);
    if (matches.length > 1) return null;
  }

  const variable = prompt.match(/قيمة المتغير\s+([A-Za-z_][\w]*)/u)?.[1];
  const number = prompt.match(/\b(\d+(?:\.\d+)?)\b/u)?.[1];
  if (!variable || !number) return null;

  let operator = null;
  if (/أكبر من أو يساوي|أكبر من أو أكثر|أو أكبر/u.test(prompt)) {
    operator = '>=';
  } else if (/أقل من أو يساوي|أصغر من أو يساوي|أو أقل|أو أصغر/u.test(prompt)) {
    operator = '<=';
  } else if (/أكبر من/u.test(prompt)) {
    operator = '>';
  } else if (/أقل من|أصغر من/u.test(prompt)) {
    operator = '<';
  } else if (/يساوي|تساوي/u.test(prompt)) {
    operator = '==';
  }

  if (!operator) return null;

  const expected = compact(variable + ' ' + operator + ' ' + number);
  const matches = choices.filter(choice => compact(choiceText(choice)) === expected);
  return matches.length === 1 ? Number(matches[0].id) : null;
}

function resolveChoice(question, record) {
  const questionRow = question?.question || question || {};
  const choices = Array.isArray(question?.choices) ? question.choices :
    Array.isArray(questionRow?.choices) ? questionRow.choices : [];
  if (!choices.length) return null;

  const answer = String(record.answer ?? '').trim();
  const answerLines = answer.split('\n').map(line => line.trim()).filter(Boolean);
  const code = extractCodeAnswer(answer);
  const variants = [...new Set([...answerLines, code].filter(Boolean))];

  for (const choice of choices) {
    const text = choiceText(choice);
    const normalizedChoice = compact(text);
    if (!normalizedChoice) continue;
    if (variants.some(value => compact(value) === normalizedChoice)) {
      return Number(choice.id);
    }
  }

  const prompt = questionText(question);
  if (/(?:رمز|علامة)\s+الضرب|multiplication\s+(?:operator|symbol)/iu.test(prompt)) {
    const multiplicationChoices = choices.filter(choice => compact(choiceText(choice)) === '*');
    if (multiplicationChoices.length === 1) return Number(multiplicationChoices[0].id);
  }

  const promptChoice = resolvePromptChoice(question, choices);
  if (Number.isSafeInteger(promptChoice)) return promptChoice;

  const answerTokens = tokens(answer);
  const stringAnswer = /\bstring\b|سلسلة|\bstr\b/iu.test(answer) ||
    (answerTokens.includes('نص') && /نوع|data|type/u.test(questionText(question)));
  const numericAnswer = /\bnumeric\b|\bnumber\b|\binteger\b|\bfloat\b|رقمي|عدد/iu.test(answer);
  const semantic = choices.filter(choice => {
    const value = choiceText(choice);
    if (stringAnswer) return /string|سلسلة|نص/iu.test(value);
    if (numericAnswer) return /رقمي|عدد|numeric|number|integer|float/iu.test(value);
    return false;
  });
  if (semantic.length === 1) return Number(semantic[0].id);

  const ranked = choices.map(choice => ({
    id: Number(choice.id),
    score: similarity(answer, choiceText(choice))
  })).sort((a, b) => b.score - a.score);
  if (ranked.length && ranked[0].score >= 0.32 &&
      (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.12)) {
    return ranked[0].id;
  }
  return null;
}

function lessonOrder(record) {
  const lessonNumber = String(record.lesson_id ?? '').match(/-s(\d+)$/u)?.[1];
  return Number(lessonNumber || 0);
}

function isReviewRecord(record) {
  return /مراجعة|اختبار|فهم|review|test|quiz/iu.test(
    String(record.lesson_title || '')
  );
}

function makeAnswer(question, record) {
  const questionRow = question?.question || question || {};
  const type = String(questionRow.type || '');
  if (type === 'choice') {
    const choiceId = resolveChoice(question, record);
    if (!Number.isSafeInteger(choiceId)) return null;
    const choices = Array.isArray(question?.choices) ? question.choices : [];
    if (!choices.some(choice => Number(choice.id) === choiceId)) return null;
    return { type: 'choice', choice_id: choiceId };
  }
  if (type === 'description') {
    const answerCode = extractCodeAnswer(record.answer);
    return answerCode ? { type: 'description', answer_code: answerCode } : null;
  }
  return null;
}

function sortRecords(records) {
  return [...records].sort((a, b) =>
    lessonOrder(a) - lessonOrder(b) ||
    Number(a.question_number || 0) - Number(b.question_number || 0)
  );
}

export function matchPythonAssessmentAnswers(questionItems, guideAnswers, levelId) {
  const questions = Array.isArray(questionItems) ? questionItems : [];
  const level = String(levelId).padStart(2, '0');
  const levelAnswers = (Array.isArray(guideAnswers) ? guideAnswers : [])
    .filter(record => String(record.level_id).padStart(2, '0') === level);
  const reviewAnswers = sortRecords(levelAnswers.filter(isReviewRecord));
  const allAnswers = sortRecords(levelAnswers);

  let candidates = reviewAnswers.length >= questions.length && questions.length
    ? reviewAnswers
    : allAnswers;
  let strategy = 'question-text';

  if (candidates.length === questions.length && questions.length > 0) {
    strategy = reviewAnswers.length === questions.length ? 'review-order' : 'level-order';
  }

  const assignments = [];
  const usedRecords = new Set();
  if (strategy !== 'question-text') {
    questions.forEach((question, index) => {
      assignments.push({ question, record: candidates[index], score: 1, strategy });
      usedRecords.add(candidates[index]);
    });
  } else {
    const pairs = [];
    for (const question of questions) {
      for (const record of candidates) {
        pairs.push({
          question,
          record,
          score: similarity(questionText(question), record.question || '')
        });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const usedQuestions = new Set();
    for (const pair of pairs) {
      if (pair.score < 0.12) break;
      if (usedQuestions.has(pair.question) || usedRecords.has(pair.record)) continue;
      usedQuestions.add(pair.question);
      usedRecords.add(pair.record);
      assignments.push({ ...pair, strategy: 'question-text' });
    }
  }

  const answers = {};
  const matches = [];
  const unmatched = [];
  const assignedQuestions = new Set();

  for (const assignment of assignments) {
    const id = String((assignment.question?.question || assignment.question)?.id ?? '');
    if (!id) continue;
    assignedQuestions.add(assignment.question);
    const answer = makeAnswer(assignment.question, assignment.record);
    if (!answer) {
      unmatched.push({
        question_id: id,
        guide_question: assignment.record.question || '',
        reason: 'The guide answer could not be converted to a valid answer for the live QUREO question type.'
      });
      continue;
    }
    answers[id] = answer;
    matches.push({
      question_id: id,
      guide_id: assignment.record.id || null,
      guide_question: assignment.record.question || '',
      guide_answer: assignment.record.answer || '',
      source_url: assignment.record.source_url || '',
      score: assignment.score,
      strategy: assignment.strategy
    });
  }

  for (const question of questions) {
    if (assignedQuestions.has(question)) continue;
    const id = String((question?.question || question)?.id ?? '');
    unmatched.push({
      question_id: id,
      guide_question: '',
      reason: 'No suitable answer-guide question could be matched to this assessment question.'
    });
  }

  return { answers, matches, unmatched, levelId: level };
}
