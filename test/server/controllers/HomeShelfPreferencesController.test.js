const { expect } = require('chai')
const sinon = require('sinon')
const Database = require('../../../server/Database')
const Controller = require('../../../server/controllers/HomeShelfPreferencesController')
const LibraryController = require('../../../server/controllers/LibraryController')
const preferences = require('../../../server/services/homeShelves/preferences')
const { connect, seed } = require('../../fixtures/homeShelvesDatabase')

describe('HomeShelfPreferencesController', () => {
  let fixture
  let req
  let res
  beforeEach(async () => {
    await connect()
    fixture = await seed()
    req = { user: fixture.user, library: fixture.bookLibrary, params: { id: fixture.bookLibrary.id }, query: {}, body: { visible: ['discover'] } }
    res = { json: sinon.spy(), set: sinon.stub().returnsThis(), status: sinon.stub().returnsThis(), send: sinon.spy(), sendStatus: sinon.spy() }
  })
  afterEach(async () => { sinon.restore(); await Database.sequelize.close() })

  it('returns applicable metadata without querying any shelf content', async () => {
    const loader = sinon.spy(Database.libraryItemModel, 'getPersonalizedShelves')
    await Controller.get(req, res)
    expect(res.json.firstCall.args[0].visible).to.equal(null)
    expect(res.json.firstCall.args[0].defaultOrder).to.include('continue-reading')
    expect(loader.called).to.equal(false)
  })

  it('saves normalized settings for the authenticated user and resets them', async () => {
    req.body.visible = ['discover', 'discover', 'unknown', 'newest-episodes', 'recently-added']
    await Controller.put(req, res)
    expect(res.json.firstCall.args[0].visible).to.deep.equal(['discover', 'recently-added'])
    expect(await preferences.readChoice(fixture.otherUser.id, fixture.bookLibrary.id)).to.equal(null)
    await Controller.reset(req, res)
    expect(res.json.lastCall.args[0].visible).to.equal(null)
  })

  it('rejects malformed writes, excessive input and attempted user overrides', async () => {
    for (const body of [null, [], {}, { visible: 'discover' }, { visible: [1] }, { visible: Array(101).fill('discover') }, { visible: ['x'.repeat(101)] }, { visible: [], userId: fixture.otherUser.id }]) {
      req.body = body
      await Controller.put(req, res)
      expect(res.status.lastCall.args[0]).to.equal(400)
    }
    expect(await preferences.readChoice(req.user.id, req.library.id)).to.equal(null)
  })

  it('returns 500 on a failed database write without claiming success', async () => {
    sinon.stub(preferences, 'saveChoice').rejects(new Error('fixture failure'))
    await Controller.put(req, res)
    expect(res.sendStatus.calledWith(500)).to.equal(true)
    expect(res.json.called).to.equal(false)
  })

  it('uses library middleware to refuse inaccessible and nonexistent libraries', async () => {
    const next = sinon.spy()
    req.user.permissions = { ...req.user.permissions, accessAllLibraries: false, librariesAccessible: [] }
    await LibraryController.middleware(req, res, next)
    expect(res.sendStatus.calledWith(403)).to.equal(true)
    expect(next.called).to.equal(false)
    req.user.permissions.accessAllLibraries = true
    req.params.id = 'nonexistent'
    await LibraryController.middleware(req, res, next)
    expect(res.status.calledWith(404)).to.equal(true)
    expect(next.called).to.equal(false)
  })
})
