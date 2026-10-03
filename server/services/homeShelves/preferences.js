const HomeShelfPreference = require('../../models/HomeShelfPreference')
const { normalizeVisible } = require('./catalog')

async function readChoice(userId, libraryId) {
  const row = await HomeShelfPreference.findOne({ where: { userId, libraryId } })
  return row ? row.get({ plain: true }) : null
}

async function saveChoice(userId, library, visible) {
  const choice = { version: 1, visible: normalizeVisible(visible, library) }
  // One SQLite UPSERT replaces only this user's row for this library.
  // User.save() and its cached extraData can never overwrite this table.
  await HomeShelfPreference.upsert({ userId, libraryId: library.id, ...choice })
  return choice
}

async function resetChoice(userId, libraryId) {
  await HomeShelfPreference.destroy({ where: { userId, libraryId } })
}

module.exports = { readChoice, saveChoice, resetChoice }
