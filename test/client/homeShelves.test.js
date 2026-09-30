const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

// Exercise the actual Vue component methods without adding a second test framework.
// tsc copies this test under dist-server; the .vue sources remain in client/.
const root = path.resolve(__dirname, __dirname.includes(`${path.sep}dist-server${path.sep}`) ? '../../..' : '../..')
function component(file) {
  const source = fs.readFileSync(path.join(root, 'client/components/app', file), 'utf8').split('<script>')[1].split('</script>')[0]
  const context = { module: { exports: {} }, window: { innerWidth: 1440 }, console }
  vm.runInNewContext(source.replace('export default', 'module.exports ='), context)
  return context.module.exports
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const panel = component('HomeShelfPreferences.vue')
const bookshelf = component('BookShelfCategorized.vue')
const settings = { shelves: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], defaultOrder: ['a', 'b', 'c'], visible: ['b', 'a'] }
function panelInstance() {
  const instance = { ...panel.data(), libraryId: 'library-a', $emit: sinon.spy(), $strings: { MessageHomeShelvesSaveFailed: 'save failed', MessageHomeShelvesLoadFailed: 'load failed' }, $axios: {} }
  for (const [key, method] of Object.entries(panel.methods)) instance[key] = method.bind(instance)
  return instance
}

describe('home shelf Vue behavior', () => {
  it('unwraps the library API envelope before passing the library ID to the panel', async () => {
    const page = component('../../pages/library/_library/index.vue')
    const library = { id: 'library-a', name: 'Books' }
    const store = { dispatch: sinon.stub().resolves({ library, issues: 0, filterData: {} }) }
    const redirect = sinon.spy()
    const data = await page.asyncData({ store, params: { library: library.id }, redirect })
    expect(data.library.id).to.equal(library.id)
    expect(redirect.called).to.equal(false)
  })

  it('edits a copy in saved order, keeps hidden rows unchecked, and cancels on reopen', () => {
    const instance = panelInstance()
    instance.settings = settings
    instance.open()
    expect(instance.draft.map((row) => row.id)).to.deep.equal(['b', 'a', 'c'])
    expect(instance.draft.map((row) => row.enabled)).to.deep.equal([true, true, false])
    instance.move(0, 1)
    instance.draft[0].enabled = false
    instance.show = false
    instance.open()
    expect(instance.draft.map((row) => row.id)).to.deep.equal(['b', 'a', 'c'])
    expect(settings.visible).to.deep.equal(['b', 'a'])
  })

  it('sends only checked IDs in draft order and emits refresh after success', async () => {
    const instance = panelInstance()
    instance.settings = settings
    instance.open()
    instance.move(1, -1)
    instance.$axios.$put = sinon.stub().resolves({ ...settings, visible: ['a', 'b'] })
    await instance.savePreferences()
    expect(instance.$axios.$put.firstCall.args).to.deep.equal(['/api/libraries/library-a/home-shelves', { visible: ['a', 'b'] }])
    expect(instance.$emit.calledWith('changed')).to.equal(true)
    expect(instance.show).to.equal(false)
  })

  it('preserves edits and keeps the panel open after save failure', async () => {
    const instance = panelInstance()
    instance.settings = settings
    instance.open()
    instance.draft[0].enabled = false
    instance.$axios.$put = sinon.stub().rejects(new Error('network'))
    await instance.savePreferences()
    expect(instance.draft[0].enabled).to.equal(false)
    expect(instance.show).to.equal(true)
    expect(instance.error).to.equal('save failed')
    expect(instance.$emit.called).to.equal(false)
    expect(instance.busy).to.equal(false)
  })

  it('supports all-hidden saves and immediate reset', async () => {
    const instance = panelInstance()
    instance.settings = settings
    instance.open()
    instance.draft.forEach((entry) => { entry.enabled = false })
    instance.$axios.$put = sinon.stub().resolves({ ...settings, visible: [] })
    await instance.savePreferences()
    expect(instance.$axios.$put.firstCall.args[1].visible).to.deep.equal([])
    instance.$axios.$delete = sinon.stub().resolves({ ...settings, visible: null })
    await instance.resetPreferences()
    expect(instance.settings.visible).to.equal(null)
    expect(instance.draft.every((entry) => entry.enabled)).to.equal(true)
  })

  it('ignores late panel loads after a newer request, library switch or destruction', async () => {
    for (const mode of ['newer', 'switch', 'destroy']) {
      const instance = panelInstance()
      const pending = deferred()
      instance.$axios.$get = sinon.stub().onFirstCall().returns(pending.promise).onSecondCall().resolves(settings)
      const first = instance.loadPreferences()
      if (mode === 'newer') await instance.loadPreferences()
      if (mode === 'switch') instance.libraryId = 'library-b'
      if (mode === 'destroy') panel.beforeDestroy.call(instance)
      pending.resolve({ visible: ['stale'] })
      await first
      expect(instance.settings).to.equal(mode === 'newer' ? settings : null)
    }
  })

  function bookshelfInstance() {
    const instance = { ...bookshelf.data(), currentLibraryId: 'library-a', $axios: {}, supportedShelves: [] }
    for (const [key, method] of Object.entries(bookshelf.methods)) instance[key] = method.bind(instance)
    return instance
  }

  it('ignores late bookshelf responses after a newer refresh or library switch', async () => {
    for (const mode of ['newer', 'switch']) {
      const instance = bookshelfInstance()
      const pending = deferred()
      instance.$axios.$get = sinon.stub().onFirstCall().returns(pending.promise).onSecondCall().resolves([{ id: 'new', entities: [] }])
      const first = instance.fetchCategories()
      if (mode === 'newer') await instance.fetchCategories()
      else instance.currentLibraryId = 'library-b'
      pending.resolve([{ id: 'stale', entities: [] }])
      await first
      expect(instance.shelves.map((row) => row.id)).to.deep.equal(mode === 'newer' ? ['new'] : [])
    }
  })

  it('reports content failures separately from empty results', async () => {
    const instance = bookshelfInstance()
    instance.$axios.$get = sinon.stub().rejects(new Error('fixture failure'))
    await instance.fetchCategories()
    expect(instance.loadError).to.equal(true)
    expect(instance.loaded).to.equal(false)
  })

  it('reindexes after reorder/removal and clears the old shift-selection anchor', () => {
    const instance = bookshelfInstance()
    instance.supportedShelves = [{ id: 'b', entities: [{ id: '1' }, { id: '2' }] }, { id: 'a', entities: [{ id: '3' }] }]
    instance.lastItemIndexSelected = 9
    instance.reindexShelves()
    expect(instance.supportedShelves.map((row) => row.shelfStartIndex)).to.deep.equal([0, 2])
    expect(instance.lastItemIndexSelected).to.equal(-1)
    instance.supportedShelves[0].entities.pop()
    instance.reindexShelves()
    expect(instance.supportedShelves[1].shelfStartIndex).to.equal(1)
  })

  it('shift-selects across the displayed row order even when search contains unsupported rows', () => {
    const instance = bookshelfInstance()
    const entity = (id) => ({ id, mediaType: 'book', media: { numTracks: 1 } })
    const a = entity('a'), b = entity('b'), c = entity('c')
    instance.supportedShelves = [{ id: 'recently-added', entities: [a, b] }, { id: 'continue-listening', entities: [c] }]
    instance.shelves = [{ id: 'tags', type: 'tags', entities: [{ id: 'not-selectable' }] }, ...instance.supportedShelves]
    instance.reindexShelves()
    instance.lastItemIndexSelected = 0
    instance.selectedMediaItems = [{ id: 'a' }]
    instance.$store = { commit: sinon.spy() }
    instance.$eventBus = { $emit: sinon.spy() }
    instance.$nextTick = (callback) => callback()
    instance.selectEntity({ entity: c, shiftKey: true }, 1)
    expect(instance.$store.commit.getCalls().map((call) => call.args[1].item.id)).to.deep.equal(['a', 'b', 'c'])
    expect(instance.$store.commit.getCalls().every((call) => call.args[1].selected)).to.equal(true)
  })
})
