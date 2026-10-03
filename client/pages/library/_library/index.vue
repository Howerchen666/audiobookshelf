<template>
  <div class="page" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar is-home>
      <template #home-actions>
        <app-home-shelf-preferences :key="library.id" ref="homePreferences" :library-id="library.id" @loaded="preferences = $event" @changed="refreshShelves" />
      </template>
    </app-book-shelf-toolbar>
    <app-book-shelf-categorized :key="library.id" ref="shelves" :home-preferences="preferences" @customize="openPreferences" />
  </div>
</template>

<script>
export default {
  async asyncData({ store, params, redirect }) {
    const libraryId = params.library
    const result = await store.dispatch('libraries/fetch', libraryId)
    if (!result) {
      return redirect(`/oops?message=Library "${libraryId}" not found`)
    }
    return {
      library: result.library
    }
  },
  data() {
    return { preferences: null }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    }
  },
  watch: {
    'library.id'() { this.preferences = null }
  },
  methods: {
    openPreferences() { this.$refs.homePreferences.open() },
    refreshShelves(settings) {
      this.preferences = settings
      this.$refs.shelves.fetchCategories()
    }
  },
  mounted() {},
  beforeDestroy() {}
}
</script>
