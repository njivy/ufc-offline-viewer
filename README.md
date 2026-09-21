# UFC Offline Viewer

Static browser app for **offline reading** of Unified Facilities Criteria (UFC) content exported from [digital.wbdg.org](https://digital.wbdg.org).

**Offline snapshot · import packs to read · not a live Criteria connection**

- **Import (primary):** `.json` or `.zip` (content + optional figures) → stored on this device → fully offline read.
- **No live API fetch:** Content and images come only from local import / media packs / bundled samples (see Technical notes in the in-app **User manual**).
- **Writes:** “Open on live site” only. Formal CCR stays on digital.wbdg.org — see [docs/CCR-PLAN.md](./docs/CCR-PLAN.md). Local notes never sync.
- **Applicable project:** Project name remembered on this device; included in notes export metadata.
- **v0.8:** Quieter main chrome, in-app **User manual**, and first-class local commentary UX (ownership labels, filter, jump, scroll-preserving edit).

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

Serve the `dist/` folder from any static host (GitHub Pages, etc.).

## Import the sample fixture

A sample content payload for **UFC 1-200-01 — DoD Building Code** ships at:

`public/fixtures/ufc-1-200-01-content.json`

(~295 KB; API wrapper with `data.criterion` + `data.sections`)

In the app:

1. **Import pack** — Choose file or drag-drop a `.json` / `.zip`, or
2. Open **Samples** → **Import sample fixture (UFC 1-200-01)** / image demo pack, or
3. Drag-drop `public/fixtures/ufc-1-200-01-content.json` from disk onto the drop zone.

**Library** is listed above Import so newly imported docs stay visible. **Samples** (collapsed) holds fixtures and an optional **cached catalog** (bundled static JSON only — not a live API).

See [IMPORT.md](./IMPORT.md) for export sources and zip notes.

## Offline verify

1. `npm run dev` (or open a built deploy).
2. Import the fixture (or any content JSON).
3. Open DevTools → Application → IndexedDB → `ufc-offline` → `docs` (keyed by `versionId`).
4. Open the document → TOC, body text, tables, in-document search.
5. Turn off network (DevTools Offline) → **document data** is already in IndexedDB. Re-open the library after load and open the doc again while offline.
6. “Open on live site” should point at `https://digital.wbdg.org/versions/…` for the sample (href only — no API).
7. There is **no** “Try sync” / live CIM fetch in this app.

## Stack

- Vite + vanilla JS
- JSZip (zip imports)
- IndexedDB database `ufc-offline` (v3): store `docs` (key `versionId`) + `notes` (local commentary) + `media` (IMAGE blobs keyed by versionId + path)
- `localStorage` key `ufc-offline-applicable-project` for Applicable project

## Repo

https://github.com/njivy/ufc-offline-viewer

## Applicable project (v0.7+)

Set a project name anytime in the **Applicable project** field (library home and reader). It persists in this browser and appears in notes export metadata as `applicableProject`.

## Local commentary (v0.3+, UX pass in v0.8)

Offline-only notes tagged to sections or paragraphs. They stay on this device and **do not sync** to the live Criteria site.

1. Import a pack and open the document.
2. On a section heading, click **Note** (or the marker on a sentence). Annotated passages show inline indicators.
3. Enter text → **Save note** (Esc cancels; scroll position is preserved).
4. The **Local notes** panel lists ownership (section path / paragraph snippet), supports filter, jump, edit, delete, and import/export.
5. In-app **User manual** (library and reader) covers reading, notes, packs, and air-gap tips; Technical notes are in a collapsible appendix there.

Formal CCR / writes: **Open on live site** only. Plan: [docs/CCR-PLAN.md](./docs/CCR-PLAN.md) (approved: link-out only; no in-app CCR).

## Offline images (v0.5+)

**Pack import always works** (ZIP with `media/` → IndexedDB blobs). Live storage GETs were removed in **v0.7** — import a media pack instead.

UFC content references figures via `mediaAsset` (`type: IMAGE`, relative `url` / `sourcePath` like `ces/…/images/foo.png`). Tables stay inline HTML; images are separate binaries.

1. Import a **media pack** ZIP (`content.json` + `media/…`).
2. Open the document — figures hydrate from IndexedDB as `blob:` URLs (never hot-linked).
3. Missing files show **Image not in pack** plus the storage path.
4. Reader actions: **Import media pack…**, **Export pack** (JSON + media for air-gap), **Open on live site**.

Try: import `public/fixtures/image-demo-pack.zip` — one figure renders, one intentionally missing. UFC 1-200-01 sample still has **0 IMAGES**.

## Cached catalog (static only)

Under **Samples** → **Show cached catalog**, the app loads bundled `public/catalog/preliminary-directory.json` (may be stale). Rows link out to the live site (href only). There is no API directory sync and no content pull from this list.

## TOC & metadata (v0.3+)

- Polished left Contents nav with depth rail, chapter weight, and scrollspy active state
- Compact **Details** disclosure for document metadata/provenance
- Library-first home chrome; Samples disclosure; reader keeps Open on live site + Export pack + Import media pack

## Out of scope (by design)

No backend, no CORS proxy, no live CIM/API fetch from this app, no local field scripts, no binary desktop app, no CIM/CCR writes inside this app (local notes only; link-out for formal CCR).

## Open from disk (no web host)

You do **not** need a remote host or `npm` on the field laptop.

1. Download the release zip (or use `dist/` from this repo).
2. Either:
   - **Best:** double-click `ufc-offline-viewer.html` (single file; all JS/CSS inlined), or
   - Keep the `dist/` folder together and open `dist/index.html`.
3. Use **Choose .json or .zip** to import. Browsers block `fetch()` of local sample files under `file://`, so the “Import sample fixture” button will tell you to pick `fixtures/ufc-1-200-01-content.json` manually.

IndexedDB stores imports in that browser profile. Clearing site data for `file://` removes the library.

A tiny local static server (`npx serve dist`) still works if you prefer `http://localhost`.

## Static hosting (no build required)

A prebuilt **`dist/`** folder is committed to this repo. Point any static host (IIS, nginx, GitHub Pages, S3, a fileshare) at `dist/`, or open via a simple static server:

```bash
npx --yes serve dist
```

Then import `dist/fixtures/ufc-1-200-01-content.json` (or your CIM export JSON/ZIP).

> Asset paths are relative (`base: './'`), so serving the `dist` directory itself works even under a subpath.

To regenerate after source changes: `npm i && npm run build` (updates `dist/`).

## Requirements table (v0.2+)

Open a document, then switch **Document | Requirements table**.

- One row per requirement-bearing node (text, commentary, explanation, or embedded table)
- Columns: section path, label, heading, type, status, requirement text / notes
- Filter by keyword or type; export **CSV** for project review spreadsheets
- Document metadata strip shows designation status / current / row count
- CIM `metadataFields` will appear when present on an import (the sample UFC 1-200-01 export has an empty list)
