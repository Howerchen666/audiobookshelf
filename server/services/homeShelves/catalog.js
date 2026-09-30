const filters = require('../../utils/queries/libraryFilters')

const audioItems = (payload) => payload.items.filter((item) => item.media.numTracks || item.mediaType === 'podcast')
const ebookItems = (payload) => payload.items.filter((item) => item.media.ebookFormat && !item.media.numTracks)
const books = (library) => library.isBook
const podcasts = (library) => library.isPodcast
const both = (library) => library.isBook || library.isPodcast
const audioType = (library) => (library.isPodcast ? 'episode' : 'book')

// The loader objects are shared by sibling shelves. The runner memoizes by key.
const progress = { key: 'progress', load: (l, u, i, n) => filters.getMediaItemsInProgress(l, u, i, n, false) }
const finished = { key: 'finished', load: (l, u, i, n) => filters.getMediaFinished(l, u, i, n) }

function shelf(id, label, labelStringKey, appliesTo, type, loader, entities) {
  return {
    id, label, labelStringKey, appliesTo, loader,
    type: typeof type === 'function' ? type : () => type,
    buildShelf(payload, library) {
      return { id, label, labelStringKey, type: this.type(library), entities: entities(payload), total: payload.count }
    }
  }
}

// Filtering this list by library type also defines the default order.
// Add future shelves here once; defaults, settings and custom layouts all use it.
const catalog = [
  shelf('continue-listening', 'Continue Listening', 'LabelContinueListening', both, audioType, progress, audioItems),
  shelf('continue-reading', 'Continue Reading', 'LabelContinueReading', books, 'book', progress, ebookItems),
  shelf('continue-series', 'Continue Series', 'LabelContinueSeries', books, 'book',
    { key: 'continue-series', load: (l, u, i, n) => filters.getLibraryItemsContinueSeries(l, u, i, n) }, (p) => p.libraryItems),
  shelf('newest-episodes', 'Newest Episodes', 'LabelNewestEpisodes', podcasts, 'episode',
    { key: 'newest-episodes', load: (l, u, i, n) => filters.getNewestPodcastEpisodes(l, u, n) }, (p) => p.libraryItems),
  shelf('recently-added', 'Recently Added', 'LabelRecentlyAdded', both, (l) => l.mediaType,
    { key: 'recently-added', load: (l, u, i, n) => filters.getLibraryItemsMostRecentlyAdded(l, u, i, n) }, (p) => p.libraryItems),
  shelf('recent-series', 'Recent Series', 'LabelRecentSeries', books, 'series',
    { key: 'recent-series', load: (l, u, i) => filters.getSeriesMostRecentlyAdded(l, u, i, 5) }, (p) => p.series),
  shelf('discover', 'Discover', 'LabelDiscover', books, (l) => l.mediaType,
    { key: 'discover', load: (l, u, i, n) => filters.getLibraryItemsToDiscover(l, u, i, n) }, (p) => p.libraryItems),
  shelf('listen-again', 'Listen Again', 'LabelListenAgain', both, audioType, finished, audioItems),
  shelf('read-again', 'Read Again', 'LabelReadAgain', books, 'book', finished, ebookItems),
  shelf('newest-authors', 'Newest Authors', 'LabelNewestAuthors', books, 'authors',
    { key: 'newest-authors', load: (l, u, i, n) => filters.getNewestAuthors(l, u, n) }, (p) => p.authors)
]

function applicableShelves(library) {
  return catalog.filter((entry) => entry.appliesTo(library))
}

function normalizeVisible(visible, library) {
  const applicable = new Set(applicableShelves(library).map((entry) => entry.id))
  return [...new Set(visible.filter((id) => applicable.has(id)))]
}

function resolveChoice(choice, library) {
  if (!choice || choice.version !== 1 || !Array.isArray(choice.visible) || choice.visible.some((id) => typeof id !== 'string')) return null
  return normalizeVisible(choice.visible, library)
}

function describePreferences(choice, library) {
  const shelves = applicableShelves(library).map((entry) => ({ id: entry.id, label: entry.label, labelStringKey: entry.labelStringKey, type: entry.type(library) }))
  return { shelves, defaultOrder: shelves.map((entry) => entry.id), visible: resolveChoice(choice, library) }
}

module.exports = { applicableShelves, normalizeVisible, resolveChoice, describePreferences }
