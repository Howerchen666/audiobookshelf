const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

// Exercise the actual page methods without requiring a Nuxt server or browser.
const domainSource = fs.readFileSync(path.join(__dirname, '../lib/chapterList.js'), 'utf8')
const chapterDomain = vm.runInNewContext(domainSource.replaceAll('export ', '') + '\n;({ parseChapterList, validateChapters, serializeChapterList, ChapterError })')
const source = fs.readFileSync(path.join(__dirname, '../pages/audiobook/_id/chapters.vue'), 'utf8').split('<script>')[1].split('</script>')[0]
const page = vm.runInNewContext(source.replace("import path from 'path'", '').replace("import { parseChapterList, validateChapters, serializeChapterList, ChapterError } from '../../../lib/chapterList'", 'const { parseChapterList, validateChapters, serializeChapterList, ChapterError } = chapterDomain').replace('export default', 'module.exports ='), { module: {}, Set, Number, JSON, path, chapterDomain })
function editor() {
  const instance = Object.assign(page.data(), {
    chapters: [{ id: 0, start: 0, end: 10, title: 'First' }, { id: 1, start: 10, end: 20, title: 'Second' }, { id: 2, start: 20, end: 60, title: 'Third' }],
    mediaDuration: 60,
    $strings: { MessageChapterErrorFirstNotZero: 'first', MessageChapterErrorStartLtPrev: 'order', MessageChapterErrorStartGteDuration: 'duration', MessageChapterErrorTitleEmpty: 'title', MessageChapterErrorStartInvalid: 'invalid' },
    $toast: { warning() {}, success() {} }
  })
  for (const [name, method] of Object.entries(page.methods)) instance[name] = method.bind(instance)
  for (const name of ['canUndo', 'canRedo', 'allChaptersLocked']) Object.defineProperty(instance, name, { get: page.computed[name].bind(instance) })
  instance.initChapters()
  return instance
}

test('field edits commit as one operation; undo/redo preserves other edits and clears a new branch', () => {
  const e = editor()
  e.newChapters[0].title = 'Renamed'
  e.checkChapters(false)
  e.newChapters[0].title = 'Renamed again'
  e.commitChapterEdit()
  assert.equal(e.chapterHistory.length, 2)
  e.incrementChapterTime(e.newChapters[1], 1)
  e.undoChapters()
  assert.equal(e.newChapters[0].title, 'Renamed again')
  assert.equal(e.newChapters[1].start, 10)
  e.redoChapters()
  assert.equal(e.newChapters[1].start, 11)
  e.undoChapters()
  e.incrementChapterTime(e.newChapters[2], 1)
  assert.equal(e.canRedo, false)
})

test('insertion/deletion restore numbering, derived ends, errors, and lock associations', () => {
  const e = editor()
  e.toggleChapterLock(e.newChapters[2], { shiftKey: false })
  e.addChapter(e.newChapters[0])
  assert.equal(e.lockedChapters.has(3), true)
  assert.equal(e.newChapters[1].error, 'title; order')
  e.undoChapters()
  assert.equal(e.newChapters.length, 3)
  assert.equal(e.newChapters[0].end, 10)
  assert.equal(e.lockedChapters.has(2), true)
  e.redoChapters()
  assert.equal(e.newChapters[1].error, 'title; order')
  e.removeChapter(e.newChapters[1])
  assert.equal(e.lockedChapters.has(2), true)
  assert.deepEqual(Array.from(e.newChapters, (c) => c.id), [0, 1, 2])
  assert.equal(e.newChapters[1].error, null)
  e.undoChapters()
  assert.equal(e.lockedChapters.has(3), true)
  assert.equal(e.newChapters[1].error, 'title; order')
})

