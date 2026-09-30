const { applicableShelves, resolveChoice } = require('./catalog')
const Logger = require('../../Logger')

// Both default and customized layouts use this one assembler.
module.exports = async function loadShelves(library, user, include, limit, choice) {
  const start = Date.now()
  const applicable = applicableShelves(library)
  const visible = resolveChoice(choice, library)
  const byId = new Map(applicable.map((entry) => [entry.id, entry]))
  const selected = visible === null ? applicable : visible.map((id) => byId.get(id))
  const loads = new Map()
  const shelves = await Promise.all(selected.map(async (entry) => {
    if (!loads.has(entry.loader.key)) {
      loads.set(entry.loader.key, entry.loader.load(library, user, include, limit))
    }
    return entry.buildShelf(await loads.get(entry.loader.key), library)
  }))
  const nonempty = shelves.filter((entry) => entry.entities.length)
  Logger.debug(`Loaded ${nonempty.length} personalized shelves with ${loads.size} loader groups in ${((Date.now() - start) / 1000).toFixed(2)}s`)
  return nonempty
}
