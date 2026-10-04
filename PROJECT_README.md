# Team project README

Shared run instructions, verification steps, and student contribution summaries for the Audiobookshelf course project. The baseline is Audiobookshelf 2.36.1; see [COURSE.md](COURSE.md) for details and [readme.md](readme.md) for general setup.

## Run this version

Clone the team repository:

```bash
git clone https://github.com/Howerchen666/audiobookshelf.git
cd audiobookshelf
```

From the repository root, run the following in Bash (or the VS Code devcontainer):

```bash
test -f dev.js || cp .devcontainer/dev.js dev.js
# Set FFmpegPath and FFProbePath in dev.js to your installed binaries.
npm ci
(cd client && npm ci && npm run generate)
npm run dev
```

Open **http://localhost:3333/audiobookshelf/** and create an account. Data persists in `config/` and `metadata/`. The VS Code devcontainer performs installation and generation automatically; inside it, start with `npm run dev`.

Create a book library that permits ebooks, place EPUB/PDF copies in the same book folder, and scan it. Set EPUB as primary; open PDF from the ebook file list. Sample books are not committed.

## Automated checks

```bash
# Server regression, API, migration, SQLite persistence, and filter tests:
npm test

# Chapter-history regression tests:
(cd client && npm run test:chapters)

# Client compilation and static generation:
(cd client && npm run generate)

# Full browser component suite, including ebook progress:
(cd client && npm run compile-tailwind && env -u ELECTRON_RUN_AS_NODE npx cypress run --component --browser electron)
```

Cypress needs its Linux runtime dependencies. Clearing `ELECTRON_RUN_AS_NODE` fixes Electron startup in the IDE environment. Component tests start their own dev server. Add `--spec cypress/tests/components/readers/EbookProgressReaders.cy.js` to run only ebook checks.

Alternatively, run Cypress from a **host terminal at the repository root**, with container dependencies isolated from the host:

```bash
docker run --rm --platform linux/amd64 \
  -v "$PWD/client:/e2e" \
  -v abs-cypress-node-modules:/e2e/node_modules \
  -w /e2e --entrypoint bash cypress/included:13.7.3 \
  -lc 'npm ci && npm run compile-tailwind && npx cypress run --component --browser chrome'
```

## Student contributions

### @Howerchen666 (Haowen Chen) — maintain reading progress across ebook files

Implements the RFC **Maintain Reading Progress Across Ebook Files**. Each ebook file, including supplementary files, keeps its own position when readers or primary files change. The item page and file list show readable positions and update after reader close as saves complete, without a page reload. Reading and per-file resets leave listening progress unchanged.

#### Change and design

[EbookProgress](server/models/EbookProgress.js) stores `positionType`, `positionValue`, `progress`, and `displayLabel` per `(userId, libraryItemId, fileIno)`, with a unique constraint and string inode. The [migration](server/migrations/v2.37.0-create-ebook-progresses.js) adds the table without rewriting legacy progress.

| Reader | Stored position | Readable label |
| --- | --- | --- |
| EPUB | `epub-cfi`: EPUB CFI string | Chapter title, falling back to percentage |
| PDF | `page`: page number | Page 14 of 120 |
| Comic (CBZ/CBR) | `page`: page number | Page 14 of 120 |
| MOBI/AZW3 | `text-offset`: character offset in rendered text | Nearest heading, falling back to percentage |

- **API:** `GET /api/me/ebook-progress/:libraryItemId` lists the current user's records; `PUT` and `DELETE /api/me/ebook-progress/:libraryItemId/:fileIno` save or reset one file.
- **Position ownership:** The server validates access, files, and payload structure, storing positions as typed, opaque values. Existing readers interpret and validate them against the opened file. A mismatch produces a warning and opens at the beginning without overwriting the record during initialization. Labels are display-only. This keeps format knowledge inside readers and reuses `Reader.vue`'s file selection.
- **Legacy compatibility:** Old EPUB CFI and numeric page positions restore automatically when one file is compatible. Multiple compatible files require confirmation. Old ebook fields clear only after successful restoration and per-file saving; declined, unknown, or unrestorable positions remain intact.
- **Integration:** Item pages use the primary file's reading record; file rows show their own labels. Cards support per-file progress. Continue Reading and in-progress filters include supplementary-only progress and exclude finished books. Resets and removed-file cleanup preserve other files' positions.

#### Checks and results

The latest full run at `c0012dd8` passed on Linux ARM64 with Node 20 and headless Electron. These are **combined-project regression totals**, including teammates' tests:

| Check | Result |
| --- | --- |
| `npm test` | **407 passed** |
| `npm run test:chapters` in `client/` | **11 passed** |
| Full Cypress component command above | **126 passed across seven specs**, including **21 ebook checks** |
| `npm run generate` in `client/` | **Passed**: production build and static generation |

All **544 tests passed**. [Storage tests](test/server/models/EbookProgress.test.js), [API tests](test/server/controllers/MeControllerEbookProgress.test.js), [filter tests](test/server/utils/queries/libraryItemsBookFilters.test.js), and [reader/UI tests](client/cypress/tests/components/readers/EbookProgressReaders.cy.js) cover independent records, authorization, SQLite reopen, migration, primary switching, legacy/malformed/mismatched positions, MOBI font/viewport changes, labels, close-time saves, resets, Continue Reading, and listening isolation. Component tests mock loaders and API calls; real-file restoration across a full server restart remains a manual check. Build warnings were nonfatal.