test('bulk shifts are atomic, respect locks, and leave playback untouched', () => {
  const e = editor()
  e.toggleChapterLock(e.newChapters[2], { shiftKey: false })
  const audio = { currentTime: 25 }
  e.audioEl = audio
  e.elapsedTime = 5
  e.shiftAmount = 3
  const length = e.chapterHistory.length
  e.shiftChapterTimes()
  assert.equal(e.chapterHistory.length, length + 1)
  assert.equal(e.newChapters[1].start, 13)
  assert.equal(e.newChapters[2].start, 20)
  e.undoChapters()
  assert.equal(e.newChapters[1].start, 10)
  assert.equal(e.newChapters[0].end, 10)
  assert.equal(e.audioEl, audio)
  assert.equal(e.elapsedTime, 5)
})

test('history is bounded, independent snapshots survive restoration, and reset clears history', () => {
  const e = editor()
  for (let i = 0; i < 120; i++) {
    e.newChapters[0].title = `Edit ${i}`
    e.commitChapterEdit()
  }
  assert.equal(e.chapterHistory.length, 101)
  e.undoChapters()
  e.newChapters[0].title = 'Uncommitted'
  assert.equal(e.chapterHistory[e.chapterHistoryIndex].chapters[0].title, 'Edit 118')
  e.initChapters()
  assert.equal(e.canUndo, false)
  assert.equal(e.canRedo, false)
  assert.equal(e.hasChanges, false)
})

test('lookup acceptance and remove-all each form one undoable draft operation', () => {
  const e = editor()
  e.chapterData = { chapters: [{ startOffsetSec: 0, startOffsetMs: 0, lengthMs: 60000, title: 'Imported' }] }
  e.applyChapterData()
  assert.equal(e.chapterHistory.length, 2)
  e.undoChapters()
  assert.equal(e.newChapters.length, 3)
  e.removeAllChapters()
  assert.equal(e.newChapters.length, 0)
  e.undoChapters()
  assert.equal(e.newChapters.length, 3)
})

test('non-finite times remain invalid after undo and redo', () => {
  const e = editor()
  e.newChapters[1].start = 'invalid'
  e.commitChapterEdit()
  assert.equal(e.newChapters[1].error, 'invalid')
  e.undoChapters()
  assert.equal(e.newChapters[1].error, null)
  e.redoChapters()
  assert.equal(e.newChapters[1].error, 'invalid')
})

test('successful save resets history; failed save retains undo', async () => {
  for (const fail of [false, true]) {
    const e = editor()
    e.libraryItem = { id: 'book' }
    e.$strings.ToastChapterStartTimeAdjusted = ''
    e.$toast.info = () => {}
    e.$toast.error = () => {}
    e.$axios = { $post: () => fail ? Promise.reject(new Error('expected')) : Promise.resolve({ updated: false }) }
    e.incrementChapterTime(e.newChapters[1], 1)
    e.saveChapters()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(e.canUndo, fail)
    assert.equal(e.saving, false)
  }
})

test('shortcuts support undo/redo and preserve input and modal editing', () => {
  const e = editor()
  e.incrementChapterTime(e.newChapters[1], 1)
  let prevented = 0
  const event = { ctrlKey: true, key: 'z', target: { closest: () => null }, preventDefault: () => prevented++, stopPropagation() {} }
  e.historyKeydown(event)
  assert.equal(e.newChapters[1].start, 10)
  e.historyKeydown({ ...event, key: 'y' })
  assert.equal(e.newChapters[1].start, 11)
  e.historyKeydown({ ...event, target: { closest: () => ({}) } })
  e.showFindChaptersModal = true
  e.historyKeydown(event)
  assert.equal(e.newChapters[1].start, 11)
  assert.equal(prevented, 2)
})

test('opening a different book initializes a fresh baseline', () => {
  const e = editor()
  e.incrementChapterTime(e.newChapters[1], 1)
  e.chapters = [{ id: 0, title: 'Other book', start: 0, end: 60 }]
  e.$eventBus = { $on() {}, $off() {} }
  e.mediaMetadata = {}
  page.watch['libraryItem.id'].call(e, 'new-book', 'old-book')
  assert.equal(e.newChapters[0].title, 'Other book')
  assert.equal(e.canUndo, false)
  assert.equal(e.canRedo, false)
})

