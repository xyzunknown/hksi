import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const source = fs.readFileSync(path.join(root, 'hksi_mindmap.html'), 'utf8');

function readJsonAssignment(marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing marker: ${marker}`);
  let index = source.indexOf('=', markerIndex) + 1;
  while (/\s/.test(source[index])) index += 1;
  const open = source[index];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(index, cursor + 1));
    }
  }
  throw new Error(`Unclosed value: ${marker}`);
}

const originalChapters = readJsonAssignment('const CHAPTERS');
const extraQuestions = readJsonAssignment('var EXTRA_QUESTIONS');
const flashcards = readJsonAssignment('var FLASHCARDS');

const questionMap = new Map();
const chapters = originalChapters.map((chapter) => {
  const sections = [];
  for (const objective of chapter.objectives || []) {
    for (const group of objective.groups || []) {
      for (const section of group.sections || []) {
        const questionIds = [];
        for (const question of section.questions || []) {
          const normalized = { ...question, chId: chapter.id, sec: section.num, source: '章节题库' };
          questionMap.set(String(normalized.id), normalized);
          questionIds.push(String(normalized.id));
        }
        sections.push({
          num: section.num,
          title: section.title,
          label: section.label || group.name,
          html: section.html || '',
          summary: section.summary || '',
          example: section.example || '',
          questionIds
        });
      }
    }
  }
  return { id: chapter.id, title: chapter.title, sections };
});

for (const question of extraQuestions) {
  const previous = questionMap.get(String(question.id)) || {};
  questionMap.set(String(question.id), {
    ...previous,
    ...question,
    chId: Number(question.chId || previous.chId || 1),
    source: question.src || previous.source || '综合题库'
  });
}

const questions = [...questionMap.values()].filter((question) =>
  question.q && Array.isArray(question.opts) && question.opts.length === 4 && /^[ABCD]$/.test(question.ans)
);

const payload = {
  generatedAt: new Date().toISOString(),
  chapters,
  questions,
  flashcards,
  totals: { chapters: chapters.length, questions: questions.length, flashcards: flashcards.length }
};

const destination = path.join(root, 'android-app/app/src/main/assets/data.js');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `window.HKSI_DATA=${JSON.stringify(payload)};\n`);
console.log(JSON.stringify(payload.totals));
