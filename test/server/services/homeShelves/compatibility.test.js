const { expect } = require('chai')
const sinon = require('sinon')
const filters = require('../../../../server/utils/queries/libraryFilters')
const catalog = require('../../../../server/services/homeShelves/catalog')
const loadShelves = require('../../../../server/services/homeShelves/loadShelves')
const legacy = require('../../../fixtures/legacyHomeShelves')

const book = { id: 'books', mediaType: 'book', isBook: true, isPodcast: false }
const podcast = { id: 'podcasts', mediaType: 'podcast', isBook: false, isPodcast: true }
const audio = { id: 'audio', mediaType: 'book', media: { numTracks: 1 }, rssFeed: { id: 'feed' }, mediaItemShare: { id: 'share' } }
const ebook = { id: 'ebook', mediaType: 'book', media: { numTracks: 0, ebookFormat: 'epub' } }
const episode = { id: 'podcast', mediaType: 'podcast', media: {}, recentEpisode: { id: 'episode' } }
const user = { id: 'user' }
const include = ['rssfeed', 'numepisodesincomplete', 'share']
let stubs

describe('home shelf catalog and shared assembler', () => {
  beforeEach(() => {
    stubs = {}
    for (const method of ['getMediaItemsInProgress', 'getLibraryItemsContinueSeries', 'getLibraryItemsMostRecentlyAdded', 'getSeriesMostRecentlyAdded', 'getLibraryItemsToDiscover', 'getMediaFinished', 'getNewestAuthors', 'getNewestPodcastEpisodes']) {
      stubs[method] = sinon.stub(filters, method).callsFake(async (library) => ({
        items: library.isBook ? [audio, ebook] : [episode], libraryItems: library.isBook ? [audio] : [episode],
        series: [{ id: 'series', books: [audio] }], authors: [{ id: 'author', name: 'Author' }], count: 19
      }))
    }
  })
  afterEach(() => sinon.restore())

  for (const library of [book, podcast]) {
    it(`matches the frozen legacy ${library.mediaType} output for defaults and explicit default order`, async () => {
      const expected = await legacy(library, user, include, 12)
      expect(await loadShelves(library, user, include, 12, null)).to.deep.equal(expected)
      const visible = catalog.describePreferences(null, library).defaultOrder
      expect(await loadShelves(library, user, include, 12, { version: 1, visible })).to.deep.equal(expected)
    })
  }

  it('runs exactly three selected loaders, preserves order, include and limit', async () => {
    const visible = ['recently-added', 'continue-listening', 'discover']
    const rows = await loadShelves(book, user, include, 12, { version: 1, visible })
    expect(rows.map((row) => row.id)).to.deep.equal(visible)
    const used = ['getLibraryItemsMostRecentlyAdded', 'getMediaItemsInProgress', 'getLibraryItemsToDiscover']
    for (const [name, stub] of Object.entries(stubs)) {
      expect(stub.callCount, name).to.equal(used.includes(name) ? 1 : 0)
      if (stub.called) expect(stub.firstCall.args.slice(0, 4)).to.deep.equal([book, user, include, 12])
    }
  })

  it('shares each sibling loader once and keeps the legacy unsplit total', async () => {
    const visible = ['continue-reading', 'continue-listening', 'read-again', 'listen-again']
    const rows = await loadShelves(book, user, [], 10, { version: 1, visible })
    expect(rows.map((row) => row.id)).to.deep.equal(visible)
    expect(rows.every((row) => row.total === 19)).to.equal(true)
    expect(stubs.getMediaItemsInProgress.callCount).to.equal(1)
    expect(stubs.getMediaFinished.callCount).to.equal(1)
  })

  it('keeps a sibling loader when only one sibling is visible', async () => {
    await loadShelves(book, user, [], 10, { version: 1, visible: ['continue-reading', 'read-again'] })
    expect(stubs.getMediaItemsInProgress.callCount).to.equal(1)
    expect(stubs.getMediaFinished.callCount).to.equal(1)
  })

  it('loads nothing for empty and unknown-only choices', async () => {
    for (const visible of [[], ['removed-shelf']]) expect(await loadShelves(book, user, [], 10, { version: 1, visible })).to.deep.equal([])
    expect(Object.values(stubs).every((stub) => !stub.called)).to.equal(true)
  })

  it('omits empty rows without removing options or reordering nonempty rows', async () => {
    stubs.getLibraryItemsMostRecentlyAdded.resolves({ libraryItems: [], count: 0 })
    const rows = await loadShelves(book, user, [], 10, { version: 1, visible: ['discover', 'recently-added', 'continue-listening'] })
    expect(rows.map((row) => row.id)).to.deep.equal(['discover', 'continue-listening'])
    expect(catalog.describePreferences(null, book).defaultOrder).to.include('recently-added')
  })

  it('normalizes duplicates, unknown IDs and inapplicable IDs in order', () => {
    expect(catalog.resolveChoice({ version: 1, visible: ['newest-episodes', 'discover', 'removed', 'discover', 'recently-added'] }, book)).to.deep.equal(['discover', 'recently-added'])
    expect(catalog.describePreferences(null, podcast).defaultOrder).to.deep.equal(['continue-listening', 'newest-episodes', 'recently-added', 'listen-again'])
  })

  it('falls back to defaults for malformed stored choices', async () => {
    for (const choice of [undefined, {}, { version: 2, visible: [] }, { version: 1, visible: 'bad' }, { version: 1, visible: [3] }]) {
      expect(catalog.resolveChoice(choice, book)).to.equal(null)
    }
  })

  it('keeps unlisted shelf types hidden until selected or reset', () => {
    const oldChoice = { version: 1, visible: ['continue-listening'] }
    expect(catalog.describePreferences(oldChoice, book).visible).to.deep.equal(['continue-listening'])
    expect(catalog.describePreferences(null, book).defaultOrder).to.include('discover')
  })

  it('preserves the Recent Series limit of five', async () => {
    await loadShelves(book, user, include, 15, { version: 1, visible: ['recent-series'] })
    expect(stubs.getSeriesMostRecentlyAdded.firstCall.args).to.deep.equal([book, user, include, 5])
  })
})