test('an action commits pending text separately even when its button prevents blur', () => {
  const e = editor()
  e.newChapters[0].title = 'Pending title'
  assert.equal(e.canUndo, true)
  e.shiftAmount = 2
  e.shiftChapterTimes()
  e.undoChapters()
  assert.equal(e.newChapters[0].title, 'Pending title')
  assert.equal(e.newChapters[1].start, 10)
  e.undoChapters()
  assert.equal(e.newChapters[0].title, 'First')
})

test('time picker emits one blur boundary and ignores shortcut modifiers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/ui/TimePicker.vue'), 'utf8').split('<script>')[1].split('</script>')[0]
  const picker = vm.runInNewContext(source.replace('export default', 'module.exports ='), { module: {} })
  let blurs = 0
  const instance = { focusedDigit: 'second0', removeListeners() {}, $emit(name) { if (name === 'blur') blurs++ } }
  picker.methods.removeFocus.call(instance)
  picker.methods.removeFocus.call(instance)
  assert.equal(blurs, 1)
  instance.focusedDigit = 'second0'
  picker.methods.keydown.call(instance, { key: 'z', ctrlKey: true })
  assert.equal(instance.focusedDigit, 'second0')
})

test('import rejects schema errors, previews business errors, and resets the file input', async () => {
  const e = editor()
  let resets = 0
  e.$refs = { chapterFileInput: { reset() { resets++ } } }
  e.$toast.error = () => {}
  await e.importChapterFile({ text: async () => '{"version":1,"chapters":[]}' })
  assert.equal(e.showImportPreview, false)
  assert.equal(e.newChapters[0].title, 'First')
  await e.importChapterFile({ text: async () => '{"version":1,"chapters":[{"title":"A","start":1}]}' })
  assert.equal(e.showImportPreview, true)
  assert.equal(e.importErrors[0].codes[0], 'FIRST_NOT_ZERO')
  e.applyChapterImport()
  assert.equal(e.newChapters[0].title, 'First')
  e.cancelChapterImport()
  assert.equal(e.newChapters[0].title, 'First')
  assert.equal(resets, 2)
})

test('valid import replaces draft in one undo step, clears locks, and leaves persistence alone', async () => {
  const e = editor()
  e.$refs = { chapterFileInput: { reset() {} } }
  let posts = 0
  e.$axios = { $post() { posts++ } }
  e.toggleChapterLock(e.newChapters[1], { shiftKey: false })
  const before = e.chapterHistory.length
  await e.importChapterFile({ text: async () => '{"version":1,"chapters":[{"title":"第一章","start":0},{"title":"Café","start":3.5}]}' })
  e.applyChapterImport()
  assert.equal(e.showImportPreview, false)
  assert.deepEqual(Array.from(e.newChapters, (c) => c.start), [0, 3.5])
  assert.equal(e.newChapters[1].end, 60)
  assert.equal(e.lockedChapters.size, 0)
  assert.equal(posts, 0)
  assert.equal(e.chapterHistory.length, before + 1)
  e.undoChapters()
  assert.equal(e.newChapters.length, 3)
  assert.equal(e.lockedChapters.has(1), true)
  assert.equal(e.newChapters[1].title, 'Second')
  e.redoChapters()
  assert.deepEqual(Array.from(e.newChapters, (c) => [c.title, c.start]), [['第一章', 0], ['Café', 3.5]])
  assert.equal(e.lockedChapters.size, 0)
  assert.equal(posts, 0)
})

test('export confirms unsaved valid drafts, blocks invalid drafts, and never saves', () => {
  const e = editor()
  let downloads = 0
  e.downloadChapterList = () => { downloads++ }
  e.$toast.error = () => {}
  e.newChapters[1].start = 0
  e.exportChapters()
  assert.equal(downloads, 0)
  assert.equal(e.showExportConfirm, false)
  e.newChapters[1].start = 10
  e.newChapters[1].title = 'Edited'
  e.exportChapters()
  assert.equal(e.showExportConfirm, true)
  e.showExportConfirm = false
  assert.equal(downloads, 0)
  e.exportChapters()
  e.confirmChapterExport()
  assert.equal(downloads, 1)
  assert.equal(e.showExportConfirm, false)
  e.initChapters()
  e.exportChapters()
  assert.equal(downloads, 2)
})

