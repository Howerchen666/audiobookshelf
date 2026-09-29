import EpubReader from '@/components/readers/EpubReader.vue'
import PdfReader from '@/components/readers/PdfReader.vue'
import ComicReader from '@/components/readers/ComicReader.vue'
import MobiReader from '@/components/readers/MobiReader.vue'
import Reader from '@/components/readers/Reader.vue'

const libraryItem = { id: 'item-1' }
const mocks = {
  $store: { getters: { 'libraries/getLibraryEpubsAllowScriptedContent': false, 'user/getToken': 'token' } },
  $axios: { $put: cy.stub().as('putProgress') },
  $getString: (key, values) => `Page ${values[0]} of ${values[1]}`
}

function legacyProgress(location, files, selectedIno, progress = 0.3) {
  return Reader.methods.legacyProgressForSelectedFile.call({
    $store: { getters: { 'user/getUserMediaProgress': () => ({ ebookLocation: location, ebookProgress: progress }) } },
    selectedLibraryItem: { id: 'item-1', libraryFiles: files },
    ebookFileIno: selectedIno
  })
}

describe('per-file ebook position compatibility', () => {
  beforeEach(() => mocks.$axios.$put.resetHistory())


  it('classifies legacy locations without guessing between compatible files', () => {
    const epub = { ino: 'epub-1', fileType: 'ebook', metadata: { ext: '.epub' } }
    const pdf = { ino: 'pdf-1', fileType: 'ebook', metadata: { ext: '.pdf' } }
    const secondPdf = { ino: 'pdf-2', fileType: 'ebook', metadata: { ext: '.pdf' } }

    expect(legacyProgress('epubcfi(/6/2)', [epub, pdf], 'epub-1')).to.include({ positionType: 'epub-cfi', ambiguous: false })
    expect(legacyProgress('14', [epub, pdf, secondPdf], 'pdf-1')).to.include({ positionType: 'page', ambiguous: true })
    expect(legacyProgress('not-a-position', [epub, pdf], 'epub-1')).to.equal(null)
    expect(legacyProgress('14', [epub, pdf], 'epub-1')).to.equal(null)
  })

  it('EPUB accepts CFI and rejects page positions without initialization saves', () => {
    cy.mount(EpubReader, {
      propsData: { libraryItem, fileIno: 'epub-1', keepProgress: true, ebookProgress: { positionType: 'epub-cfi', positionValue: 'epubcfi(/6/2)' } },
      mocks,
      methods: { initEpub() {} }
    }).then((wrapper) => {
      expect(wrapper.vm.savedEbookLocation).to.equal('epubcfi(/6/2)')
      wrapper.vm.updateProgress({ positionType: 'epub-cfi', positionValue: 'epubcfi(/6/4)', progress: 0.2, displayLabel: 'Chapter 2' })
      expect(mocks.$axios.$put).not.to.have.been.called
    })

    cy.mount(EpubReader, {
      propsData: { libraryItem, fileIno: 'epub-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '14' } },
      mocks,
      methods: { initEpub() {} }
    }).then((wrapper) => expect(wrapper.vm.savedEbookLocation).to.equal(null))
  })

  it('PDF accepts valid pages and rejects EPUB CFI', () => {
    cy.mount(PdfReader, {
      propsData: { libraryItem, fileIno: 'pdf-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '14' } },
      mocks,
      stubs: { pdf: true },
      methods: { init() {} }
    }).then((wrapper) => expect(wrapper.vm.savedPage).to.equal(14))

    cy.mount(PdfReader, {
      propsData: { libraryItem, fileIno: 'pdf-1', keepProgress: true, ebookProgress: { positionType: 'epub-cfi', positionValue: 'epubcfi(/6/2)' } },
      mocks,
      stubs: { pdf: true },
      methods: { init() {} }
    }).then((wrapper) => {
      expect(wrapper.vm.savedPage).to.equal(0)
      wrapper.vm.numPages = 20
      wrapper.vm.updateProgress()
      expect(mocks.$axios.$put).not.to.have.been.called
    })
  })


  it('MOBI restores stable text offsets and rejects page positions', () => {
    cy.mount(MobiReader, {
      propsData: { libraryItem, fileIno: 'mobi-1', keepProgress: true, ebookProgress: { positionType: 'text-offset', positionValue: '12' } },
      mocks,
      methods: { initMobi() {}, handleIFrameHeight() {} }
    }).then(async (wrapper) => {
      expect(wrapper.vm.savedTextOffset).to.equal(12)
      const doc = wrapper.vm.$refs.iframe.contentDocument
      doc.body.innerHTML = '<h1>Chapter One</h1><p>Alpha beta gamma delta.</p>'
      wrapper.vm.contentLength = wrapper.vm.getTextNodes().reduce((length, node) => length + node.textContent.length, 0)
      expect(wrapper.vm.restoreTextOffset(12)).to.equal(true)
      expect(wrapper.vm.currentTextOffset).to.equal(12)

      doc.body.style.fontSize = '24px'
      expect(wrapper.vm.restoreTextOffset(wrapper.vm.currentTextOffset)).to.equal(true)
      expect(wrapper.vm.currentTextOffset).to.equal(12)

      wrapper.setProps({ ebookProgress: { positionType: 'page', positionValue: '2' } })
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.savedTextOffset).to.equal(null)
    })
  })

  it('comic accepts an integer page and rejects malformed pages', () => {
    cy.mount(ComicReader, {
      propsData: { libraryItem, fileIno: 'comic-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '3' } },
      mocks,
      methods: { extract() {} }
    }).then((wrapper) => expect(wrapper.vm.savedPage).to.equal(3))

    cy.mount(ComicReader, {
      propsData: { libraryItem, fileIno: 'comic-1', keepProgress: true, ebookProgress: { positionType: 'page', positionValue: '3.5' } },
      mocks,
      methods: { extract() {} }
    }).then((wrapper) => expect(wrapper.vm.savedPage).to.equal(0))
  })
})
