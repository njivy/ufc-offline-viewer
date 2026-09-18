# Importing UFC content (Mode A)

## What to import

| Source | File | Notes |
|--------|------|--------|
| Content API | `GET /v1/versions/{versionId}/content` JSON | Wrapper `{ statusCode, success, data }` **or** unwrapped `{ criterion, sections, metadataFields }` |
| Guest export | `POST /v1/versions/{versionId}/exports?format=json` → download `.json.zip` | ZIP must contain a `.json` file; guest exports are rate-limited |
| This repo fixture | `public/fixtures/ufc-1-200-01-content.json` | UFC 1-200-01 sample (~295 KB) |

## In the app

1. **Choose .json or .zip** — file picker  
2. **Drag & drop** onto the drop zone  
3. **Import sample fixture** — fetches the bundled file from the same origin  
4. **Download fixture** — save then import via (1) or (2)

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

Body text is on **TEXT** nodes via `sentences[].text`. Tables use `mediaAsset.type === "TABLE"` with HTML in `mediaAsset.content`.

## Mode B (API sync)

The app can attempt:

`GET https://api.digital.wbdg.org/v1/versions/{versionId}/content`

The public API currently allowlists `Origin: https://digital.wbdg.org` only. From localhost or other hosts, the browser will fail with CORS — the UI then points you back here. **Do not add a proxy** to work around this.

## Live writes

Use **Open on live site** → `https://digital.wbdg.org/versions/{versionId}` (login / CCR there). This offline viewer does not write to CIM.
