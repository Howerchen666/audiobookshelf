import EpubReader from '@/components/readers/EpubReader.vue'
import PdfReader from '@/components/readers/PdfReader.vue'
import ComicReader from '@/components/readers/ComicReader.vue'
import MobiReader from '@/components/readers/MobiReader.vue'
import Reader from '@/components/readers/Reader.vue'
import EbookFilesTable from '@/components/tables/EbookFilesTable.vue'
import ItemPage from '@/pages/item/_id/index.vue'
import LazyBookCard from '@/components/cards/LazyBookCard.vue'

const libraryItem = { id: 'item-1' }
let mocks

function legacyProgress(location, files, selectedIno, progress = 0.3) {
  return Reader.methods.legacyProgressForSelectedFile.call({
    $store: { getters: { 'user/getUserMediaProgress': () => ({ ebookLocation: location, ebookProgress: progress }) } },
    selectedLibraryItem: { id: 'item-1', libraryFiles: files },
    ebookFileIno: selectedIno
  })
}

describe('per-file ebook position compatibility', () => {
  beforeEach(() => {
    mocks = {
      $store: { getters: { 'libraries/getLibraryEpubsAllowScriptedContent': false, 'user/getToken': 'token' } },
      $axios: { $put: cy.stub().resolves({ id: 'progress-1' }).as('putProgress') },
      $getString: (key, values) => `Page ${values[0]} of ${values[1]}`
    }
  })

  it('opens supplementary files with tracked progress and a normalized inode', () => {
    const commit = cy.stub()
    const item = { id: 'item-1', libraryFiles: [{ ino: '42', fileType: 'ebook', metadata: { ext: '.pdf' } }] }

    EbookFilesTable.methods.readEbook.call({ $store: { commit }, libraryItem: item }, 42)
    expect(commit).to.have.been.calledOnceWith('showEReader', { libraryItem: item, keepProgress: true, fileId: '42' })

    const selected = Reader.computed.ebookFile.call({ ebookFileId: 42, selectedLibraryItem: item })
    expect(selected).to.equal(item.libraryFiles[0])
    expect(Reader.computed.keepProgress.call({ $store: { state: {} } })).to.equal(true)
  })

  it('classifies legacy locations without guessing between compatible files', () => {
    const epub = { ino: 'epub-1', fileType: 'ebook', metadata: { ext: '.epub' } }
    const pdf = { ino: 'pdf-1', fileType: 'ebook', metadata: { ext: '.pdf' } }
    const secondPdf = { ino: 'pdf-2', fileType: 'ebook', metadata: { ext: '.pdf' } }

    expect(legacyProgress('epubcfi(/6/2)', [epub, pdf], 'epub-1')).to.include({ positionType: 'epub-cfi', ambiguous: false })
    expect(legacyProgress('14', [epub, pdf, secondPdf], 'pdf-1')).to.include({ positionType: 'page', ambiguous: true })
    expect(legacyProgress('14', [epub, pdf], 'pdf-1')).to.include({ positionType: 'page', ambiguous: false })
    expect(legacyProgress('not-a-position', [epub, pdf], 'epub-1')).to.equal(null)
    expect(legacyProgress('14', [epub, pdf], 'epub-1')).to.equal(null)
  })

  it('keeps EPUB and supplementary PDF positions while the primary file changes', async () => {
    const epub = { ino: 'epub-1', fileType: 'ebook', ebookFormat: 'epub', metadata: { ext: '.epub' } }
    const pdf = { ino: 'pdf-1', fileType: 'ebook', metadata: { ext: '.pdf' } }
    const records = [
      { id: 'epub-progress', libraryItemId: 'item-1', fileIno: 'epub-1', positionType: 'epub-cfi', positionValue: 'epubcfi(/6/8)', progress: 0.4, displayLabel: 'Chapter Four' },
      { id: 'pdf-progress', libraryItemId: 'item-1', fileIno: 'pdf-1', positionType: 'page', positionValue: '29', progress: 0.02, displayLabel: 'Page 29 of 1642' }
    ]
    const item = { id: 'item-1', media: { ebookFile: epub }, libraryFiles: [epub, pdf] }
    const get = cy.stub().resolves({ ebookProgress: records })

    async function open(fileId) {
      const file = Reader.computed.ebookFile.call({ ebookFileId: fileId, selectedLibraryItem: item, media: item.media })
      const context = {
        ebookProgressLoaded: false,
        ebookProgressRecords: [],
        selectedEbookProgress: null,
        selectedLibraryItem: item,
        ebookFileIno: String(file.ino),
        $axios: { $get: get },
        legacyProgressForSelectedFile: () => null
      }
      await Reader.methods.loadEbookProgress.call(context)
      return context.selectedEbookProgress
    }

    expect(await open(null)).to.equal(records[0])
    expect(await open('pdf-1')).to.equal(records[1])

    item.media.ebookFile = pdf
    expect(await open(null)).to.equal(records[1])
    expect(await open('epub-1')).to.equal(records[0])
    expect(records.map((record) => record.positionValue)).to.deep.equal(['epubcfi(/6/8)', '29'])
  })

  it('keeps generated EPUB locations separate for every ebook file', () => {
    const firstKey = EpubReader.computed.localStorageLocationsKey.call({ libraryItemId: 'item-1', fileIno: 'epub-1' })
    const secondKey = EpubReader.computed.localStorageLocationsKey.call({ libraryItemId: 'item-1', fileIno: 'epub-2' })
    expect(firstKey).to.equal('ebookLocations-item-1-epub-1')
    expect(secondKey).to.equal('ebookLocations-item-1-epub-2')
  })

  it('uses the current primary file for the item-page label and percentage', () => {
    const records = [
      { fileIno: 'epub-1', progress: 0.2, displayLabel: 'Chapter Two' },
      { fileIno: 'pdf-1', progress: 0.6, displayLabel: 'Page 60 of 100' }
    ]
    const context = { ebookFile: { ino: 'epub-1' }, ebookProgress: records }

    context.primaryEbookProgress = ItemPage.computed.primaryEbookProgress.call(context)
    expect(context.primaryEbookProgress).to.equal(records[0])
    expect(ItemPage.computed.progressPercent.call({ primaryEbookProgress: context.primaryEbookProgress, userMediaProgress: null, useEBookProgress: true })).to.equal(0.2)

    context.ebookFile = { ino: 'pdf-1' }
    context.primaryEbookProgress = ItemPage.computed.primaryEbookProgress.call(context)
    expect(context.primaryEbookProgress).to.equal(records[1])
    expect(ItemPage.computed.progressPercent.call({ primaryEbookProgress: context.primaryEbookProgress, userMediaProgress: null, useEBookProgress: true })).to.equal(0.6)
  })

  it('uses primary ebook progress on book cards and falls back for supplementary-only progress', () => {
    const primary = { fileIno: 'epub-1', progress: 0.2, updatedAt: '2025-01-01T00:00:00.000Z' }
    const supplementary = { fileIno: 'pdf-1', progress: 0.6, updatedAt: '2025-02-01T00:00:00.000Z' }
    const context = { _libraryItem: { media: { ebookFile: { ino: 'epub-1' } }, ebookProgress: [primary, supplementary] } }

    expect(LazyBookCard.computed.ebookProgressRecord.call(context)).to.equal(primary)

    context._libraryItem.ebookProgress = [supplementary]
    expect(LazyBookCard.computed.ebookProgressRecord.call(context)).to.equal(supplementary)
  })

  it('routes both MOBI and AZW3 through the text-offset reader', () => {
    expect(Reader.computed.isMobi.call({ ebookFormat: 'mobi' })).to.equal(true)
    expect(Reader.computed.isMobi.call({ ebookFormat: 'azw3' })).to.equal(true)
  })

  it('replaces item-page progress by file inode when an upsert returns a different id', () => {
    const previous = { id: 'progress-old', libraryItemId: 'item-1', fileIno: 'pdf-1', progress: 0.02, displayLabel: 'Page 29 of 1642' }
    const updated = { id: 'progress-new', libraryItemId: 'item-1', fileIno: 'pdf-1', progress: 0.25, displayLabel: 'Page 411 of 1642' }
    const context = {
      libraryItemId: 'item-1',
      ebookProgress: [previous],
      $set(target, index, value) {
        target.splice(index, 1, value)
      }
    }

    ItemPage.methods.ebookProgressUpdated.call(context, updated)

    expect(context.ebookProgress).to.deep.equal([updated])
  })

  it('keeps an ambiguous legacy position unassigned when the user declines', async () => {
    const context = {
      ebookProgressLoaded: true,
      ebookProgressRecords: [],
      selectedEbookProgress: null,
      selectedLibraryItem: { id: 'item-1' },
      ebookFileIno: 'pdf-1',
      $axios: { $get: cy.stub().resolves({ ebookProgress: [] }) },
      legacyProgressForSelectedFile: () => ({ ambiguous: true, positionType: 'page', positionValue: '14' }),
      confirmLegacyAssignment: cy.stub().resolves(false)
    }

    await Reader.methods.loadEbookProgress.call(context)

    expect(context.confirmLegacyAssignment).to.have.been.calledOnce
    expect(context.selectedEbookProgress).to.equal(null)
    expect(context.ebookProgressLoaded).to.equal(true)
  })

  it('warns when a saved position cannot be used by the selected reader', () => {
    const warning = cy.stub()
    Reader.methods.positionRejected.call({ $toast: { warning }, $strings: { MessageEbookPositionNotApplicable: 'Position unavailable' } })
    expect(warning).to.have.been.calledOnceWith('Position unavailable')
  })

  it('EPUB accepts CFI and rejects page positions without initialization saves', () => {
    cy.mount(EpubReader, {
      propsData: { libraryItem, fileIno: 'epub-1', keepProgress: true, ebookProgress: { positionType: 'epub-cfi', positionValue: 'epubcfi(/6/2)' } },
      mocks,
      methods: { initEpub() {} }
    }).then(() => {
      const wrapper = Cypress.vueWrapper
      expect(wrapper.vm.savedEbookLocation).to.equal('epubcfi(/6/2)')
      wrapper.vm.updateProgress({ positionType: 'epub-cfi', positionValue: 'epubcfi(/6/4)', progress: 0.2, displayLabel: 'Chapter 2' })
      expect(mocks.$axios.$put).not.to.have.been.called
    })

    cy.mount(EpubReader, {
      propsData: { libraryItem, fileIno: 'epub-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '14' } },
      mocks,
      methods: { initEpub() {} }
    }).then(() => expect(Cypress.vueWrapper.vm.savedEbookLocation).to.equal(null))

    cy.mount(EpubReader, {
      propsData: { libraryItem, fileIno: 'epub-1', keepProgress: true, ebookProgress: { positionType: 'epub-cfi', positionValue: 'epubcfi(' } },
      mocks,
      methods: { initEpub() {} }
    }).then(() => {
      const wrapper = Cypress.vueWrapper
      expect(wrapper.vm.savedEbookLocation).to.equal(null)
      expect(mocks.$axios.$put).not.to.have.been.called
    })
  })

  it('PDF accepts valid pages and rejects EPUB CFI', () => {
    cy.mount(PdfReader, {
      propsData: { libraryItem, fileIno: 'pdf-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '14' } },
      mocks,
      stubs: { pdf: true },
      methods: { init() {} }
    }).then(() => expect(Cypress.vueWrapper.vm.savedPage).to.equal(14))

    cy.mount(PdfReader, {
      propsData: { libraryItem, fileIno: 'pdf-1', keepProgress: true, ebookProgress: { positionType: 'epub-cfi', positionValue: 'epubcfi(/6/2)' } },
      mocks,
      stubs: { pdf: true },
      methods: { init() {} }
    }).then(() => {
      const wrapper = Cypress.vueWrapper
      expect(wrapper.vm.savedPage).to.equal(0)
      wrapper.vm.numPages = 20
      wrapper.vm.updateProgress()
      expect(mocks.$axios.$put).not.to.have.been.called
    })
  })

  it('rejects a PDF page outside the loaded document without overwriting it', () => {
    const updateProgress = cy.stub()
    const rejected = cy.stub()
    const context = {
      restorationAttempted: false,
      documentLoaded: true,
      numPages: 20,
      savedPage: 29,
      ebookProgress: { positionType: 'page', positionValue: '29' },
      page: 1,
      canSaveProgress: false,
      updateProgress,
      $emit: rejected
    }

    PdfReader.methods.tryRestorePage.call(context)

    expect(context.page).to.equal(1)
    expect(context.canSaveProgress).to.equal(true)
    expect(rejected).to.have.been.calledOnceWith('position-rejected')
    expect(updateProgress).not.to.have.been.called
  })

  it('marks a successful legacy restore for one-time conversion', () => {
    cy.mount(PdfReader, {
      propsData: { libraryItem, fileIno: 'pdf-1', keepProgress: true, ebookProgress: { legacy: true, positionType: 'page', positionValue: '14' } },
      mocks,
      stubs: { pdf: true },
      methods: { init() {} }
    }).then(() => {
      const wrapper = Cypress.vueWrapper
      wrapper.vm.page = 14
      wrapper.vm.numPages = 20
      wrapper.vm.canSaveProgress = true
      wrapper.vm.updateProgress(true)
      expect(mocks.$axios.$put).to.have.been.calledWith(
        '/api/me/ebook-progress/item-1/pdf-1',
        { positionType: 'page', positionValue: '14', progress: 13 / 19, displayLabel: 'Page 14 of 20', migrateLegacy: true },
        { progress: false }
      )
    })
  })

  it('MOBI restores stable text offsets and rejects page positions', () => {
    cy.mount(MobiReader, {
      propsData: { libraryItem, fileIno: 'mobi-1', keepProgress: true, ebookProgress: { positionType: 'text-offset', positionValue: '12' } },
      mocks,
      methods: { initMobi() {}, handleIFrameHeight() {} }
    }).then(async () => {
      const wrapper = Cypress.vueWrapper
      expect(wrapper.vm.savedTextOffset).to.equal(12)
      const doc = wrapper.vm.$refs.iframe.contentDocument
      doc.body.innerHTML = '<h1>Chapter One</h1><p>Alpha beta gamma delta.</p>'
      wrapper.vm.contentLength = wrapper.vm.getTextNodes().reduce((length, node) => length + node.textContent.length, 0)
      expect(wrapper.vm.restoreTextOffset(12)).to.equal(true)
      expect(wrapper.vm.currentTextOffset).to.equal(12)

      doc.body.style.fontSize = '24px'
      expect(wrapper.vm.restoreTextOffset(wrapper.vm.currentTextOffset)).to.equal(true)
      expect(wrapper.vm.currentTextOffset).to.equal(12)

      await wrapper.setProps({ ebookProgress: { positionType: 'page', positionValue: '2' } })
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.savedTextOffset).to.equal(null)
    })
  })

  it('MOBI saves a text offset that a recreated reader can restore', () => {
    cy.mount(MobiReader, {
      propsData: { libraryItem, fileIno: 'mobi-1', keepProgress: true },
      mocks,
      methods: { initMobi() {}, handleIFrameHeight() {}, getTextOffsetAtScroll: () => 12, headingForOffset: () => 'Chapter One' }
    }).then(() => {
      const wrapper = Cypress.vueWrapper
      const doc = wrapper.vm.$refs.iframe.contentDocument
      doc.body.innerHTML = '<h1>Chapter One</h1><p>Alpha beta gamma delta.</p>'
      wrapper.vm.contentLength = wrapper.vm.getTextNodes().reduce((length, node) => length + node.textContent.length, 0)
      wrapper.vm.canSaveProgress = true
      wrapper.vm.updateProgress()
      expect(mocks.$axios.$put).to.have.been.calledWith(
        '/api/me/ebook-progress/item-1/mobi-1',
        { positionType: 'text-offset', positionValue: '12', progress: 12 / wrapper.vm.contentLength, displayLabel: 'Chapter One' },
        { progress: false }
      )
      expect(wrapper.vm.restoreTextOffset(12)).to.equal(true)
      expect(wrapper.vm.currentTextOffset).to.equal(12)
    })
  })

  it('MOBI expands its iframe to the full document height', () => {
    const body = { scrollHeight: 1800, offsetHeight: 1700, style: {} }
    const documentElement = { scrollHeight: 1750, offsetHeight: 1600, style: {} }
    const iframe = { style: {}, contentDocument: { body, documentElement } }

    MobiReader.methods.handleIFrameHeight.call({ $refs: { viewer: { clientHeight: 700 } } }, iframe)

    expect(iframe.style.height).to.equal('1800px')
    expect(body.style.overflow).to.equal('hidden')
    expect(documentElement.style.overflow).to.equal('hidden')
  })

  it('MOBI restores the same text offset after a window resize', () => {
    const iframe = {}
    const handleIFrameHeight = cy.stub()
    const restoreTextOffset = cy.stub()
    const context = {
      resizeTimer: null,
      currentTextOffset: 12,
      $refs: { iframe },
      $nextTick: (callback) => callback(),
      handleIFrameHeight,
      restoreTextOffset
    }

    cy.clock()
    cy.then(() => MobiReader.methods.resize.call(context))
    cy.tick(100)
    cy.then(() => {
      expect(handleIFrameHeight).to.have.been.calledOnceWith(iframe)
      expect(restoreTextOffset).to.have.been.calledOnceWith(12)
    })
  })

  it('publishes a completed save after the reader starts closing', () => {
    const record = { id: 'progress-1', libraryItemId: 'item-1', fileIno: 'mobi-1', progress: 0.4, displayLabel: 'Chapter One' }
    const localEmit = cy.stub()
    const globalEmit = cy.stub()
    const put = cy.stub().resolves(record)
    const context = {
      keepProgress: true,
      canSaveProgress: true,
      libraryItemId: 'item-1',
      fileIno: 'mobi-1',
      contentLength: 100,
      currentTextOffset: 0,
      getTextOffsetAtScroll: () => 40,
      headingForOffset: () => 'Chapter One',
      $axios: { $put: put },
      $emit: localEmit,
      $eventBus: { $emit: globalEmit }
    }

    return MobiReader.methods.updateProgress.call(context).then(() => {
      expect(localEmit).to.have.been.calledOnceWith('ebook-progress', record)
      expect(globalEmit).to.have.been.calledOnceWith('ebook-progress-updated', record)
    })
  })

  it('MOBI flushes a pending supplementary-file save when closed', () => {
    const updateProgress = cy.stub()
    const context = { scrollTimer: setTimeout(() => {}, 1000), updateProgress }
    MobiReader.methods.flushPendingProgress.call(context)
    expect(context.scrollTimer).to.equal(null)
    expect(updateProgress).to.have.been.calledOnce
  })

  it('comic accepts an integer page and rejects malformed pages', () => {
    cy.mount(ComicReader, {
      propsData: { libraryItem, fileIno: 'comic-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '3' } },
      mocks,
      methods: { extract() {} }
    }).then(() => expect(Cypress.vueWrapper.vm.savedPage).to.equal(3))

    cy.mount(ComicReader, {
      propsData: { libraryItem, fileIno: 'comic-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '3.5' } },
      mocks,
      methods: { extract() {} }
    }).then(() => expect(Cypress.vueWrapper.vm.savedPage).to.equal(0))
  })
})
