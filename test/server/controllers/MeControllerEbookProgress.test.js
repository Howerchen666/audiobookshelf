const { expect } = require('chai')
const sinon = require('sinon')
const Database = require('../../../server/Database')
const MeController = require('../../../server/controllers/MeController')
const SocketAuthority = require('../../../server/SocketAuthority')

function response() {
  const res = { json: sinon.spy(), send: sinon.spy(), sendStatus: sinon.spy() }
  res.status = sinon.stub().returns(res)
  return res
}

function request(overrides = {}) {
  return {
    params: { libraryItemId: 'item-1', fileIno: 'file-1' },
    body: { positionType: 'page', positionValue: '4', progress: 0.3, displayLabel: 'Page 4 of 10' },
    user: { id: 'user-1', username: 'reader', mediaProgresses: [], checkCanAccessLibraryItem: () => true, toOldJSONForBrowser: () => ({ id: 'user-1' }) },
    ...overrides
  }
}

describe('MeController ebook progress', () => {
  let originalSequelize
  let libraryItem
  let ebookProgressModel

  beforeEach(() => {
    originalSequelize = Database.sequelize
    libraryItem = {
      id: 'item-1',
      mediaId: 'book-1',
      isBook: true,
      getLibraryFileWithIno: (ino) => (ino === 'file-1' ? { isEBookFile: true } : null)
    }
    ebookProgressModel = {
      findAll: sinon.stub().resolves([]),
      findOne: sinon.stub().resolves({ id: 'progress-stored', libraryItemId: 'item-1', fileIno: 'file-1' }),
      upsert: sinon.stub().resolves([{ id: 'progress-attempted', fileIno: 'file-1' }, true]),
      destroy: sinon.stub().resolves(1)
    }
    Database.sequelize = {
      models: {
        libraryItem: { getExpandedById: sinon.stub().resolves(libraryItem) },
        ebookProgress: ebookProgressModel
      }
    }
  })

  afterEach(() => {
    Database.sequelize = originalSequelize
    sinon.restore()
  })

  it('returns only the authenticated user records', async () => {
    const req = request()
    const res = response()
    await MeController.getEbookProgress(req, res)
    expect(ebookProgressModel.findAll.firstCall.args[0].where).to.deep.equal({ userId: 'user-1', libraryItemId: 'item-1' })
    expect(res.json.calledOnce).to.be.true
  })

  it('rejects unauthorized reads, updates, and deletes', async () => {
    const req = request({ user: { id: 'user-2', username: 'other', checkCanAccessLibraryItem: () => false } })

    let res = response()
    await MeController.getEbookProgress(req, res)
    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(ebookProgressModel.findAll.called).to.be.false

    res = response()
    await MeController.updateEbookProgress(req, res)
    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(ebookProgressModel.upsert.called).to.be.false

    res = response()
    await MeController.deleteEbookProgress(req, res)
    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(ebookProgressModel.destroy.called).to.be.false
  })

  it('rejects missing items, invalid ebook files, malformed payloads, and out-of-range progress', async () => {
    const libraryModel = Database.sequelize.models.libraryItem
    libraryModel.getExpandedById.resolves(null)
    let res = response()
    await MeController.updateEbookProgress(request(), res)
    expect(res.sendStatus.calledWith(404)).to.be.true

    libraryModel.getExpandedById.resolves(libraryItem)
    res = response()
    await MeController.updateEbookProgress(request({ params: { libraryItemId: 'item-1', fileIno: 'other-file' } }), res)
    expect(res.status.calledWith(400)).to.be.true

    res = response()
    await MeController.updateEbookProgress(request({ body: { positionType: 'page', positionValue: '2', progress: 2, displayLabel: 'Page 2' } }), res)
    expect(res.status.calledWith(400)).to.be.true

    res = response()
    await MeController.updateEbookProgress(request({ body: { positionType: 'page', positionValue: 2, progress: 0.2, displayLabel: 'Page 2' } }), res)
    expect(res.status.calledWith(400)).to.be.true

    res = response()
    await MeController.updateEbookProgress(request({ body: { positionType: 'page', positionValue: '2', progress: 0.2, displayLabel: 'Page 2', migrateLegacy: 'yes' } }), res)
    expect(res.status.calledWith(400)).to.be.true
    expect(ebookProgressModel.upsert.called).to.be.false
  })

  it('preserves legacy progress until a reader reports successful restoration', async () => {
    const legacyProgress = {
      mediaItemType: 'book',
      mediaItemId: 'book-1',
      ebookLocation: '14',
      ebookProgress: 0.4,
      currentTime: 321,
      isFinished: false,
      save: sinon.stub().resolves()
    }
    const req = request({
      user: { id: 'user-1', username: 'reader', mediaProgresses: [legacyProgress], checkCanAccessLibraryItem: () => true, toOldJSONForBrowser: () => ({ id: 'user-1' }) }
    })

    await MeController.updateEbookProgress(req, response())

    expect(legacyProgress.ebookLocation).to.equal('14')
    expect(legacyProgress.ebookProgress).to.equal(0.4)
    expect(legacyProgress.currentTime).to.equal(321)
    expect(legacyProgress.isFinished).to.equal(false)
    expect(legacyProgress.save.called).to.be.false
  })

  it('consumes legacy ebook progress after conversion without changing listening progress', async () => {
    const legacyProgress = {
      mediaItemType: 'book',
      mediaItemId: 'book-1',
      ebookLocation: '14',
      ebookProgress: 0.4,
      currentTime: 321,
      duration: 1000,
      isFinished: false,
      save: sinon.stub().resolves()
    }
    sinon.stub(SocketAuthority, 'clientEmitter')
    const req = request({
      body: { positionType: 'page', positionValue: '14', progress: 0.4, displayLabel: 'Page 14 of 35', migrateLegacy: true },
      user: { id: 'user-1', username: 'reader', mediaProgresses: [legacyProgress], checkCanAccessLibraryItem: () => true, toOldJSONForBrowser: () => ({ id: 'user-1' }) }
    })

    await MeController.updateEbookProgress(req, response())

    expect(legacyProgress.ebookLocation).to.equal(null)
    expect(legacyProgress.ebookProgress).to.equal(0)
    expect(legacyProgress.currentTime).to.equal(321)
    expect(legacyProgress.duration).to.equal(1000)
    expect(legacyProgress.isFinished).to.equal(false)
    expect(legacyProgress.save.calledOnceWith({ silent: true })).to.be.true
    expect(SocketAuthority.clientEmitter.calledOnce).to.be.true
  })

  it('keeps finished and hidden books out of Continue Reading when ebook progress remains', async () => {
    const libraryModel = Database.sequelize.models.libraryItem
    const item = { id: 'item-1', isPodcast: false, toOldJSONMinified: () => ({ id: 'item-1' }) }
    libraryModel.findAllExpandedWhere = sinon.stub().resolves([item])
    ebookProgressModel.findAll.resolves([{ libraryItemId: 'item-1', updatedAt: new Date(300), toJSON: () => ({ fileIno: 'file-1', progress: 0.4 }) }])

    for (const state of [{ isFinished: true, hideFromContinueListening: false }, { isFinished: false, hideFromContinueListening: true }]) {
      const req = request({
        query: {},
        user: {
          id: 'user-1',
          mediaProgresses: [{ ...state, mediaItemType: 'book', mediaItemId: 'book-1', currentTime: 0, ebookProgress: 0, extraData: { libraryItemId: 'item-1' } }],
          checkCanAccessLibraryItem: () => true
        }
      })
      const res = response()
      await MeController.getAllLibraryItemsInProgress(req, res)
      expect(res.json.firstCall.args[0].libraryItems).to.deep.equal([])
    }
  })

  it('deduplicates listening and multiple ebook positions using the latest update', async () => {
    const libraryModel = Database.sequelize.models.libraryItem
    const item = {
      id: 'item-1',
      isPodcast: false,
      toOldJSONMinified: () => ({ id: 'item-1', media: { duration: 100 } })
    }
    libraryModel.findAllExpandedWhere = sinon.stub().resolves([item])
    ebookProgressModel.findAll.resolves([
      { libraryItemId: 'item-1', updatedAt: new Date(200), toJSON: () => ({ id: 'ebook-1', fileIno: 'file-1', progress: 0.2 }) },
      { libraryItemId: 'item-1', updatedAt: new Date(300), toJSON: () => ({ id: 'ebook-2', fileIno: 'file-2', progress: 0.4 }) }
    ])
    const listeningProgress = {
      isFinished: false,
      currentTime: 10,
      ebookProgress: 0,
      extraData: { libraryItemId: 'item-1' },
      getOldMediaProgress: () => ({ libraryItemId: 'item-1', lastUpdate: 100 })
    }
    const req = request({
      query: {},
      user: { id: 'user-1', mediaProgresses: [listeningProgress], checkCanAccessLibraryItem: () => true }
    })
    const res = response()

    await MeController.getAllLibraryItemsInProgress(req, res)

    const result = res.json.firstCall.args[0].libraryItems
    expect(result).to.have.length(1)
    expect(result[0].ebookProgress.map((progress) => progress.fileIno)).to.deep.equal(['file-1', 'file-2'])
    expect(result[0].progressLastUpdate).to.equal(300)
  })

  it('keeps Continue Reading consistent as ebook and listening progress are cleared', async () => {
    const libraryModel = Database.sequelize.models.libraryItem
    const item = { id: 'item-1', isPodcast: false, toOldJSONMinified: () => ({ id: 'item-1' }) }
    libraryModel.findAllExpandedWhere = sinon.stub().resolves([item])
    const first = { libraryItemId: 'item-1', updatedAt: new Date(200), toJSON: () => ({ fileIno: 'primary-epub', progress: 0.2 }) }
    const second = { libraryItemId: 'item-1', updatedAt: new Date(300), toJSON: () => ({ fileIno: 'supplementary-pdf', progress: 0.4 }) }
    const req = request({ query: {}, user: { id: 'user-1', mediaProgresses: [], checkCanAccessLibraryItem: () => true } })

    ebookProgressModel.findAll.resolves([first, second])
    let res = response()
    await MeController.getAllLibraryItemsInProgress(req, res)
    expect(res.json.firstCall.args[0].libraryItems).to.have.length(1)

    ebookProgressModel.findAll.resolves([second])
    res = response()
    await MeController.getAllLibraryItemsInProgress(req, res)
    expect(res.json.firstCall.args[0].libraryItems).to.have.length(1)
    expect(res.json.firstCall.args[0].libraryItems[0].ebookProgress[0].fileIno).to.equal('supplementary-pdf')

    ebookProgressModel.findAll.resolves([])
    res = response()
    await MeController.getAllLibraryItemsInProgress(req, res)
    expect(res.json.firstCall.args[0].libraryItems).to.deep.equal([])

    req.user.mediaProgresses = [{
      isFinished: false,
      hideFromContinueListening: false,
      mediaItemType: 'book',
      mediaItemId: 'book-1',
      currentTime: 30,
      ebookProgress: 0,
      extraData: { libraryItemId: 'item-1' },
      getOldMediaProgress: () => ({ libraryItemId: 'item-1', lastUpdate: 400 })
    }]
    res = response()
    await MeController.getAllLibraryItemsInProgress(req, res)
    expect(res.json.firstCall.args[0].libraryItems).to.have.length(1)
  })

  it('upserts and deletes the exact user, item, and file tuple', async () => {
    let res = response()
    await MeController.updateEbookProgress(request(), res)
    expect(ebookProgressModel.upsert.firstCall.args[0]).to.include({ userId: 'user-1', libraryItemId: 'item-1', fileIno: 'file-1', positionType: 'page', positionValue: '4' })
    expect(ebookProgressModel.findOne.calledOnceWith({ where: { userId: 'user-1', libraryItemId: 'item-1', fileIno: 'file-1' } })).to.be.true
    expect(res.json.calledOnceWith({ id: 'progress-stored', libraryItemId: 'item-1', fileIno: 'file-1' })).to.be.true

    res = response()
    await MeController.deleteEbookProgress(request(), res)
    expect(ebookProgressModel.destroy.firstCall.args[0].where).to.deep.equal({ userId: 'user-1', libraryItemId: 'item-1', fileIno: 'file-1' })
    expect(res.sendStatus.calledWith(200)).to.be.true
  })
})
