# UFC Offline Viewer

Static browser app for **offline reading** of Unified Facilities Criteria (UFC) content exported from [digital.wbdg.org](https://digital.wbdg.org) / the public CIM API.

**Offline snapshot · not live CIM**

- **Mode A (primary):** Import `.json` or `.zip` (containing JSON) → IndexedDB → fully offline read.
- **Mode B (stub):** Try `fetch` to `https://api.digital.wbdg.org`; on CORS failure, show Import guidance. **No proxy.**
- **Writes:** “Open on live site” only (link-out). Formal CCR stays on digital.wbdg.org — see [docs/CCR-PLAN.md](./docs/CCR-PLAN.md). Local notes stay in IndexedDB and never sync.

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

1. Click **Import sample fixture (UFC 1-200-01)**, or
2. **Download fixture** then drag-drop / Choose file, or
3. Drag-drop `public/fixtures/ufc-1-200-01-content.json` from disk onto the drop zone.

See [IMPORT.md](./IMPORT.md) for export sources and zip notes.

## Offline verify

1. `npm run dev` (or open a built deploy).
2. Import the fixture (or any content JSON).
3. Open DevTools → Application → IndexedDB → `ufc-offline` → `docs` (keyed by `versionId`).
4. Open the document → TOC, body text, tables, in-document search.
5. Turn off network (DevTools Offline) → refresh may need a service worker for the *app shell*; **document data** is already in IndexedDB. Re-open the library after load and open the doc again while offline.
6. “Open on live site” should point at `https://digital.wbdg.org/versions/a093a449-9220-45e0-866a-67d3139af067` for the sample.
7. “Try sync” from localhost should show the CORS / Import guidance message (expected).

## Stack

- Vite + vanilla JS
- JSZip (zip imports)
- IndexedDB database `ufc-offline`: store `docs` (key `versionId`) + store `notes` (local commentary)

## Repo

https://github.com/njivy/ufc-offline-viewer

## Local commentary (v0.3+)

Offline-only notes tagged to sections or sentences. They live in IndexedDB and **do not sync** to CIM.

1. Import the sample fixture (or any content JSON) and open the document.
2. On a section heading, click **Note** (or the subtle ✉ control on a sentence).
3. Enter text → **Save**. The notes panel lists all notes for this version.
4. **Export notes JSON** / **Import notes…** in the notes panel — versioned format `ufc-offline-notes` v1; choose **merge** or **replace**.
5. Reload the page, re-open the document — notes persist locally.

Formal CCR / writes: **Open on live site** only. Plan: [docs/CCR-PLAN.md](./docs/CCR-PLAN.md) (do not re-implement CCR in-app until approved).

## Online directory & asOf sync (v0.4)

1. On the library page, set **As of** (YYYY-MM-DD) → **Load directory**.
2. Prefer live `GET /v1/snapshots/resolve?asOf=` (falls back to `GET /v1/ces/published`, then bundled `catalog/preliminary-directory.json`).
3. If CORS blocks the API, the UI explains why and still shows the cached directory; use **Import** for content.
4. Pick a row → **Sync** (tries content pull) or **Use id** + **Try sync version**.

## TOC & metadata (v0.3)

- Polished left Contents nav with depth rail, chapter weight, and scrollspy active state
- Shared **Document metadata** panel in both Document and Requirements table modes (designation, version, status, importedAt/source, metadataFields)

## Out of scope (by design)

No backend, no CORS proxy, no local field scripts, no binary desktop app, no CIM/CCR writes inside this app (local notes only; link-out for formal CCR).


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

## Requirements table (v0.2)

Open a document, then switch **Document | Requirements table**.

- One row per requirement-bearing node (text, commentary, explanation, or embedded table)
- Columns: section path, label, heading, type, status, requirement text / notes
- Filter by keyword or type; export **CSV** for project review spreadsheets
- Document metadata strip shows designation status / current / row count
- CIM `metadataFields` will appear when present on an import (the sample UFC 1-200-01 export has an empty list)

