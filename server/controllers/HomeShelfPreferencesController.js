const preferences = require('../services/homeShelves/preferences')
const { describePreferences } = require('../services/homeShelves/catalog')
const Logger = require('../Logger')

async function handle(req, res, action) {
  try {
    const choice = await action()
    res.set('Cache-Control', 'no-store')
    return res.json(describePreferences(choice, req.library))
  } catch (error) {
    Logger.error('[HomeShelfPreferencesController] Failed to access preferences', error)
    return res.sendStatus(500)
  }
}

module.exports = {
  get(req, res) {
    return handle(req, res, () => preferences.readChoice(req.user.id, req.library.id))
  },
  put(req, res) {
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'visible') ||
      !Array.isArray(body.visible) || body.visible.length > 100 || body.visible.some((id) => typeof id !== 'string' || id.length > 100)) {
      return res.status(400).send('Expected { visible: string[] } with at most 100 shelf IDs of at most 100 characters each')
    }
    return handle(req, res, () => preferences.saveChoice(req.user.id, req.library, body.visible))
  },
  reset(req, res) {
    return handle(req, res, async () => {
      await preferences.resetChoice(req.user.id, req.library.id)
      return null
    })
  }
}
