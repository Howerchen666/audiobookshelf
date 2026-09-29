const { DataTypes, Model } = require('sequelize')

class EbookProgress extends Model {
  constructor(values, options) {
    super(values, options)

    this.id
    this.userId
    this.libraryItemId
    this.fileIno
    this.positionType
    this.positionValue
    this.progress
    this.displayLabel
  }

  static init(sequelize) {
    super.init(
      {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: { type: DataTypes.UUID, allowNull: false },
        libraryItemId: { type: DataTypes.UUID, allowNull: false },
        fileIno: { type: DataTypes.STRING, allowNull: false },
        positionType: { type: DataTypes.STRING, allowNull: false },
        positionValue: { type: DataTypes.TEXT, allowNull: false },
        progress: { type: DataTypes.FLOAT, allowNull: false },
        displayLabel: { type: DataTypes.STRING, allowNull: false }
      },
      {
        sequelize,
        modelName: 'ebookProgress',
        indexes: [
          { unique: true, name: 'ebook_progresses_user_item_file_unique', fields: ['userId', 'libraryItemId', 'fileIno'] },
          { name: 'ebook_progresses_user_item', fields: ['userId', 'libraryItemId'] },
          { name: 'ebook_progresses_updated_at', fields: ['updatedAt'] }
        ]
      }
    )

    const { user, libraryItem } = sequelize.models
    user.hasMany(EbookProgress, { onDelete: 'CASCADE' })
    EbookProgress.belongsTo(user)
    libraryItem.hasMany(EbookProgress, { onDelete: 'CASCADE' })
    EbookProgress.belongsTo(libraryItem)
  }
}

module.exports = EbookProgress
