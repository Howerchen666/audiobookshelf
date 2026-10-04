import { parseChapterList, validateChapters, serializeChapterList, ChapterError } from '../../../lib/chapterList'

describe('chapter list format and validation', () => {
  const valid = [{ title: '第一章', start: 0 }, { title: 'Café 日本語', start: 1.25 }]

  it('round trips portable Unicode title/start pairs', () => {
    expect(parseChapterList(serializeChapterList(valid)).chapters).to.deep.equal(valid)
    expect(validateChapters(valid, 10)).to.deep.equal([])
    expect(JSON.parse(serializeChapterList(valid))).to.deep.equal({ version: 1, chapters: valid })
  })

  it('rejects malformed or mismatched schema before business validation', () => {
    const rejected = ['{', '{}', '{"version":"1","chapters":[]}', '{"version":1,"chapters":[]}', '{"version":2,"chapters":[{"title":"a","start":0}]}', '{"version":1,"chapters":[{"title":"a","start":"0"}]}', '{"version":1,"chapters":[{"title":"a","start":null}]}', '{"version":1,"chapters":[{"title":"a"}]}', '{"version":1,"chapters":[{"title":"a","start":0,"end":1}]}', '{"version":1,"chapters":[{"title":3,"start":0}]}', '{"version":1,"chapters":[{"title":"a","start":0}],"extra":true}']
    rejected.forEach((json) => expect(parseChapterList(json).error, json).to.exist)
  })

  it('reports affected rows and stable business codes', () => {
    const chapters = [{ title: ' ', start: 1 }, { title: 'B', start: 1 }, { title: 'C', start: 11 }]
    expect(validateChapters(chapters, 10)).to.deep.equal([
      { row: 0, codes: [ChapterError.TITLE_EMPTY, ChapterError.FIRST_NOT_ZERO] },
      { row: 1, codes: [ChapterError.START_NOT_INCREASING] },
      { row: 2, codes: [ChapterError.START_GTE_DURATION] }
    ])
    expect(validateChapters([{ title: 'A', start: -1 }, { title: 'B', start: Infinity }], 10).map((error) => error.codes[0])).to.deep.equal([ChapterError.START_INVALID, ChapterError.START_INVALID])
  })
})
