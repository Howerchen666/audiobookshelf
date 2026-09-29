const { expect } = require('chai')
const { Op } = require('sequelize')
const libraryItemsBookFilters = require('../../../../server/utils/queries/libraryItemsBookFilters')

describe('libraryItemsBookFilters ebook progress', () => {
  it('treats legacy ebook progress as started in regular and collapsed-series filters', () => {
    const { mediaWhere } = libraryItemsBookFilters.getMediaGroupQuery('progress', 'not-started')
    expect(mediaWhere[Op.and][2]['$mediaProgresses.ebookProgress$'][Op.or]).to.deep.equal([null, 0])

    const collapsed = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('not-started')
    expect(collapsed[Op.and][2]['$books.mediaProgresses.ebookProgress$'][Op.or]).to.deep.equal([null, 0])
    expect(collapsed[Op.and][3].val).to.include('NOT EXISTS')
    expect(collapsed[Op.and][3].val).to.include('ebookProgresses')
  })

  it('adds per-file ebook progress to collapsed-series in-progress filters', () => {
    const collapsed = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('in-progress')
    expect(collapsed[Op.or]).to.have.length(2)
    expect(collapsed[Op.or][1].val).to.include('ebookProgresses')
    expect(collapsed[Op.or][1].val).to.include('ep.progress > 0 AND ep.progress < 1')
    expect(collapsed[Op.or][1].val).to.include('emp.isFinished = 1')

    const homePageCollapsed = libraryItemsBookFilters.getCollapseSeriesMediaProgressFilter('in-progress', true)
    expect(homePageCollapsed[Op.or][1].val).to.include('emp.hideFromContinueListening = 1')
  })
})
