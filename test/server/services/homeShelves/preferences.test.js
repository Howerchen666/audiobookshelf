const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('../../../../server/Database')
const Preference = require('../../../../server/models/HomeShelfPreference')
const preferences = require('../../../../server/services/homeShelves/preferences')
const { connect, seed } = require('../../../fixtures/homeShelvesDatabase')
const ApiCacheManager = require('../../../../server/managers/ApiCacheManager')
const LibraryController = require('../../../../server/controllers/LibraryController')

describe('home shelf SQLite persistence and queries', function () {
  this.timeout(20000)
  let fixture
  let directory
  let storage
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abs-home-shelves-'))
    storage = path.join(directory, 'test.sqlite')
    await connect(storage)
    fixture = await seed()
  })
  afterEach(async () => {
    await Database.sequelize.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('persists independent libraries/users through connection close and reopen', async () => {
    const { user, otherUser, bookLibrary, podcastLibrary } = fixture
    await Promise.all([
      preferences.saveChoice(user.id, bookLibrary, ['discover']),
      preferences.saveChoice(user.id, podcastLibrary, []),
      preferences.saveChoice(otherUser.id, bookLibrary, ['recently-added'])
    ])
    await Database.sequelize.close()
    await connect(storage)
    expect((await preferences.readChoice(user.id, bookLibrary.id)).visible).to.deep.equal(['discover'])
    expect((await preferences.readChoice(user.id, podcastLibrary.id)).visible).to.deep.equal([])
    expect((await preferences.readChoice(otherUser.id, bookLibrary.id)).visible).to.deep.equal(['recently-added'])
    await preferences.resetChoice(user.id, bookLibrary.id)
    expect(await preferences.readChoice(user.id, bookLibrary.id)).to.equal(null)
    expect((await preferences.readChoice(user.id, podcastLibrary.id)).visible).to.deep.equal([])
  })

  it('cannot lose preferences to a stale cached User.save or overwrite extraData', async () => {
    const { user, bookLibrary } = fixture
    const staleUser = await Database.userModel.getUserById(user.id)
    await preferences.saveChoice(user.id, bookLibrary, ['discover'])
    staleUser.extraData = { ...staleUser.extraData, seriesHideFromContinueListening: ['series-1'] }
    await staleUser.save()
    expect((await preferences.readChoice(user.id, bookLibrary.id)).visible).to.deep.equal(['discover'])
    expect((await Database.userModel.findByPk(user.id)).extraData).to.deep.equal({ unrelated: 'keep me', seriesHideFromContinueListening: ['series-1'] })
  })

  it('keeps one complete row under concurrent saves to the same pair', async () => {
    const { user, bookLibrary } = fixture
    const choices = [['discover'], ['recently-added', 'continue-listening']]
    await Promise.all(choices.map((visible) => preferences.saveChoice(user.id, bookLibrary, visible)))
    expect(await Preference.count()).to.equal(1)
    expect(choices).to.deep.include((await preferences.readChoice(user.id, bookLibrary.id)).visible)
  })

  it('deletes preference rows when their user or library is deleted', async () => {
    const { user, otherUser, bookLibrary, podcastLibrary } = fixture
    await preferences.saveChoice(user.id, bookLibrary, [])
    await preferences.saveChoice(otherUser.id, podcastLibrary, [])
    await user.destroy()
    await podcastLibrary.destroy()
    expect(await Preference.count()).to.equal(0)
  })

  it('invalidates personalized cache on both upsert and reset', async () => {
    const manager = new ApiCacheManager()
    manager.init()
    const key = JSON.stringify({ user: fixture.user.username, url: `/libraries/${fixture.bookLibrary.id}/personalized` })
    manager.cache.set(key, { body: 'old', headers: {} })
    await preferences.saveChoice(fixture.user.id, fixture.bookLibrary, [])
    expect(manager.cache.has(key)).to.equal(false)
    manager.cache.set(key, { body: 'empty', headers: {} })
    await preferences.resetChoice(fixture.user.id, fixture.bookLibrary.id)
    expect(manager.cache.has(key)).to.equal(false)
  })

  it('preserves explicit-content and tag permissions with the real content loaders', async () => {
    const { user, bookLibrary, items } = fixture
    user.permissions = { ...user.permissions, accessExplicitContent: false, accessAllTags: false, itemTagsSelected: ['allowed'], selectedTagsNotAccessible: false }
    await user.save()
    await preferences.saveChoice(user.id, bookLibrary, ['recently-added', 'discover', 'continue-listening'])
    const shelves = await Database.libraryItemModel.getPersonalizedShelves(bookLibrary, user, ['rssfeed', 'share'], 50)
    expect(shelves.length).to.be.greaterThan(0)
    for (const shelf of shelves) {
      expect(shelf.entities.map((item) => item.id)).not.to.include(items[22].id)
      expect(shelf.entities.map((item) => item.id)).not.to.include(items[23].id)
    }
  })

  it('loads real podcast episode payloads and rejects book-only rows during normalization', async () => {
    const { user, podcastLibrary } = fixture
    await preferences.saveChoice(user.id, podcastLibrary, ['discover', 'newest-episodes'])
    const shelves = await Database.libraryItemModel.getPersonalizedShelves(podcastLibrary, user, [], 10)
    expect(shelves.map((row) => row.id)).to.deep.equal(['newest-episodes'])
    expect(shelves[0].type).to.equal('episode')
    expect(shelves[0].entities[0].recentEpisode.title).to.equal('Fixture Episode')
  })

  it('measures fewer SQL statements for three rows, including the preference read', async () => {
    const { user, bookLibrary } = fixture
    async function measure(visible) {
      if (visible === null) await preferences.resetChoice(user.id, bookLibrary.id)
      else await preferences.saveChoice(user.id, bookLibrary, visible)
      const req = { library: bookLibrary, user, query: { include: 'rssfeed,numEpisodesIncomplete,share', limit: 10 } }
      const res = { json() {} }
      for (let i = 0; i < 5; i++) await LibraryController.getUserPersonalizedShelves(req, res)
      const samples = []
      for (let i = 0; i < 20; i++) {
        let queries = 0
        Database.sequelize.options.logging = () => queries++
        const start = performance.now()
        await LibraryController.getUserPersonalizedShelves(req, res)
        samples.push({ queries, ms: performance.now() - start })
        Database.sequelize.options.logging = false
      }
      return samples
    }
    const defaults = await measure(null)
    const selected = await measure(['recently-added', 'continue-listening', 'discover'])
    expect(Math.max(...selected.map((s) => s.queries))).to.be.lessThan(Math.min(...defaults.map((s) => s.queries)))
    const empty = await measure([])
    expect(empty.every((s) => s.queries === 1)).to.equal(true)
    if (process.env.HOME_SHELVES_BENCHMARK_OUTPUT) fs.writeFileSync(process.env.HOME_SHELVES_BENCHMARK_OUTPUT, JSON.stringify({ defaults, selected, empty, books: 24, authors: 1, series: 1, progress: 4, node: process.version }, null, 2))
  })
})
