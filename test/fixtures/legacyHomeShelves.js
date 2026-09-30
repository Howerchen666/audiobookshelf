// Frozen pre-feature assembler from jiashend; test oracle only, never production code.
const libraryFilters = require('../../server/utils/queries/libraryFilters')
const Logger = require('../../server/Logger')

module.exports = async function getPersonalizedShelves(library, user, include, limit) {
    const fullStart = Date.now() // Used for testing load times

    const shelves = []

    const timed = async (loader) => {
      const start = Date.now()
      const payload = await loader()
      return {
        payload,
        elapsedSeconds: ((Date.now() - start) / 1000).toFixed(2)
      }
    }

    // "Continue Listening" shelf
    const itemsInProgressPayload = await libraryFilters.getMediaItemsInProgress(library, user, include, limit, false)
    if (itemsInProgressPayload.items.length) {
      const ebookOnlyItemsInProgress = itemsInProgressPayload.items.filter((li) => li.media.ebookFormat && !li.media.numTracks)
      const audioItemsInProgress = itemsInProgressPayload.items.filter((li) => li.media.numTracks || li.mediaType === 'podcast')

      if (audioItemsInProgress.length) {
        shelves.push({
          id: 'continue-listening',
          label: 'Continue Listening',
          labelStringKey: 'LabelContinueListening',
          type: library.isPodcast ? 'episode' : 'book',
          entities: audioItemsInProgress,
          total: itemsInProgressPayload.count
        })
      }

      if (ebookOnlyItemsInProgress.length) {
        // "Continue Reading" shelf
        shelves.push({
          id: 'continue-reading',
          label: 'Continue Reading',
          labelStringKey: 'LabelContinueReading',
          type: 'book',
          entities: ebookOnlyItemsInProgress,
          total: itemsInProgressPayload.count
        })
      }
    }
    Logger.debug(`Loaded ${itemsInProgressPayload.items.length} of ${itemsInProgressPayload.count} items for "Continue Listening/Reading" in ${((Date.now() - fullStart) / 1000).toFixed(2)}s`)

    if (library.isBook) {
      const [continueSeriesResult, mostRecentResult, seriesMostRecentResult, discoverResult, mediaFinishedResult, newestAuthorsResult] = await Promise.all([
        timed(() => libraryFilters.getLibraryItemsContinueSeries(library, user, include, limit)),
        timed(() => libraryFilters.getLibraryItemsMostRecentlyAdded(library, user, include, limit)),
        timed(() => libraryFilters.getSeriesMostRecentlyAdded(library, user, include, 5)),
        timed(() => libraryFilters.getLibraryItemsToDiscover(library, user, include, limit)),
        timed(() => libraryFilters.getMediaFinished(library, user, include, limit)),
        timed(() => libraryFilters.getNewestAuthors(library, user, limit))
      ])

      const continueSeriesPayload = continueSeriesResult.payload
      // "Continue Series" shelf
      if (continueSeriesPayload.libraryItems.length) {
        shelves.push({
          id: 'continue-series',
          label: 'Continue Series',
          labelStringKey: 'LabelContinueSeries',
          type: 'book',
          entities: continueSeriesPayload.libraryItems,
          total: continueSeriesPayload.count
        })
      }
      Logger.debug(`Loaded ${continueSeriesPayload.libraryItems.length} of ${continueSeriesPayload.count} items for "Continue Series" in ${continueSeriesResult.elapsedSeconds}s`)

      const mostRecentPayload = mostRecentResult.payload
      // "Recently Added" shelf
      if (mostRecentPayload.libraryItems.length) {
        shelves.push({
          id: 'recently-added',
          label: 'Recently Added',
          labelStringKey: 'LabelRecentlyAdded',
          type: library.mediaType,
          entities: mostRecentPayload.libraryItems,
          total: mostRecentPayload.count
        })
      }
      Logger.debug(`Loaded ${mostRecentPayload.libraryItems.length} of ${mostRecentPayload.count} items for "Recently Added" in ${mostRecentResult.elapsedSeconds}s`)

      const seriesMostRecentPayload = seriesMostRecentResult.payload
      // "Recent Series" shelf
      if (seriesMostRecentPayload.series.length) {
        shelves.push({
          id: 'recent-series',
          label: 'Recent Series',
          labelStringKey: 'LabelRecentSeries',
          type: 'series',
          entities: seriesMostRecentPayload.series,
          total: seriesMostRecentPayload.count
        })
      }
      Logger.debug(`Loaded ${seriesMostRecentPayload.series.length} of ${seriesMostRecentPayload.count} series for "Recent Series" in ${seriesMostRecentResult.elapsedSeconds}s`)

      const discoverLibraryItemsPayload = discoverResult.payload
      // "Discover" shelf
      if (discoverLibraryItemsPayload.libraryItems.length) {
        shelves.push({
          id: 'discover',
          label: 'Discover',
          labelStringKey: 'LabelDiscover',
          type: library.mediaType,
          entities: discoverLibraryItemsPayload.libraryItems,
          total: discoverLibraryItemsPayload.count
        })
      }
      Logger.debug(`Loaded ${discoverLibraryItemsPayload.libraryItems.length} of ${discoverLibraryItemsPayload.count} items for "Discover" in ${discoverResult.elapsedSeconds}s`)

      const mediaFinishedPayload = mediaFinishedResult.payload
      // "Listen Again" shelf
      if (mediaFinishedPayload.items.length) {
        const ebookOnlyItemsInProgress = mediaFinishedPayload.items.filter((li) => li.media.ebookFormat && !li.media.numTracks)
        const audioItemsInProgress = mediaFinishedPayload.items.filter((li) => li.media.numTracks || li.mediaType === 'podcast')

        if (audioItemsInProgress.length) {
          shelves.push({
            id: 'listen-again',
            label: 'Listen Again',
            labelStringKey: 'LabelListenAgain',
            type: library.isPodcast ? 'episode' : 'book',
            entities: audioItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }

        if (ebookOnlyItemsInProgress.length) {
          // "Read Again" shelf
          shelves.push({
            id: 'read-again',
            label: 'Read Again',
            labelStringKey: 'LabelReadAgain',
            type: 'book',
            entities: ebookOnlyItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }
      }
      Logger.debug(`Loaded ${mediaFinishedPayload.items.length} of ${mediaFinishedPayload.count} items for "Listen/Read Again" in ${mediaFinishedResult.elapsedSeconds}s`)

      const newestAuthorsPayload = newestAuthorsResult.payload
      // "Newest Authors" shelf
      if (newestAuthorsPayload.authors.length) {
        shelves.push({
          id: 'newest-authors',
          label: 'Newest Authors',
          labelStringKey: 'LabelNewestAuthors',
          type: 'authors',
          entities: newestAuthorsPayload.authors,
          total: newestAuthorsPayload.count
        })
      }
      Logger.debug(`Loaded ${newestAuthorsPayload.authors.length} of ${newestAuthorsPayload.count} authors for "Newest Authors" in ${newestAuthorsResult.elapsedSeconds}s`)
    } else if (library.isPodcast) {
      const [newestEpisodesResult, mostRecentResult, mediaFinishedResult] = await Promise.all([
        timed(() => libraryFilters.getNewestPodcastEpisodes(library, user, limit)),
        timed(() => libraryFilters.getLibraryItemsMostRecentlyAdded(library, user, include, limit)),
        timed(() => libraryFilters.getMediaFinished(library, user, include, limit))
      ])

      const newestEpisodesPayload = newestEpisodesResult.payload
      // "Newest Episodes" shelf
      if (newestEpisodesPayload.libraryItems.length) {
        shelves.push({
          id: 'newest-episodes',
          label: 'Newest Episodes',
          labelStringKey: 'LabelNewestEpisodes',
          type: 'episode',
          entities: newestEpisodesPayload.libraryItems,
          total: newestEpisodesPayload.count
        })
      }
      Logger.debug(`Loaded ${newestEpisodesPayload.libraryItems.length} of ${newestEpisodesPayload.count} episodes for "Newest Episodes" in ${newestEpisodesResult.elapsedSeconds}s`)

      const mostRecentPayload = mostRecentResult.payload
      // "Recently Added" shelf
      if (mostRecentPayload.libraryItems.length) {
        shelves.push({
          id: 'recently-added',
          label: 'Recently Added',
          labelStringKey: 'LabelRecentlyAdded',
          type: library.mediaType,
          entities: mostRecentPayload.libraryItems,
          total: mostRecentPayload.count
        })
      }
      Logger.debug(`Loaded ${mostRecentPayload.libraryItems.length} of ${mostRecentPayload.count} items for "Recently Added" in ${mostRecentResult.elapsedSeconds}s`)

      const mediaFinishedPayload = mediaFinishedResult.payload
      // "Listen Again" shelf
      if (mediaFinishedPayload.items.length) {
        const ebookOnlyItemsInProgress = mediaFinishedPayload.items.filter((li) => li.media.ebookFormat && !li.media.numTracks)
        const audioItemsInProgress = mediaFinishedPayload.items.filter((li) => li.media.numTracks || li.mediaType === 'podcast')

        if (audioItemsInProgress.length) {
          shelves.push({
            id: 'listen-again',
            label: 'Listen Again',
            labelStringKey: 'LabelListenAgain',
            type: 'episode',
            entities: audioItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }

        if (ebookOnlyItemsInProgress.length) {
          // "Read Again" shelf
          shelves.push({
            id: 'read-again',
            label: 'Read Again',
            labelStringKey: 'LabelReadAgain',
            type: 'book',
            entities: ebookOnlyItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }
      }
      Logger.debug(`Loaded ${mediaFinishedPayload.items.length} of ${mediaFinishedPayload.count} items for "Listen/Read Again" in ${mediaFinishedResult.elapsedSeconds}s`)
    }

    Logger.debug(`Loaded ${shelves.length} personalized shelves in ${((Date.now() - fullStart) / 1000).toFixed(2)}s`)

    return shelves
  }
