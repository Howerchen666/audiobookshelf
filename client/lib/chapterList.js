export const ChapterError = Object.freeze({
  TITLE_EMPTY: 'TITLE_EMPTY',
  START_INVALID: 'START_INVALID',
  FIRST_NOT_ZERO: 'FIRST_NOT_ZERO',
  START_NOT_INCREASING: 'START_NOT_INCREASING',
  START_GTE_DURATION: 'START_GTE_DURATION'
})

export function parseChapterList(json) {
  let value
  try {
    value = JSON.parse(json)
  } catch {
    return { error: 'INVALID_JSON' }
  }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'chapters,version' || value.version !== 1 || !Array.isArray(value.chapters) || !value.chapters.length) {
    return { error: 'INVALID_SCHEMA' }
  }
  for (const chapter of value.chapters) {
    if (!chapter || Array.isArray(chapter) || typeof chapter !== 'object' || Object.keys(chapter).sort().join(',') !== 'start,title' || typeof chapter.title !== 'string' || typeof chapter.start !== 'number') {
      return { error: 'INVALID_SCHEMA' }
    }
  }
  return { chapters: value.chapters.map(({ title, start }) => ({ title, start })) }
}

export function validateChapters(chapters, mediaDuration) {
  const errors = []
  chapters.forEach((chapter, row) => {
    const codes = []
    if (typeof chapter.title !== 'string' || !chapter.title.trim()) codes.push(ChapterError.TITLE_EMPTY)
    if (typeof chapter.start !== 'number' || !Number.isFinite(chapter.start) || chapter.start < 0) {
      codes.push(ChapterError.START_INVALID)
    } else {
      if (row === 0 && chapter.start !== 0) codes.push(ChapterError.FIRST_NOT_ZERO)
      if (row > 0 && chapter.start <= chapters[row - 1].start) codes.push(ChapterError.START_NOT_INCREASING)
      if (chapter.start >= mediaDuration) codes.push(ChapterError.START_GTE_DURATION)
    }
    if (codes.length) errors.push({ row, codes })
  })
  return errors
}

export function serializeChapterList(chapters) {
  return JSON.stringify({ version: 1, chapters: chapters.map(({ title, start }) => ({ title, start })) }, null, 2) + '\n'
}
