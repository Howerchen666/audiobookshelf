# Team project README

Shared run instructions, verification steps, and student contribution summaries for the Audiobookshelf course project. The baseline is Audiobookshelf 2.36.1; see [COURSE.md](COURSE.md) for details and [readme.md](readme.md) for general setup.

## Run this version

Use Node.js 20 and FFmpeg. Clone the team repository if needed:

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

### @Howerchen666 — ebook reading progress

- **Change:** `EbookProgress` stores positions per user, item, and ebook file. EPUB uses CFI/chapter titles; PDF/comics use pages/totals; MOBI/AZW3 use text offsets/headings. Primary and supplementary files keep separate records. Item pages, file lists, cards, Continue Reading, filters, and resets support them without changing listening progress.
- **API/storage:** `GET /api/me/ebook-progress/:libraryItemId`, `PUT` and `DELETE /api/me/ebook-progress/:libraryItemId/:fileIno`; migration [v2.37.0-create-ebook-progresses.js](server/migrations/v2.37.0-create-ebook-progresses.js). The server validates access and payload structure; readers interpret positions. Legacy positions convert only after successful restoration, with confirmation when multiple files are compatible.
- **Checks and results:** At `b56c1286`, `npm test`: **371 passed**; Cypress command above: **126 passed across seven specs**, including **21 ebook checks**; `npm run generate` in `client/`: **passed**. Coverage includes authorization, independent records, SQLite reopen, legacy/mismatch handling, labels, resets, filters, and listening isolation. Build warnings are nonfatal.
- **Changes from the RFC:** Ambiguous legacy assignment confirms the file being opened. Page labels use the translation helper and are stored as strings. Additional fixes address saves completing after close, SQLite upsert IDs, per-file EPUB caches, removed-file cleanup, and MOBI/AZW3 iframe sizing.
- **What remains:** Complete and record the manual walkthrough below to verify real ebook rendering and restoration across a server restart. Automated tests cover reader behavior and database persistence separately, with ebook loading mocked. Before release, align the package version (currently 2.36.1) with the v2.37.0 migration; development startup currently creates the table through Sequelize sync.
- **Known limitations:** MOBI/AZW3 may reopen near the saved passage with minor layout drift. A replacement file with a new inode gets a separate progress record. Saved labels keep the language used when saved. External reader syncing and additional formats remain outside the RFC's scope.

#### Ebook walkthrough with real files

Use a book containing a primary EPUB and supplementary PDF. Include an audio track to check listening isolation, plus comic and MOBI/AZW3 files to check their readers.

1. Read the EPUB to a recognizable chapter and the PDF to a different page. Close each reader and confirm the item/file labels update immediately.
2. Reopen both files and confirm their separate positions. Change which file is primary and repeat; both saved positions should remain intact.
3. Restart the server, reload the browser, and reopen both files. Confirm the EPUB chapter and PDF page still match the saved positions.
4. Save and reopen a comic page and a MOBI/AZW3 passage. Resize the window and confirm MOBI/AZW3 still restores the same nearby passage.
5. Record listening progress, read the ebooks, then reset one ebook's progress from its file menu. Confirm listening progress and the other ebook positions remain unchanged.
6. Confirm the book remains on the appropriate Continue Reading/Listening shelf and in-progress filter while another record qualifies. Clear all qualifying progress and confirm it disappears.

Record the tested commit, file formats, and pass/fail results here after performing the walkthrough. The automated results above do not establish completion of these manual checks.