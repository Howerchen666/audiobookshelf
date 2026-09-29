const { DataTypes } = require('sequelize')

const migrationVersion = '2.37.0'
const migrationName = `${migrationVersion}-create-ebook-progresses`
const loggerPrefix = `[${migrationVersion} migration]`

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)
  if (!(await queryInterface.tableExists('ebookProgresses'))) {
    await queryInterface.createTable('ebookProgresses', {
      id: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      libraryItemId: { type: DataTypes.UUID, allowNull: false, references: { model: 'libraryItems', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      fileIno: { type: DataTypes.STRING, allowNull: false },
      positionType: { type: DataTypes.STRING, allowNull: false },
      positionValue: { type: DataTypes.TEXT, allowNull: false },
      progress: { type: DataTypes.FLOAT, allowNull: false },
      displayLabel: { type: DataTypes.STRING, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    })
  }

  let indexes = await queryInterface.showIndex('ebookProgresses')
  if (!indexes.some((index) => index.name === 'ebook_progresses_user_item_file_unique')) {
    await queryInterface.addIndex('ebookProgresses', { unique: true, name: 'ebook_progresses_user_item_file_unique', fields: ['userId', 'libraryItemId', 'fileIno'] })
  }
  indexes = await queryInterface.showIndex('ebookProgresses')
  if (!indexes.some((index) => index.name === 'ebook_progresses_user_item')) {
    await queryInterface.addIndex('ebookProgresses', { name: 'ebook_progresses_user_item', fields: ['userId', 'libraryItemId'] })
  }
  indexes = await queryInterface.showIndex('ebookProgresses')
  if (!indexes.some((index) => index.name === 'ebook_progresses_updated_at')) {
    await queryInterface.addIndex('ebookProgresses', { name: 'ebook_progresses_updated_at', fields: ['updatedAt'] })
  }
  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)
  if (await queryInterface.tableExists('ebookProgresses')) await queryInterface.dropTable('ebookProgresses')
  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
