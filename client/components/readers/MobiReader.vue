<template>
  <div class="w-full h-full">
    <div class="h-full max-h-full w-full">
      <div ref="viewer" class="ebook-viewer absolute overflow-y-scroll left-0 right-0 top-16 w-full max-w-4xl m-auto z-10 border border-black/20 shadow-md bg-white">
        <iframe ref="iframe" title="html-viewer" class="block w-full border-0" scrolling="no"> Loading </iframe>
      </div>
    </div>
  </div>
</template>

<script>
import MobiParser from '@/assets/ebooks/mobi.js'
import HtmlParser from '@/assets/ebooks/htmlParser.js'
import defaultCss from '@/assets/ebooks/basic.js'

export default {
  props: {
    libraryItem: {
      type: Object,
      default: () => {}
    },
    playerOpen: Boolean,
    keepProgress: Boolean,
    fileId: String,
    fileIno: String,
    ebookProgress: Object
  },
  data() {
    return {
      canSaveProgress: false,
      contentLength: 0,
      currentTextOffset: 0,
      scrollTimer: null,
      resizeTimer: null
    }
  },
  computed: {
    libraryItemId() {
      return this.libraryItem?.id
    },
    ebookUrl() {
      if (this.fileId) {
        return `/api/items/${this.libraryItemId}/ebook/${this.fileId}`
      }
      return `/api/items/${this.libraryItemId}/ebook`
    },
    savedTextOffset() {
      if (this.ebookProgress?.positionType !== 'text-offset') return null
      const offset = Number(this.ebookProgress.positionValue)
      return Number.isInteger(offset) && offset >= 0 ? offset : null
    }
  },
  methods: {
    getTextNodes() {
      const doc = this.$refs.iframe?.contentDocument
      if (!doc?.body) return []
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      return nodes
    },
    getTextOffsetAtScroll() {
      const scrollTop = this.$refs.viewer?.scrollTop || 0
      let offset = 0
      for (const node of this.getTextNodes()) {
        const range = node.ownerDocument.createRange()
        range.selectNodeContents(node)
        if (range.getBoundingClientRect().bottom >= scrollTop) return offset
        offset += node.textContent.length
      }
      return offset
    },
    headingForOffset(targetOffset) {
      let offset = 0
      let heading = null
      for (const node of this.getTextNodes()) {
        if (offset > targetOffset) break
        if (/^H[1-6]$/.test(node.parentElement?.tagName || '')) heading = node.textContent.trim()
        offset += node.textContent.length
      }
      return heading
    },
    restoreTextOffset(offset) {
      if (!Number.isInteger(offset) || offset < 0 || offset > this.contentLength) return false
      let current = 0
      for (const node of this.getTextNodes()) {
        if (current + node.textContent.length >= offset) {
          const range = node.ownerDocument.createRange()
          range.setStart(node, Math.min(node.textContent.length, offset - current))
          range.collapse(true)
          this.$refs.viewer.scrollTop = range.getBoundingClientRect().top
          this.currentTextOffset = offset
          return true
        }
        current += node.textContent.length
      }
      return false
    },
    updateProgress(migrateLegacy = false) {
      if (!this.keepProgress || !this.canSaveProgress || !this.fileIno || !this.contentLength) return
      const offset = this.getTextOffsetAtScroll()
      this.currentTextOffset = offset
      const progress = Math.max(0, Math.min(1, offset / this.contentLength))
      const payload = {
        positionType: 'text-offset',
        positionValue: String(offset),
        progress,
        displayLabel: this.headingForOffset(offset) || `${Math.round(progress * 100)}%`
      }
      if (migrateLegacy) payload.migrateLegacy = true
      return this.$axios
        .$put(`/api/me/ebook-progress/${this.libraryItemId}/${this.fileIno}`, payload, { progress: false })
        .then((record) => {
          this.$emit('ebook-progress', record)
          this.$eventBus?.$emit('ebook-progress-updated', record)
          return record
        })
        .catch((error) => console.error('MobiReader.updateProgress failed:', error))
    },
    onScroll() {
      clearTimeout(this.scrollTimer)
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = null
        this.updateProgress()
      }, 400)
    },
    flushPendingProgress() {
      if (!this.scrollTimer) return
      clearTimeout(this.scrollTimer)
      this.scrollTimer = null
      return this.updateProgress()
    },
    resize() {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => {
        this.handleIFrameHeight(this.$refs.iframe)
        this.$nextTick(() => this.restoreTextOffset(this.currentTextOffset))
      }, 100)
    },
    addHtmlCss() {
      let iframe = this.$refs.iframe
      if (!iframe) return
      let doc = iframe.contentDocument
      if (!doc) return
      let style = doc.createElement('style')
      style.id = 'default-style'
      style.textContent = defaultCss
      doc.head.appendChild(style)
    },
    handleIFrameHeight(iFrame) {
      const doc = iFrame?.contentDocument
      if (!doc?.body || !doc.documentElement) return

      doc.documentElement.style.overflow = 'hidden'
      doc.body.style.overflow = 'hidden'
      iFrame.style.height = '1px'

      const contentHeight = Math.max(doc.body.scrollHeight, doc.body.offsetHeight, doc.documentElement.scrollHeight, doc.documentElement.offsetHeight)
      const viewerHeight = this.$refs.viewer?.clientHeight || 0
      iFrame.style.height = `${Math.max(contentHeight, viewerHeight)}px`
    },
    async initMobi() {
      // Fetch mobi file as blob
      const buff = await this.$axios.$get(this.ebookUrl, {
        responseType: 'blob'
      })
      var reader = new FileReader()
      reader.onload = async (event) => {
        var file_content = event.target.result

        let mobiFile = new MobiParser(file_content)

        let content = await mobiFile.render()
        let htmlParser = new HtmlParser(new DOMParser().parseFromString(content.outerHTML, 'text/html'))
        var anchoredDoc = htmlParser.getAnchoredDoc()

        const iFrame = this.$refs.iframe
        const targetDoc = iFrame.contentDocument
        targetDoc.head.innerHTML = anchoredDoc.head?.innerHTML || ''
        targetDoc.body.innerHTML = anchoredDoc.body?.innerHTML || ''
        for (const attr of Array.from(anchoredDoc.documentElement.attributes || [])) targetDoc.documentElement.setAttribute(attr.name, attr.value)
        for (const attr of Array.from(anchoredDoc.body?.attributes || [])) targetDoc.body.setAttribute(attr.name, attr.value)

        // Add css
        const style = targetDoc.createElement('style')
        style.id = 'default-style'
        style.textContent = defaultCss
        targetDoc.head.appendChild(style)
        Array.from(targetDoc.images).forEach((image) => {
          image.addEventListener('load', this.resize, { once: true })
          image.addEventListener('error', this.resize, { once: true })
        })

        this.handleIFrameHeight(iFrame)
        this.$nextTick(() => {
          const nodes = this.getTextNodes()
          this.contentLength = nodes.reduce((length, node) => length + node.textContent.length, 0)
          const restored = this.restoreTextOffset(this.savedTextOffset)
          if (!restored && this.ebookProgress) this.$emit('position-rejected')
          this.canSaveProgress = true
          this.$refs.viewer.addEventListener('scroll', this.onScroll, { passive: true })
          if (restored && this.ebookProgress?.legacy) this.updateProgress(true)
          this.resize()
        })
      }
      reader.readAsArrayBuffer(buff)
    }
  },
  mounted() {
    window.addEventListener('resize', this.resize)
    this.initMobi()
  },
  beforeDestroy() {
    this.flushPendingProgress()
    clearTimeout(this.resizeTimer)
    window.removeEventListener('resize', this.resize)
    this.$refs.viewer?.removeEventListener('scroll', this.onScroll)
  }
}
</script>

<style>
.ebook-viewer {
  height: calc(100% - 96px);
}
</style>
