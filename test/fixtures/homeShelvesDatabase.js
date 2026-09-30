const { Sequelize } = require('sequelize')
const Database = require('../../server/Database')

async function connect(storage = ':memory:') {
  global.ServerSettings = { sortingIgnorePrefix: false, sortingPrefixes: [] }
  Database.sequelize = new Sequelize({ dialect: 'sqlite', storage, logging: false })
  Database.sequelize.uppercaseFirst = (str) => str ? str[0].toUpperCase() + str.slice(1) : ''
  await Database.buildModels()
}

async function seed() {
  const bookLibrary = await Database.libraryModel.create({ name: 'Books', mediaType: 'book', settings: Database.libraryModel.getDefaultLibrarySettingsForMediaType('book') })
  const podcastLibrary = await Database.libraryModel.create({ name: 'Podcasts', mediaType: 'podcast', settings: Database.libraryModel.getDefaultLibrarySettingsForMediaType('podcast') })
  const permissions = Database.userModel.getDefaultPermissionsForUserType('user')
  const user = await Database.userModel.create({ username: 'shelf-user', type: 'user', permissions, bookmarks: [], extraData: { unrelated: 'keep me' }, isActive: true })
  const otherUser = await Database.userModel.create({ username: 'other-user', type: 'user', permissions, bookmarks: [], extraData: {}, isActive: true })
  const folder = await Database.libraryFolderModel.create({ path: '/fixture/books', libraryId: bookLibrary.id })
  const author = await Database.authorModel.create({ name: 'Fixture Author', libraryId: bookLibrary.id })
  const series = await Database.seriesModel.create({ name: 'Fixture Series', libraryId: bookLibrary.id })
  const items = []
  for (let index = 0; index < 24; index++) {
    const book = await Database.bookModel.create({ title: `Book ${index}`, titleIgnorePrefix: `Book ${index}`, explicit: index === 22,
      tags: index === 23 ? ['restricted'] : ['allowed'], genres: [], narrators: [], chapters: [], duration: 100,
      audioFiles: [{ index: 1, duration: 100, metadata: { filename: 'track.mp3', ext: '.mp3', path: '/fixture/track.mp3', relPath: 'track.mp3', size: 1000 } }] })
    const item = await Database.libraryItemModel.create({ path: `/fixture/books/${index}`, title: book.title, libraryFiles: [], mediaId: book.id, mediaType: 'book', libraryId: bookLibrary.id, libraryFolderId: folder.id })
    await Database.bookAuthorModel.create({ bookId: book.id, authorId: author.id })
    await Database.bookSeriesModel.create({ bookId: book.id, seriesId: series.id, sequence: String(index + 1) })
    if (index < 4) await Database.mediaProgressModel.create({ userId: user.id, mediaItemId: book.id, mediaItemType: 'book', duration: 100, currentTime: index < 2 ? 30 : 100, isFinished: index >= 2, hideFromContinueListening: false })
    items.push(item)
  }
  const podcastFolder = await Database.libraryFolderModel.create({ path: '/fixture/podcasts', libraryId: podcastLibrary.id })
  const podcast = await Database.podcastModel.create({ title: 'Fixture Podcast', explicit: false, tags: [], genres: [], autoDownloadEpisodes: false })
  await Database.libraryItemModel.create({ path: '/fixture/podcasts/show', libraryFiles: [], mediaId: podcast.id, mediaType: 'podcast', libraryId: podcastLibrary.id, libraryFolderId: podcastFolder.id })
  await Database.podcastEpisodeModel.create({ podcastId: podcast.id, title: 'Fixture Episode', index: 1, audioFile: { metadata: { filename: 'ep.mp3', path: '/fixture/ep.mp3', ext: '.mp3', relPath: 'ep.mp3' }, duration: 100 } })
  return { bookLibrary, podcastLibrary, user, otherUser, items }
}

module.exports = { connect, seed }
