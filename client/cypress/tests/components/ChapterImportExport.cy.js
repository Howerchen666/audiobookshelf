import ChaptersPage from '@/pages/audiobook/_id/chapters.vue'

const saved = [
  { id: 0, title: 'First', start: 0, end: 10 },
  { id: 1, title: 'Second', start: 10, end: 60 }
]

const Button = {
  props: ['disabled'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
}

const Modal = {
  props: ['value', 'name'],
  template: '<div v-if="value" :data-cy="name" role="dialog"><slot name="outer" /><slot /></div>'
}

const FileInput = {
  template: '<div><slot /></div>',
  methods: { reset() {} }
}

function mountEditor() {
  const post = cy.stub().resolves({ updated: false }).as('postChapters')
  const download = cy.stub().as('downloadChapters')
  const toastError = cy.stub().as('chapterError')
  const Editor = {
    ...ChaptersPage,
    data() {
      return {
        ...ChaptersPage.data(),
        libraryItem: {
          id: 'book-1',
          mediaType: 'book',
          media: { duration: 60, chapters: saved.map((chapter) => ({ ...chapter })), tracks: [], audioFiles: [], metadata: { title: 'Test Book' } }
        }
      }
    }
  }

  cy.mount(Editor, {
    stubs: {
      'nuxt-link': { template: '<a><slot /></a>' },
      'ui-btn': Button,
      'ui-file-input': FileInput,
      'modals-modal': Modal,
      'ui-tooltip': { template: '<span><slot /></span>' },
      'ui-text-input': { props: ['value'], template: '<input :value="value" @input="$emit(\'input\', $event.target.value)" @change="$emit(\'change\')" @blur="$emit(\'blur\')" />' },
      'ui-time-picker': { props: ['value'], template: '<input :value="value" />' },
      'ui-checkbox': { template: '<input type="checkbox" />' }
    },
    mocks: {
      $store: { state: { streamLibraryItem: null }, getters: { 'user/getToken': 'test-token' }, commit() {} },
      $eventBus: { $on() {}, $off() {} },
      $axios: { $post: post },
      $downloadFile: download,
      $toast: { error: toastError, warning() {}, info() {}, success() {} }
    }
  })
}

function importJson(chapters) {
  return cy.then(() => Cypress.vueWrapper.vm.importChapterFile({ text: () => Promise.resolve(JSON.stringify({ version: 1, chapters })) }))
}

describe('chapter import/export editor state', () => {
  beforeEach(mountEditor)

  it('rejects a schema error before opening Preview and keeps locks and saved chapters', () => {
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      editor.toggleChapterLock(editor.newChapters[1], { shiftKey: false })
      return editor.importChapterFile({ text: () => Promise.resolve('{"version":1,"chapters":[]}') })
    })
    cy.get('[data-cy="import-chapters"]').should('not.exist')
    cy.get('@chapterError').should('have.been.calledOnce')
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      expect(editor.newChapters.map(({ title, start }) => ({ title, start }))).to.deep.equal([{ title: 'First', start: 0 }, { title: 'Second', start: 10 }])
      expect(editor.lockedChapters.has(1)).to.equal(true)
    })
  })

  it('shows a duration error in Preview, disables Apply, and lets Cancel preserve the draft', () => {
    importJson([{ title: 'First', start: 0 }, { title: 'Too late', start: 60 }])
    cy.get('[data-cy="import-chapters"]').should('contain', 'Too late')
    cy.get('[data-cy="import-chapters"]').should('contain', 'Invalid start time must be less than audiobook duration')
    cy.get('[data-cy="import-chapters"] button').contains('Apply Chapters').should('be.disabled')
    cy.get('[data-cy="import-chapters"] button').contains('Cancel').click()
    cy.get('[data-cy="import-chapters"]').should('not.exist')
    cy.then(() => expect(Cypress.vueWrapper.vm.newChapters[1].title).to.equal('Second'))
    cy.get('@postChapters').should('not.have.been.called')
  })

  it('applies a valid replacement, clears locks, and waits for the ordinary Save to post derived ends', () => {
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      editor.toggleChapterLock(editor.newChapters[1], { shiftKey: false })
    })
    importJson([{ title: '第一章', start: 0 }, { title: 'Café 日本語', start: 20 }])
    cy.get('[data-cy="import-chapters"]').should('contain', 'Café 日本語')
    cy.get('@postChapters').should('not.have.been.called')
    cy.get('[data-cy="import-chapters"] button').contains('Apply Chapters').click()
    cy.get('[data-cy="import-chapters"]').should('not.exist')
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      expect(editor.newChapters.map(({ title, start }) => ({ title, start }))).to.deep.equal([{ title: '第一章', start: 0 }, { title: 'Café 日本語', start: 20 }])
      expect(editor.lockedChapters.size).to.equal(0)
    })
    cy.get('@postChapters').should('not.have.been.called')
    cy.get('button[aria-label="Undo"]').click()
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      expect(editor.newChapters.map(({ title, start }) => ({ title, start }))).to.deep.equal([{ title: 'First', start: 0 }, { title: 'Second', start: 10 }])
      expect(editor.lockedChapters.has(1)).to.equal(true)
    })
    cy.get('button[aria-label="Redo"]').click()
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      expect(editor.newChapters.map(({ title, start }) => ({ title, start }))).to.deep.equal([{ title: '第一章', start: 0 }, { title: 'Café 日本語', start: 20 }])
      expect(editor.lockedChapters.size).to.equal(0)
    })
    cy.get('@postChapters').should('not.have.been.called')
    cy.contains('button', 'Save').click()
    cy.get('@postChapters').should('have.been.calledOnce')
    cy.get('@postChapters').its('firstCall.args.1.chapters').should((chapters) => {
      expect(chapters.map(({ title, start, end }) => ({ title, start, end }))).to.deep.equal([
        { title: '第一章', start: 0, end: 20 },
        { title: 'Café 日本語', start: 20, end: 60 }
      ])
    })
  })

  it('prompts before exporting an unsaved draft; Cancel does nothing and Confirm downloads without saving', () => {
    cy.then(() => {
      const editor = Cypress.vueWrapper.vm
      editor.newChapters[1].title = 'Unsaved title'
      editor.checkChapters(false)
    })
    cy.contains('button', 'Export JSON').first().click()
    cy.get('[data-cy="export-chapters"]').should('contain', 'Export unsaved draft?')
    cy.get('[data-cy="export-chapters"] button').contains('Cancel').click()
    cy.get('@downloadChapters').should('not.have.been.called')
    cy.get('@postChapters').should('not.have.been.called')
    cy.contains('button', 'Export JSON').first().click()
    cy.get('[data-cy="export-chapters"] button').contains('Export JSON').click()
    cy.get('@downloadChapters').should('have.been.calledOnce')
    cy.get('@postChapters').should('not.have.been.called')
  })
})
