<template>
  <div class="w-full h-full">
    <div class="h-full max-h-full w-full">
      <div ref="viewer" class="ebook-viewer absolute overflow-y-scroll left-0 right-0 top-16 w-full max-w-4xl m-auto z-10 border border-black/20 shadow-md bg-white">
        <iframe ref="iframe" title="html-viewer" width="100%"> Loading </iframe>
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
    updateProgress() {
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
      this.$axios
        .$put(`/api/me/ebook-progress/${this.libraryItemId}/${this.fileIno}`, payload, { progress: false })
        .then((record) => this.$emit('ebook-progress', record))
        .catch((error) => console.error('MobiReader.updateProgress failed:', error))
    },
    onScroll() {
      clearTimeout(this.scrollTimer)
      this.scrollTimer = setTimeout(this.updateProgress, 400)
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
      const isElement = (obj) => !!(obj && obj.nodeType === 1)

      var body = iFrame.contentWindow.document.body,
        html = iFrame.contentWindow.document.documentElement
      iFrame.height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight) * 2

      setTimeout(() => {
        let lastchild = body.lastElementChild
        let lastEle = body.lastChild

        let itemAs = body.querySelectorAll('a')
        let itemPs = body.querySelectorAll('p')
        let lastItemA = itemAs[itemAs.length - 1]
        let lastItemP = itemPs[itemPs.length - 1]
        let lastItem
        if (isElement(lastItemA) && isElement(lastItemP)) {
          if (lastItemA.clientHeight + lastItemA.offsetTop > lastItemP.clientHeight + lastItemP.offsetTop) {
            lastItem = lastItemA
          } else {
            lastItem = lastItemP
          }
        }

        if (!lastchild && !lastItem && !lastEle) return
        if (lastEle.nodeType === 3 && !lastchild && !lastItem) return

        let nodeHeight = 0
        if (lastEle.nodeType === 3 && iFrame.contentDocument.createRange) {
          let range = iFrame.contentDocument.createRange()
          range.selectNodeContents(lastEle)
          if (range.getBoundingClientRect) {
            let rect = range.getBoundingClientRect()
            if (rect) {
              nodeHeight = rect.bottom - rect.top
            }
          }
        }
        var lastChildHeight = isElement(lastchild) ? lastchild.clientHeight + lastchild.offsetTop : 0
        var lastEleHeight = isElement(lastEle) ? lastEle.clientHeight + lastEle.offsetTop : 0
        var lastItemHeight = isElement(lastItem) ? lastItem.clientHeight + lastItem.offsetTop : 0
        iFrame.height = Math.max(lastChildHeight, lastEleHeight, lastItemHeight) + 100 + nodeHeight
      }, 500)
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

        let iFrame = this.$refs.iframe
        iFrame.contentDocument.body.innerHTML = anchoredDoc.documentElement.outerHTML

        // Add css
        let style = iFrame.contentDocument.createElement('style')
        style.id = 'default-style'
        style.textContent = defaultCss
        iFrame.contentDocument.head.appendChild(style)

        this.handleIFrameHeight(iFrame)
        this.$nextTick(() => {
          const nodes = this.getTextNodes()
          this.contentLength = nodes.reduce((length, node) => length + node.textContent.length, 0)
          const restored = this.restoreTextOffset(this.savedTextOffset)
          this.canSaveProgress = true
          this.$refs.viewer.addEventListener('scroll', this.onScroll, { passive: true })
          if (restored && this.ebookProgress?.legacy) this.updateProgress()
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
    clearTimeout(this.scrollTimer)
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
