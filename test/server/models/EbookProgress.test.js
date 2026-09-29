const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DataTypes, Model, Sequelize } = require('sequelize')
const EbookProgress = require('../../../server/models/EbookProgress')
const Logger = require('../../../server/Logger')
const migration = require('../../../server/migrations/v2.36.1-create-ebook-progresses')

function initOwnerModels(sequelize) {
  class User extends Model {}
  User.init({ id: { type: DataTypes.UUID, primaryKey: true } }, { sequelize, modelName: 'user' })
  class LibraryItem extends Model {}
  LibraryItem.init({ id: { type: DataTypes.UUID, primaryKey: true } }, { sequelize, modelName: 'libraryItem' })
}

describe('EbookProgress', () => {
  let sequelize

  beforeEach(async () => {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    initOwnerModels(sequelize)
    EbookProgress.init(sequelize)
    await sequelize.sync({ force: true })
  })

  afterEach(async () => sequelize.close())

  it('stores independent positions per user, item, and ebook file', async () => {
    const userId = '10000000-0000-4000-8000-000000000001'
    const libraryItemId = '20000000-0000-4000-8000-000000000001'
    await sequelize.models.user.create({ id: userId })
    await sequelize.models.libraryItem.create({ id: libraryItemId })
    await EbookProgress.create({ userId, libraryItemId, fileIno: 'epub-ino', positionType: 'epub-cfi', positionValue: 'epubcfi(/6/2)', progress: 0.25, displayLabel: 'Chapter 2' })
    await EbookProgress.create({ userId, libraryItemId, fileIno: 'pdf-ino', positionType: 'page', positionValue: '14', progress: 0.5, displayLabel: 'Page 14 of 28' })

    await EbookProgress.upsert({ userId, libraryItemId, fileIno: 'pdf-ino', positionType: 'page', positionValue: '15', progress: 0.54, displayLabel: 'Page 15 of 28' })
    const records = await EbookProgress.findAll({ order: [['fileIno', 'ASC']] })
    expect(records).to.have.length(2)
    expect(records.find((record) => record.fileIno === 'epub-ino').positionValue).to.equal('epubcfi(/6/2)')
    expect(records.find((record) => record.fileIno === 'pdf-ino').positionValue).to.equal('15')
  })

  it('isolates users and deletes only one file position', async () => {
    const libraryItemId = '20000000-0000-4000-8000-000000000001'
    const firstUser = '10000000-0000-4000-8000-000000000001'
    const secondUser = '10000000-0000-4000-8000-000000000002'
    await sequelize.models.user.bulkCreate([{ id: firstUser }, { id: secondUser }])
    await sequelize.models.libraryItem.create({ id: libraryItemId })
    const base = { libraryItemId, fileIno: 'same-ino', positionType: 'page', progress: 0.2, displayLabel: 'Page 2 of 10' }
    await EbookProgress.create({ ...base, userId: firstUser, positionValue: '2' })
    await EbookProgress.create({ ...base, userId: secondUser, positionValue: '7' })

    await EbookProgress.destroy({ where: { userId: firstUser, libraryItemId, fileIno: 'same-ino' } })
    expect(await EbookProgress.count({ where: { userId: firstUser } })).to.equal(0)
    expect(await EbookProgress.count({ where: { userId: secondUser } })).to.equal(1)
  })
})


describe('EbookProgress persistence', () => {
  it('reloads independent file positions after reopening the database', async () => {
    const storage = path.join(os.tmpdir(), `ebook-progress-${process.pid}-${Date.now()}.sqlite`)
    const userId = '10000000-0000-4000-8000-000000000001'
    const libraryItemId = '20000000-0000-4000-8000-000000000001'
    let connection
    try {
      connection = new Sequelize({ dialect: 'sqlite', storage, logging: false })
      initOwnerModels(connection)
      EbookProgress.init(connection)
      await connection.sync({ force: true })
      await connection.models.user.create({ id: userId })
      await connection.models.libraryItem.create({ id: libraryItemId })
      await EbookProgress.bulkCreate([
        { userId, libraryItemId, fileIno: 'epub-ino', positionType: 'epub-cfi', positionValue: 'epubcfi(/6/8)', progress: 0.4, displayLabel: 'Chapter 4' },
        { userId, libraryItemId, fileIno: 'pdf-ino', positionType: 'page', positionValue: '20', progress: 0.5, displayLabel: 'Page 20 of 40' }
      ])
      await connection.close()

      connection = new Sequelize({ dialect: 'sqlite', storage, logging: false })
      initOwnerModels(connection)
      EbookProgress.init(connection)
      const records = await EbookProgress.findAll({ order: [['fileIno', 'ASC']] })
      expect(records.map((record) => [record.fileIno, record.positionValue])).to.deep.equal([
        ['epub-ino', 'epubcfi(/6/8)'],
        ['pdf-ino', '20']
      ])
    } finally {
      if (connection) await connection.close().catch(() => {})
      if (fs.existsSync(storage)) fs.unlinkSync(storage)
    }
  })
})

describe('Migration v2.36.1-create-ebook-progresses', () => {
  it('creates the new table without changing legacy media progress', async () => {
    const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    const queryInterface = sequelize.getQueryInterface()
    sinon.stub(Logger, 'info')
    await queryInterface.createTable('users', { id: { type: DataTypes.UUID, primaryKey: true } })
    await queryInterface.createTable('libraryItems', { id: { type: DataTypes.UUID, primaryKey: true } })
    await queryInterface.createTable('mediaProgresses', { id: { type: DataTypes.UUID, primaryKey: true }, ebookLocation: DataTypes.STRING, ebookProgress: DataTypes.FLOAT })
    await queryInterface.bulkInsert('mediaProgresses', [{ id: '30000000-0000-4000-8000-000000000001', ebookLocation: 'epubcfi(/6/2)', ebookProgress: 0.4 }])

    await migration.up({ context: { queryInterface, logger: Logger } })
    const [legacy] = await sequelize.query('SELECT * FROM mediaProgresses')
    expect(legacy).to.deep.equal([{ id: '30000000-0000-4000-8000-000000000001', ebookLocation: 'epubcfi(/6/2)', ebookProgress: 0.4 }])
    expect(await queryInterface.tableExists('ebookProgresses')).to.be.true
    await sequelize.close()
    sinon.restore()
  })
})
