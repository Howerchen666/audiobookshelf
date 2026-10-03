<template>
  <div>
    <ui-btn ref="openButton" small @click="open">{{ $strings.ButtonCustomizeHome }}</ui-btn>
    <modals-modal v-model="show" name="home-shelf-preferences" :width="560" :processing="busy">
      <section class="bg-bg rounded-lg p-6" aria-labelledby="home-shelves-title">
        <h2 id="home-shelves-title" class="text-xl mb-3">{{ $strings.ButtonCustomizeHome }}</h2>
        <p class="text-sm mb-4">{{ $strings.MessageHomeShelvesHelp }}</p>
        <p v-if="error" role="alert" class="text-red-400 mb-3">{{ error }}</p>
        <ul v-if="settings" class="overflow-y-auto" style="max-height: 50vh">
          <li v-for="(entry, index) in draft" :key="entry.id" class="flex items-center gap-2 py-2">
            <label class="flex items-center gap-3 grow">
              <input v-model="entry.enabled" type="checkbox" :disabled="busy" />
              <span>{{ $strings[entry.labelStringKey] || entry.label }}</span>
            </label>
            <button type="button" class="border rounded px-2 py-1 disabled:opacity-40" :disabled="busy || index === 0" :aria-label="$strings.ButtonHomeShelfMoveUp + ': ' + ($strings[entry.labelStringKey] || entry.label)" @click="move(index, -1)">{{ $strings.ButtonHomeShelfMoveUp }}</button>
            <button type="button" class="border rounded px-2 py-1 disabled:opacity-40" :disabled="busy || index === draft.length - 1" :aria-label="$strings.ButtonHomeShelfMoveDown + ': ' + ($strings[entry.labelStringKey] || entry.label)" @click="move(index, 1)">{{ $strings.ButtonHomeShelfMoveDown }}</button>
          </li>
        </ul>
        <div class="flex flex-wrap gap-2 mt-5">
          <ui-btn v-if="settings" small :disabled="busy" @click="resetPreferences">{{ $strings.ButtonHomeShelvesReset }}</ui-btn>
          <ui-btn v-else small :disabled="busy" @click="loadPreferences">{{ $strings.ButtonHomeShelvesRetry }}</ui-btn>
          <div class="grow" />
          <ui-btn small :disabled="busy" @click="show = false">{{ $strings.ButtonCancel }}</ui-btn>
          <ui-btn small color="bg-success" :disabled="busy || !settings" @click="savePreferences">{{ $strings.ButtonSave }}</ui-btn>
        </div>
      </section>
    </modals-modal>
  </div>
</template>

<script>
export default {
  props: { libraryId: { type: String, required: true } },
  data() {
    return { show: false, busy: false, error: '', settings: null, draft: [], requestSequence: 0 }
  },
  watch: {
    show(value) {
      if (!value) this.$nextTick(() => this.$refs.openButton?.$el?.focus())
    }
  },
  methods: {
    makeDraft() {
      if (!this.settings) return
      const visible = this.settings.visible === null ? this.settings.defaultOrder : this.settings.visible
      const order = [...visible, ...this.settings.defaultOrder.filter((id) => !visible.includes(id))]
      this.draft = order.map((id) => ({ ...this.settings.shelves.find((entry) => entry.id === id), enabled: visible.includes(id) }))
    },
    open() {
      this.error = ''
      this.makeDraft()
      this.show = true
      if (!this.settings) this.loadPreferences()
    },
    move(index, offset) {
      const [entry] = this.draft.splice(index, 1)
      this.draft.splice(index + offset, 0, entry)
    },
    async request(method, body) {
      const sequence = ++this.requestSequence
      const libraryId = this.libraryId
      this.busy = true
      this.error = ''
      try {
        const settings = await this.$axios[method](`/api/libraries/${libraryId}/home-shelves`, body)
        if (sequence !== this.requestSequence || libraryId !== this.libraryId) return
        this.settings = settings
        this.makeDraft()
        this.$emit('loaded', settings)
        if (method !== '$get') {
          this.show = false
          this.$emit('changed', settings)
        }
      } catch (error) {
        if (sequence !== this.requestSequence || libraryId !== this.libraryId) return
        this.error = method === '$get' ? this.$strings.MessageHomeShelvesLoadFailed : this.$strings.MessageHomeShelvesSaveFailed
        // Keep the draft intact so Save can be retried.
      } finally {
        if (sequence === this.requestSequence) this.busy = false
      }
    },
    loadPreferences() { return this.request('$get') },
    savePreferences() { return this.request('$put', { visible: this.draft.filter((entry) => entry.enabled).map((entry) => entry.id) }) },
    resetPreferences() { return this.request('$delete') }
  },
  mounted() { this.loadPreferences() },
  beforeDestroy() { this.requestSequence++ }
}
</script>
