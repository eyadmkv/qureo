export function resolveChapterIndex(chapters, token) {
  const value = String(token ?? '').trim();
  if (!value) return -1;

  const byId = chapters.findIndex(chapter => String(chapter.id) === value);
  if (byId >= 0) return byId;

  if (/^\d+$/.test(value)) {
    const sequence = Number(value);
    return chapters.findIndex(chapter => Number(chapter.seq ?? chapter.sequence) === sequence);
  }

  return -1;
}

export function planChapterSelection(chapters, {
  targetChapter = null,
  single = false,
  maxChapters = null,
  skipCompleted = true
} = {}) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('No chapters are available for this course.');
  }

  if (maxChapters !== null && (!Number.isInteger(maxChapters) || maxChapters < 1)) {
    throw new Error('Maximum chapter count must be a positive integer.');
  }

  const firstUnfinishedIndex = chapters.findIndex(chapter => !chapter.completed);
  const target = targetChapter === null || targetChapter === undefined
    ? ''
    : String(targetChapter).trim();

  const rangeMatch = target.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch && single) {
    throw new Error('Use either a chapter range or --single, not both.');
  }

  let startIndex;
  let endIndex;
  let selectionLabel = 'current progress';

  if (rangeMatch) {
    const startSequence = Number(rangeMatch[1]);
    const endSequence = Number(rangeMatch[2]);
    if (startSequence > endSequence) {
      throw new Error('Chapter range must be in ascending order, for example 18-30.');
    }

    const rangeStart = resolveChapterIndex(chapters, startSequence);
    const rangeEnd = resolveChapterIndex(chapters, endSequence);
    if (rangeStart < 0) throw new Error(`Chapter ${startSequence} was not found in this course.`);
    if (rangeEnd < 0) throw new Error(`Chapter ${endSequence} was not found in this course.`);

    if (firstUnfinishedIndex >= 0 && firstUnfinishedIndex < rangeStart) {
      const first = chapters[firstUnfinishedIndex];
      throw new Error(
        `Chapter ${first.seq ?? first.sequence ?? first.id} is still unfinished, before the requested range. ` +
        'The solver will not skip it.'
      );
    }

    startIndex = skipCompleted
      ? Math.max(rangeStart, firstUnfinishedIndex < 0 ? chapters.length : firstUnfinishedIndex)
      : rangeStart;
    endIndex = rangeEnd;
    selectionLabel = `chapters ${startSequence}-${endSequence}`;
  } else if (single) {
    if (!target) {
      if (firstUnfinishedIndex < 0) {
        return {
          chapters: [],
          skippedCompleted: 0,
          selectionLabel: 'the current chapter',
          firstUnfinishedIndex,
          summary: 'All chapters are already complete.'
        };
      }
      startIndex = firstUnfinishedIndex;
    } else {
      const requestedIndex = resolveChapterIndex(chapters, target);
      if (requestedIndex < 0) {
        throw new Error(`Target chapter "${target}" was not found by chapter sequence or ID.`);
      }
      if (firstUnfinishedIndex >= 0 && requestedIndex !== firstUnfinishedIndex) {
        const first = chapters[firstUnfinishedIndex];
        if (requestedIndex > firstUnfinishedIndex) {
          throw new Error(
            `Chapter ${first.seq ?? first.sequence ?? first.id} is the first unfinished chapter. ` +
            'The solver will not skip ahead to the requested chapter.'
          );
        }
        throw new Error(
          `Target chapter ${target} is already before the first unfinished chapter ` +
          `${first.seq ?? first.sequence ?? first.id}.`
        );
      }
      startIndex = requestedIndex;
    }

    endIndex = startIndex;
    selectionLabel = `chapter ${chapters[startIndex]?.seq ?? chapters[startIndex]?.sequence ?? chapters[startIndex]?.id ?? target}`;
  } else {
    endIndex = target
      ? resolveChapterIndex(chapters, target)
      : chapters.length - 1;

    if (target && endIndex < 0) {
      throw new Error(`Target chapter "${target}" was not found by chapter sequence or ID.`);
    }

    if (target && firstUnfinishedIndex >= 0 && endIndex < firstUnfinishedIndex) {
      throw new Error(
        `Target chapter ${target} is before the first unfinished chapter ` +
        `${chapters[firstUnfinishedIndex].seq ?? firstUnfinishedIndex + 1}.`
      );
    }

    startIndex = firstUnfinishedIndex < 0 ? chapters.length : firstUnfinishedIndex;
    selectionLabel = target ? `through chapter ${target}` : 'all remaining chapters';
  }

  const candidates = [];
  let skippedCompleted = 0;

  for (let index = startIndex; index <= endIndex; index++) {
    const chapter = chapters[index];
    if (!chapter) continue;
    if (skipCompleted && chapter.completed) {
      skippedCompleted++;
      continue;
    }
    candidates.push({ chapter, index });
  }

  const selected = maxChapters === null ? candidates : candidates.slice(0, maxChapters);
  const summary = selected.length
    ? null
    : rangeMatch
      ? `No unfinished chapters remain in range ${selectionLabel}.`
      : single
        ? 'The selected chapter is already complete.'
        : 'All chapters in the selected range are already complete.';

  return {
    chapters: selected,
    skippedCompleted,
    selectionLabel,
    firstUnfinishedIndex,
    summary
  };
}
