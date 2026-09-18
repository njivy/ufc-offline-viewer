# Importing UFC content (Mode A)

## What to import

| Source | File | Notes |
|--------|------|--------|
| Content API | `GET /v1/versions/{versionId}/content` JSON | Wrapper `{ statusCode, success, data }` **or** unwrapped `{ criterion, sections, metadataFields }` |
| Guest export | `POST /v1/versions/{versionId}/exports?format=json` → download `.json.zip` | ZIP must contain a `.json` file; guest exports are rate-limited. Prefer content + storage GETs over export zip for bulk. |
| Media pack | ZIP with `content.json` + `media/<relativePath>` | Relative keys match `mediaAsset.url` / `sourcePath` (e.g. `ces/…/images/foo.png`). Air-gap friendly. |
| This repo fixture | `public/fixtures/ufc-1-200-01-content.json` | UFC 1-200-01 sample (~295 KB) — **0 IMAGE** assets |
| Image demo pack | `public/fixtures/image-demo-pack.zip` | Tiny demo with one IMAGE in pack + one missing (“not in pack”) |

## In the app

1. **Choose .json or .zip** — file picker  
2. **Drag & drop** onto the drop zone  
3. **Import sample fixture** — fetches the bundled UFC 1-200-01 file from the same origin  
4. **Download fixture** / **Download image demo pack** — save then import via (1) or (2)
5. With **Include images** checked, ZIP imports also load `media/` blobs into IndexedDB

## Accepted shapes

```json
{
  "statusCode": 200,
  "success": true,
  "data": {
    "criterion": { "designation": "…", "title": "…", "versionId": "…" },
    "sections": [ /* tree */ ],
    "metadataFields": []
  }
}
```

or just the inner `data` object.

Body text is on **TEXT** nodes via `sentences[].text`. Tables use `mediaAsset.type === "TABLE"` with HTML in `mediaAsset.content`. Images use `mediaAsset.type === "IMAGE"` with relative `url` / `sourcePath` storage keys.

## Offline images (v0.5)

1. Walk the section tree for `mediaAsset.type === "IMAGE"`.
2. When online and CORS allows: `GET https://api.digital.wbdg.org/v1/storage/files/{path}` → store Blob in IndexedDB (`media` store, keyed by versionId + path).
3. On CORS failure (typical outside `digital.wbdg.org`): import a **media pack** ZIP (`media/…` alongside JSON), or use **Import media pack…** on an open document.
4. Document view hydrates `<img>` from **blob:** object URLs — never hot-links the API while offline.
5. Missing blobs → clear placeholder: **Image not in pack** + path.
6. **Export pack** from the reader builds `content.json` + `media/` for air-gap handoff.
7. **Fetch images** retries storage GETs with progress when CORS works.

## Mode B (API sync / directory)

The app can:

1. Load a preliminary directory via `GET /v1/snapshots/resolve?asOf=YYYY-MM-DD` (preferred) or `GET /v1/ces/published`
2. Sync a chosen version via `GET /v1/versions/{versionId}/content`
3. Optionally fetch IMAGE binaries via `GET /v1/storage/files/{path}` (Include images)
4. Fall back to bundled `catalog/preliminary-directory.json` when live fetch fails (browse titles only — still import for content)

The public API currently allowlists `Origin: https://digital.wbdg.org` only. From localhost or other hosts, the browser will fail with CORS — the UI then points you back here. **Do not add a proxy** to work around this.

## Live writes

Use **Open on live site** → `https://digital.wbdg.org/versions/{versionId}` (complete CCR / writes there). This offline viewer does not write to CIM — see docs/CCR-PLAN.md.

### file:// / double-click
Open `ufc-offline-viewer.html` (or `index.html` with its `assets/` folder). Import JSON/ZIP via the file picker — do not rely on the sample-fixture button under `file://`.