test('schema rejects extra fields, string times, empty lists, and malformed JSON', () => {
  const bad = ['{', '{}', '{"version":1,"chapters":[]}', '{"version":"1","chapters":[{"title":"A","start":0}]}', '{"version":1,"chapters":[{"title":"A","start":"0"}]}', '{"version":1,"chapters":[{"title":"A","start":0,"end":1}]}', '{"version":1,"chapters":[{"title":"A","start":0}],"extra":true}']
  for (const source of bad) assert.ok(chapterDomain.parseChapterList(source).error)
})

test('manual and JSON paths share row errors and save imported end times for this book', async () => {
  const e = editor()
  e.newChapters = [{ title: ' ', start: '0' }, { title: 'B', start: '0' }]
  e.checkChapters(false)
  const manualErrors = e.newChapters.map((c) => c.error)
  const imported = chapterDomain.parseChapterList('{"version":1,"chapters":[{"title":" ","start":0},{"title":"B","start":0}]}').chapters
  e.importErrors = chapterDomain.validateChapters(imported, e.mediaDuration)
  assert.deepEqual(manualErrors, Array.from(imported, (_, i) => e.importRowErrors(i).map(e.chapterErrorMessage).join('; ') || null))

  e.$refs = { chapterFileInput: { reset() {} } }
  await e.importChapterFile({ text: async () => '{"version":1,"chapters":[{"title":"第一章","start":0},{"title":"Café","start":3.5}]}' })
  e.applyChapterImport()
  let payload
  e.libraryItem = { id: 'book' }
  e.$axios = { $post(_url, body) { payload = body; return Promise.resolve({ updated: false }) } }
  e.$toast.info = () => {}
  e.reloadLibraryItem = () => {}
  e.saveChapters()
  assert.deepEqual(Array.from(payload.chapters, (c) => [c.title, c.start, c.end]), [['第一章', 0, 3.5], ['Café', 3.5, 60]])
})

test('an imported list validates against each destination duration and derives its final end on save', async () => {
  const source = '{"version":1,"chapters":[{"title":"第一章","start":0},{"title":"Café 日本語","start":20}]}'
  for (const duration of [15, 45]) {
    const e = editor()
    e.mediaDuration = duration
    e.$refs = { chapterFileInput: { reset() {} } }
    await e.importChapterFile({ text: async () => source })
    assert.equal(e.importErrors.length > 0, duration === 15)
    e.applyChapterImport()
    if (duration === 15) {
      assert.equal(e.newChapters[1].title, 'Second')
      continue
    }
    assert.equal(e.newChapters[1].end, 45)
    let payload
    e.libraryItem = { id: 'long-book' }
    e.$axios = { $post(_url, body) { payload = body; return Promise.resolve({ updated: false }) } }
    e.$toast.info = () => {}
    e.saveChapters()
    assert.deepEqual(Array.from(payload.chapters, (c) => [c.title, c.start, c.end]), [['第一章', 0, 20], ['Café 日本語', 20, 45]])
  }
})

test('Audible Apply preserves a locked chapter without duplicating its start time', () => {
  const e = editor()
  e.toggleChapterLock(e.newChapters[1], { shiftKey: false })
  e.chapterData = { chapters: [
    { startOffsetSec: 0, startOffsetMs: 0, lengthMs: 10000, title: 'Audible first' },
    { startOffsetSec: 10, startOffsetMs: 10000, lengthMs: 10000, title: 'Audible second' },
    { startOffsetSec: 20, startOffsetMs: 20000, lengthMs: 40000, title: 'Audible third' }
  ] }
  e.applyChapterData()
  assert.deepEqual(Array.from(e.newChapters, (c) => [c.title, c.start]), [['Audible first', 0], ['Second', 10], ['Audible third', 20]])
  assert.deepEqual(Array.from(e.lockedChapters), [1])
  assert.deepEqual(Array.from(e.newChapters, (c) => c.error), [null, null, null])
})
