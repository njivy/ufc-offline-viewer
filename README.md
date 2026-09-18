# UFC Offline Viewer

Static browser app for **offline reading** of Unified Facilities Criteria (UFC) content exported from [digital.wbdg.org](https://digital.wbdg.org) / the public CIM API.

**Offline snapshot · not live CIM**

- **Mode A (primary):** Import `.json` or `.zip` (containing JSON) → IndexedDB → fully offline read.
- **Mode B (stub):** Try `fetch` to `https://api.digital.wbdg.org`; on CORS failure, show Import guidance. **No proxy.**
- **Writes:** “Open on live site” → `https://digital.wbdg.org/versions/{versionId}` only.

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
- IndexedDB database `ufc-offline`, object store `docs`, key `versionId`

## Repo

https://github.com/njivy/ufc-offline-viewer

## Out of scope (by design)

No backend, no CORS proxy, no local field scripts, no binary desktop app, no editing/CCR inside this app.
