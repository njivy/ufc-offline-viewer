# CCR plan for UFC Offline Viewer (link-out only)

**Date:** 2026-09-18 (PT)  
**Status:** Proposal — **do not re-implement CCR in the offline app until Nic approves this plan.**  
**Sources:** Public OpenAPI (`POST /v1/ccrs/guest`, CreateGuestCcrDto / CcrDto), llms.txt, api-probe.md, CORS findings. SPA is JS-rendered; no HTML scrape.

---

## What “link back for CCR” should mean for field users

Field staff use this app to **read** UFC snapshots offline. When they need a formal Criteria Change Request, the product promise is:

1. Jump from the offline reader to the **same published version** on `https://digital.wbdg.org/versions/{versionId}`.
2. Complete CCR (guest or logged-in) **on the live CIM site**, where auth, validation, section pickers, and rate limits already exist.
3. Keep **local notes** in IndexedDB as private commentary only — never as a substitute for CCR.

“Link back” is therefore a **navigation affordance**, not an in-app form.

---

## Feasible deep links vs guest API

| Option | Feasibility | Notes |
|--------|-------------|--------|
| **Deep link:** `https://digital.wbdg.org/versions/{versionId}` | **Yes (recommended)** | Stable, public. User opens live reader; CCR UI is part of that SPA. Optional `#` / `?section=` hashes are **unverified** against the SPA (JS-rendered; do not invent fragment contracts). Prefer the plain version URL until CIM documents deep-link params. |
| **Hub:** `https://digital.wbdg.org/ccr` | Unclear UX | Exists as a route string in older viewer builds; may not land the user on the right document/section. Prefer version deep link. |
| **Guest API:** `POST /v1/ccrs/guest` | Spec-public, **browser-blocked for our origin** | Body (`CreateGuestCcrDto`): required `sectionId`, `title` (≥3), `description` (≥10), `submitterName`, `submitterEmail`; optional `versionId`, org, phone. Responses: **201** + `CcrDto`, **404** section missing, **429** guest rate limit. Calling this from the offline viewer still needs CORS (see below) and would re-implement form UX the live SPA already owns. |

**Recommendation:** Ship **Open on live site** only. Do not call `/v1/ccrs/guest` from this app unless Nic explicitly approves an in-app guest form *and* CORS/auth gaps are closed.

---

## Auth / CORS gaps

- Browser CORS on `api.digital.wbdg.org` allowlists **`https://digital.wbdg.org` only** (also CORP `same-origin`). Hosted readers on other origins (or `file://`) cannot `fetch` guest CCR or content APIs.
- Guest CCR is unauthenticated at the API layer but still subject to **CORS + 429**. Credentialed CCR (logged-in) is outside the public OpenAPI surface used here.
- Even if CORS were widened for **reads**, posting CCR from a third-party origin raises product/policy questions (spam, ToS, attribution). Safer default: keep writes on the first-party SPA.

See also [CORS-ALLOWLIST-ASK.md](./CORS-ALLOWLIST-ASK.md) (read allowlist ask only).

---

## Recommended UX (until Nic approves otherwise)

1. **Link-out only:** one clear **Open on live site** control → `liveVersionUrl(versionId)`.
2. **No** in-app CCR buttons, hub links, or guest-submit forms in the offline viewer.
3. Short copy near the link: formal change requests happen on digital.wbdg.org; local notes do not sync to CIM.
4. Optional later (needs Nic OK): section-aware deep link *if* CIM documents a stable query/hash; still link-out, not API POST.

---

## Explicit non-goal

**Do not re-implement CCR** (forms, guest POST, status tracking) inside UFC Offline Viewer until Nic reviews and approves this plan (or a successor).

Also recorded under `/workspace/ufc-offline-feasibility/CCR-PLAN.md`.
