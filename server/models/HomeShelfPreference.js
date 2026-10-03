const { DataTypes, Model } = require('sequelize')

class HomeShelfPreference extends Model {
  static init(sequelize) {
    super.init({
      userId: { type: DataTypes.UUID, primaryKey: true, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      libraryId: { type: DataTypes.UUID, primaryKey: true, allowNull: false, references: { model: 'libraries', key: 'id' }, onDelete: 'CASCADE' },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      visible: { type: DataTypes.JSON, allowNull: false }
    }, { sequelize, modelName: 'homeShelfPreference' })
  }
}

module.exports = HomeShelfPreference
