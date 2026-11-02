# HANDOFF: UFC Offline Viewer

Handoff date: 2026-11-02 (PT). This doc is meant to be read on its own: it assumes no access to the machine or tools the earlier work was done on.

## 1. What it is and current state

- **What:** A static browser app (Vite + vanilla JS) for **offline reading** of Unified Facilities Criteria (UFC) content exported from https://digital.wbdg.org (the CIM platform). You import content packs (JSON or ZIP with media); they're stored in IndexedDB and read fully offline. The README calls this app "Offline UFC Reader" in some places. The repo name is `ufc-offline-viewer`.
- **For:** USACE field staff working on air-gapped or offline laptops. It needs no install, no server, and no binary.
- **Version:** `0.9.1` (`package.json`). The latest tag and GitHub release is **v0.9.1**, published 2026-09-21. Its release asset is `ufc-offline-viewer-0.9.1-dist.zip`.
- **Latest commit on `main` before this doc:** `831ff05` "docs: link sibling Offline UFC Editor" (2026-09-21). The `v0.9.1` tag points at `683bdfc`. The only commit after the tag is that docs one.
- **Open PRs:** none. **Issues:** none, in any state. **Branch protection on main:** none. The repo is **public**.
- **Sibling app:** [ufc-offline-editor](https://github.com/njivy/ufc-offline-editor), which edits proposals. It has its own HANDOFF.md.

## 2. Build, run, test

Use Node `^20.19.0 || >=22.12.0`, as required by Vite 8.3. The build was checked on Node 20.19.2.

```bash
npm ci            # deps: jszip (runtime), vite (dev)
npm run dev       # http://localhost:5173
npm run build     # vite build && node scripts/file-protocol-build.mjs
npm run preview
```

- `npm run build` writes to `dist/`:
  - `dist/index.html`, which loads `assets/app.js` and `assets/style.css` with classic `<script defer>` tags (Vite outputs IIFE, so the app has no ES modules).
  - `dist/ufc-offline-viewer.html`, a **single file with all JS and CSS inlined**. Double-click it; `file://` works.
  - Copies of `public/fixtures` and `public/catalog`.
- **`dist/` is committed to the repo** so static hosting needs no compile step. Rebuild and commit `dist/` with every source change.
- **Release zips:** each GitHub release attaches `ufc-offline-viewer-X.Y.Z-dist.zip`. It holds the contents of `dist/` at the zip root (`index.html`, `ufc-offline-viewer.html`, `assets/`, `fixtures/`, `catalog/`). The exact zip command wasn't recorded. Doing `cd dist && zip -r ../ufc-offline-viewer-X.Y.Z-dist.zip .` gives the same layout. The `*-dist.zip` files are not committed. Upload them as release assets, for example with `gh release create vX.Y.Z <zip>`.
- **Tests:** there is no automated test suite and no `test` script. Verification so far has been manual walkthroughs in a browser, with screenshots (`ui-review/` locally, not committed). The README's "Offline verify" section gives the manual check: import the fixture, check IndexedDB `ufc-offline`, go offline, reopen the doc.

## 3. Architecture and key files

| File | Role |
|---|---|
| `src/main.js` (~1400 lines) | UI shell: library, reader, TOC, notes panel, workspaces bar, print, requirements table |
| `src/db.js` | IndexedDB `ufc-offline` **v4**. Stores: `workspaces`, `docs` (key `workspaceId::versionId`), `notes` (with `workspaceId`), `media` (key `workspaceId::versionId\0path`). Also `normalizeContent()` and the v0.8 → v0.9 migration into workspace `default` |
| `src/import.js` | JSON/ZIP import (JSZip). Media-pack import |
| `src/media.js` | IMAGE path normalization, blob storage, `blob:` URL hydration, media pack and workspace pack ZIP export |
| `src/render.js` | Section tree → HTML (TEXT sentences, TABLE HTML, IMAGE figures) |
| `src/notes.js` | Local notes (`format: "ufc-offline-notes"`, `formatVersion: 1`), import/export |
| `src/workspaces.js` | Workspace create, rename, switch, delete |
| `src/api.js` | **Link helpers only** (`liveVersionUrl` → `https://digital.wbdg.org/versions/{versionId}`) plus the same-origin cached catalog loader. It makes no API fetches |
| `src/manual.js` | In-app User manual HTML |
| `scripts/file-protocol-build.mjs` | Post-build: rewrites `dist/index.html` to classic scripts and emits the single-file HTML |
| `vite.config.js` | `base: './'`, IIFE, single chunk, everything inlined |
| `IMPORT.md` | Accepted import shapes and sources |
| `docs/CCR-PLAN.md` | Criteria Change Request (CCR) decision: **link-out only** (approved by Nic 2026-09-18) |

`localStorage` key `ufc-offline-active-workspace` holds the active workspace.

**Data formats**
- **Content JSON:** the CIM API wrapper `{ statusCode, success, data: { criterion, sections, metadataFields } }`, or just the inner object. Required: `criterion.versionId` and `sections[]`. Body text comes from TEXT nodes' `sentences[].text`. Tables are `mediaAsset.type === "TABLE"` with HTML in `mediaAsset.content`. Images are `mediaAsset.type === "IMAGE"` with a relative `url`/`sourcePath` such as `ces/…/images/foo.png`.
- **Media pack ZIP:** `content.json` plus `media/<relativePath>`.
- **Workspace pack ZIP:** `format: "ufc-offline-workspace-pack"`, `formatVersion: 1`. Holds `<designation>/content.json`, `media/`, and `workspace-manifest.json`.
- **Fixtures (`public/fixtures/`):**
  - `ufc-1-200-01-content.json`: UFC 1-200-01, ~295 KB, 0 images.
  - `image-demo-pack.zip` and `image-demo-content.json`: one image in the pack and one intentionally missing.
- **Catalog:** `public/catalog/preliminary-directory.json`, a static snapshot that may be stale. Rows link out only.
- **Shared contract:** the Editor's `PACK-CONTRACT.md` (contract v0, frozen 2026-09-21) builds on this app's content vocabulary. The Viewer must keep importing today's packs unchanged and ignore unknown files and keys. Don't change a pack format without a `formatVersion` bump.

## 4. History (all on `main`; no PRs were used)

All dates are 2026.

- **v0.1.1–v0.1.2 (09-18):** first spike with Mode A import, a prebuilt `dist/`, and `file://` / double-click support.
- **v0.2.0:** requirements table with CSV export.
- **v0.3.0:** TOC polish, metadata panel, local notes.
- **v0.4.0:** as-of directory, notes import/export, and the CCR link-out plan.
- **v0.5.0:** offline IMAGE rendering through IndexedDB blobs and media packs.
- **v0.6.0:** UI simplification: Library first, Advanced/Samples disclosure, compact Details.
- **v0.7.0 (09-18):** **removed all live API fetching**, because browser CORS only allows `https://digital.wbdg.org`. Added Applicable project.
- **v0.8.0 (09-21):** quieter chrome, in-app User manual, notes UX pass.
- **v0.9.0:** Workspaces for per-job isolation. Workspace name replaces Applicable project.
- **v0.9.1 (09-21):** simpler workspace controls, an even TOC depth rail, a Print button and print stylesheet, and section titles shown as `1-1: Background`.

## 5. Open work

- **Open PRs or issues:** none.
- **Known bugs:** none recorded. The v0.5.0 UI review found no functional bugs on the image path.
- **Prioritized backlog:** **unknown.** No written next-step list was found after v0.9.1, and the project has had no commits since 2026-09-21. Candidate items found in the notes, none of them approved:
  1. A section-aware deep link to the live site. This is allowed only if CIM documents a stable query or hash parameter, it stays a link-out, and Nic approves it (`docs/CCR-PLAN.md`).
  2. Live sync from the browser. This is blocked by CORS. An allowlist request to the CIM API owners was drafted on 2026-09-18 for public GETs. **Whether it was ever sent is unknown.** The alternative is hosting the reader under `digital.wbdg.org`.
  3. Automated tests. None exist.
- **Pending decisions for Nic:** any new scope. The working rule was: no big build or new app without Nic's go.

## 6. Gotchas and constraints

- **Offline only.** The app makes no fetches to `api.digital.wbdg.org`; this was removed on purpose in v0.7. CIM CORS allows only the `https://digital.wbdg.org` origin, and responses carry CORP `same-origin`. Get content outside the app, for example with `GET /v1/versions/{id}/content` or a guest export (`POST /v1/versions/{id}/exports?format=json`, rate-limited, 429), then import it.
- **No backend, no CORS proxy, no binary or desktop shell, no local helper scripts.** Nic withdrew the Tauri/desktop path for cyber reasons.
- **Formal CCR and other writes stay on the live site.** Use "Open on live site" only. Don't re-add in-app CCR, guest POST, or `/ccr` hub buttons. Local notes are private to the device, never sync, and are not CCR.
- **The app is a snapshot, not authority.** Never imply an imported pack is the live or authoritative UFC.
- **Content rules:** use UNCLASSIFIED public sources and the public API and docs (https://digital.wbdg.org/llms.txt, https://api.digital.wbdg.org/openapi.json) only. Nic approved packing public guest data for local air-gap use (2026-09-18). Keep this app separate from SpecsIntact / SI Offline formats.
- **`file://` quirk:** browsers block `fetch()` of local sample files, so "Import sample fixture" asks you to pick `fixtures/ufc-1-200-01-content.json` by hand.
- IndexedDB data lives in the browser profile. Clearing site data for `file://` wipes the library.
- Every GitHub release should carry a runnable dist zip.

## 7. Former workflow

Earlier work was done by Nic's AI assistant bots. A dedicated "Offline UFC" bot built, walked through, and released the app, and sent go/no-go decisions to Nic. That bot has since been retired. Across Nic's projects, the bot roles were dev (Juno), review (Grimwald), QA (Margo), and ops (Orrin). **Nic now picks up this work directly.** None of the bots, their notes, or the build machine are available in the new environment. Everything needed should be in this repo.
