# Importing UFC content

## What to import

| Source | File | Notes |
|--------|------|--------|
| Content export | JSON from `GET /v1/versions/{versionId}/content` (saved outside this app) | Wrapper `{ statusCode, success, data }` **or** unwrapped `{ criterion, sections, metadataFields }` |
| Guest export | `POST /v1/versions/{versionId}/exports?format=json` → `.json.zip` | ZIP must contain a `.json` file; guest exports are rate-limited. |
| Media pack | ZIP with `content.json` + `media/<relativePath>` | Relative keys match `mediaAsset.url` / `sourcePath` (e.g. `ces/…/images/foo.png`). Air-gap friendly. |
| This repo fixture | `public/fixtures/ufc-1-200-01-content.json` | UFC 1-200-01 sample (~295 KB) — **0 IMAGE** assets |
| Image demo pack | `public/fixtures/image-demo-pack.zip` | Tiny demo with one IMAGE in pack + one missing (“not in pack”) |

This offline viewer **does not** fetch the live CIM API (CORS will not be relaxed). Obtain JSON/ZIP outside the app and import it here.

## In the app

1. **Choose .json or .zip** — file picker  
2. **Drag & drop** onto the drop zone  
3. **Import sample fixture** — loads the bundled UFC 1-200-01 file from the same origin (static asset)  
4. **Download fixture** / **Download image demo pack** — save then import via (1) or (2)  
5. ZIP imports also load `media/` blobs into IndexedDB when present  

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

## Offline images

1. Walk the section tree for `mediaAsset.type === "IMAGE"`.
2. Import a **media pack** ZIP (`media/…` alongside JSON), or use **Import media pack…** on an open document.
3. Document view hydrates `<img>` from **blob:** object URLs — never hot-links the API.
4. Missing blobs → clear placeholder: **Image not in pack** + path.
5. **Export pack** from the reader builds `content.json` + `media/` for air-gap handoff.

Live storage GETs from this app were removed in **v0.7**.

## Cached catalog (static)

**Samples → Show cached catalog** loads bundled `catalog/preliminary-directory.json` (may be stale). Browse titles and **Open on live site** (href only). Import a pack for offline reading — there is no content sync from the catalog.

## Live writes

Use **Open on live site** → `https://digital.wbdg.org/versions/{versionId}` (complete CCR / writes there). This offline viewer does not write to CIM — see docs/CCR-PLAN.md.

### file:// / double-click
Open `ufc-offline-viewer.html` (or `index.html` with its `assets/` folder). Import JSON/ZIP via the file picker — do not rely on the sample-fixture button under `file://`.