#### Changes from the RFC

- **Legacy assignment:** Confirmation uses the file already being opened instead of a separate chooser, reusing existing file selection. Declining preserves the old position.
- **MOBI/AZW3 precision:** Saving uses the start of the first visible non-whitespace text node rather than the RFC's exact first visible character. Save/restore count characters consistently, but reopening can land earlier in a paragraph, with further layout drift. Sentence/paragraph snapping was not added.
- **Refinements:** Page labels use the translation helper before string storage, retaining the RFC's display-only design. Extra fixes address late saves after close, SQLite upsert IDs, per-file EPUB caches, removed-file cleanup, and MOBI/AZW3 iframe height.

#### What remains
Known limitations of the implemented design: a replacement file with a new inode gets a new progress record, and saved labels retain the language used at save time. Preserving progress across file replacements and retranslating stored labels are possible future improvements. 
MOBI/AZW3 uses the text offset approach which might cause a bit of drifting.

### @ALT-JS (Jiashen Du) — Choose which shelves I see on the home page

- **Change:** Added **Customize home** so users can select visible shelves, reorder them with Up/Down buttons, and save or reset their layout. Each user has independent settings for each library. Both default and customized layouts use one shared shelf catalog and assembler. Hidden shelves skip content loading, while related reading/listening shelves share loaders.
- **API/storage:** `GET`, `PUT`, and `DELETE /api/libraries/:id/home-shelves` retrieve, save, and reset preferences. The `homeShelfPreferences` table stores an ordered shelf list per user/library pair, separately from `User.extraData`. Existing Sequelize initialization creates the table. The server validates library access and request structure; preference changes invalidate cached home-page responses.
- **Checks and results:** At `4558a0ef`, `npm test`: **407 passed**, including **36 added checks**; `HOST=127.0.0.1 npm run generate` in `client/`: **passed**. Coverage includes default-layout compatibility, authorization, persistence, concurrent saves, cache invalidation, and delayed client responses. Live checks verified saved order across a server restart, selection, reordering, empty layouts, and reset. In the measured fixture, three selected shelves required **16 SQL statements versus 29 for defaults**; hiding all shelves required one preference query and no content queries.
- **Changes from the RFC:** Replaced the original separate default/customized paths with one catalog and assembler following review feedback. Moved preferences from `User.extraData` into a dedicated table to prevent stale account-setting writes from overwriting layouts. Clarified that future shelves remain hidden in saved layouts until selected. Additional fixes address stale cache refills, delayed UI responses, SQLite JSON reads, and selection offsets after reordering.
- **What remains:** Complete manual checks for mobile layout, live library switching, playback-driven progress updates, and search selection. Rebuild and verify the Docker image before deployment. Automated tests cover these areas only where documented; the browser fixture contains no playable media.
- **Known limitations:** Simultaneous saves for the same user/library use the last successful write; drafts are not merged. Other open tabs or devices do not automatically refresh their layout. Empty shelves produce no visible row. New shelves remain unchecked in customized layouts until selected or restored through Reset.

### @YinfengL (Yinfeng Liu) — Export and import chapter lists via JSON

Implements a robust JSON export/import format for chapter lists, allowing users to back up, edit externally, and transfer chapter metadata across audiobooks with varying durations.

#### Change and design

**Editor Integration & Behavior**

- **Import & Preview**: Importing a JSON file strictly parses the data and generates a UI preview without mutating backend data. Canceling the preview safely discards all imported data.
- **Apply vs. Save**: Applying the preview replaces the current editor draft, clears any existing locks, and integrates seamlessly with the editor's Undo/Redo stack. This action does not automatically save to the backend.
- **Save & Portability**: Upon saving, the system dynamically recalculates each chapter's `end` time based on the next chapter's `start` time, bounding the final chapter to the target audiobook's duration. Environment-specific fields (`id`, `end`, duration, locks) are intentionally omitted from the export format to ensure cross-compatibility with media files of different lengths.

**Chapter List JSON Format Specification** The feature introduces a portable, versioned JSON format. Unknown or extra fields are strictly rejected to prevent invalid data ingestion.

- `version` (Number): The format version. Currently only `1` is supported.
- `chapters` (Array): A non-empty array containing the chapter objects.
  - `title` (String): The chapter title. It must not be empty after trimming leading and trailing whitespace.
  - `start` (Number): The start time in seconds from the beginning of the audio. Decimal values are permitted.

**Validation Rules**

- The first chapter's `start` time must be exactly `0`.
- Subsequent `start` times must be strictly increasing (no duplicate or out-of-order times).
- Start times cannot be negative, non-finite, and must be strictly less than the target media's total duration.
- _Error Handling_: Malformed JSON structures reject the file before the preview stage. Valid structures that violate business rules (e.g., negative start times) will display an error in the preview and disable the "Apply" action.

**Example Payload**

```json
{
  "version": 1,
  "chapters": [
    {
      "title": "Opening Credits",
      "start": 0
    },
    {
      "title": "Chapter 1: The Beginning",
      "start": 15.5
    }
  ]
}
```
