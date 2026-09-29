const { expect } = require('chai')
const sinon = require('sinon')
const Database = require('../../../server/Database')
const MeController = require('../../../server/controllers/MeController')

function response() {
  const res = { json: sinon.spy(), send: sinon.spy(), sendStatus: sinon.spy() }
  res.status = sinon.stub().returns(res)
  return res
}

function request(overrides = {}) {
  return {
    params: { libraryItemId: 'item-1', fileIno: 'file-1' },
    body: { positionType: 'page', positionValue: '4', progress: 0.3, displayLabel: 'Page 4 of 10' },
    user: { id: 'user-1', username: 'reader', checkCanAccessLibraryItem: () => true },
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
      isBook: true,
      getLibraryFileWithIno: (ino) => (ino === 'file-1' ? { isEBookFile: true } : null)
    }
    ebookProgressModel = {
      findAll: sinon.stub().resolves([]),
      upsert: sinon.stub().resolves([{ id: 'progress-1', fileIno: 'file-1' }, true]),
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

  it('rejects access to an unauthorized item', async () => {
    const req = request({ user: { id: 'user-2', username: 'other', checkCanAccessLibraryItem: () => false } })
    const res = response()
    await MeController.updateEbookProgress(req, res)
    expect(res.sendStatus.calledWith(403)).to.be.true
    expect(ebookProgressModel.upsert.called).to.be.false
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
    expect(ebookProgressModel.upsert.called).to.be.false
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

  it('upserts and deletes the exact user, item, and file tuple', async () => {
    let res = response()
    await MeController.updateEbookProgress(request(), res)
    expect(ebookProgressModel.upsert.firstCall.args[0]).to.include({ userId: 'user-1', libraryItemId: 'item-1', fileIno: 'file-1', positionType: 'page', positionValue: '4' })

    res = response()
    await MeController.deleteEbookProgress(request(), res)
    expect(ebookProgressModel.destroy.firstCall.args[0].where).to.deep.equal({ userId: 'user-1', libraryItemId: 'item-1', fileIno: 'file-1' })
    expect(res.sendStatus.calledWith(200)).to.be.true
  })
})
