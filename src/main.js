import './style.css';
import { listDocs, getDoc, deleteDoc, saveDoc } from './db.js';
import { importFile, importFromUrl, importMediaPackFile } from './import.js';
import {
  walkToc,
  renderDocumentBody,
  searchDocument,
  escapeHtml,
  flattenRequirements,
  requirementsToCsv,
  renderDocMetaPanel,
} from './render.js';
import { trySyncFromApi, liveVersionUrl, loadPreliminaryDirectory, loadCachedDirectory } from './api.js';
import {
  listNotesForVersion,
  countNotesByTarget,
  saveNote,
  deleteNote,
  exportNotesJson,
  importNotesPayload,
} from './notes.js';
import {
  collectImageAssets,
  syncImagesForContent,
  hydrateDocumentImages,
  buildMediaPackZip,
  deleteMediaForVersion,
  listMediaForVersion,
  revokeAllObjectUrls,
  revokeObjectUrlsForVersion,
} from './media.js';

const FIXTURE = '/fixtures/ufc-1-200-01-content.json';
const IMAGE_DEMO_PACK = './fixtures/image-demo-pack.zip';
const SAMPLE_VERSION_ID = 'a093a449-9220-45e0-866a-67d3139af067';

const app = document.querySelector('#app');
let state = {
  view: 'library', // library | reader
  docs: [],
  current: null,
  searchHits: [],
  status: '',
  error: '',
  readerMode: 'document', // document | table
  tableFilter: '',
  tableTypeFilter: 'all', // all | TEXT | HEADING | CHAPTER | notes
  notes: [],
  noteCounts: {},
  noteDraft: null, // { targetType, targetId, noteId?, body }
  notesPanelOpen: true,
  directory: null, // { ok, items, label, stale, source, asOf, liveError? }
  directoryFilter: '',
  syncAsOf: '',
  includeImages: true, // sync/import: fetch or pack-include IMAGE blobs
  mediaStats: null, // { total, local } for current doc
};

let tocObserver = null;

async function refreshLibrary() {
  state.docs = await listDocs();
}

async function refreshMediaStats() {
  const doc = state.current;
  if (!doc) {
    state.mediaStats = null;
    return;
  }
  const versionId = doc.versionId || doc.content?.criterion?.versionId;
  const assets = collectImageAssets(doc.content?.sections || []);
  const local = await listMediaForVersion(versionId);
  state.mediaStats = { total: assets.length, local: local.length };
}

async function refreshNotes() {
  const doc = state.current;
  if (!doc) {
    state.notes = [];
    state.noteCounts = {};
    return;
  }
  const versionId = doc.versionId || doc.content?.criterion?.versionId;
  state.notes = await listNotesForVersion(versionId);
  state.noteCounts = await countNotesByTarget(versionId);
}

function setStatus(msg, isError = false) {
  state.status = isError ? '' : msg;
  state.error = isError ? msg : '';
}

function banner() {
  return `<div class="banner" role="status">Offline snapshot · not live CIM</div>`;
}

function renderDirectoryBlock() {
  const dir = state.directory;
  if (!dir) {
    return `<p class="hint dir-empty">No directory loaded yet. Choose an as-of date and click <strong>Load directory</strong>, or show the cached public list.</p>`;
  }
  if (!dir.ok) {
    return `<div class="dir-banner error">
      <p><strong>Could not load live directory.</strong> ${escapeHtml(dir.message || 'Unknown error')}</p>
      <p class="hint">The public API only allowlists <code>https://digital.wbdg.org</code> for browser CORS. Mode A <strong>Import</strong> still works — download a JSON/ZIP export elsewhere and import it above.</p>
    </div>`;
  }
  const q = (state.directoryFilter || '').trim().toLowerCase();
  let items = dir.items || [];
  if (q) {
    items = items.filter((i) =>
      [i.designation, i.title, i.series, i.versionId, i.versionNumber]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  const staleNote = dir.stale
    ? `<span class="pill warn">cached — may be stale</span>`
    : `<span class="pill ok-pill">${escapeHtml(dir.source || 'live')}</span>`;
  const corsNote =
    dir.liveError && dir.liveError.corsLikely
      ? `<p class="hint">Live API was blocked by CORS; showing ${dir.stale ? 'cached' : 'fallback'} directory. Content sync will likely fail too — prefer Import.</p>`
      : '';
  const rows = items.length
    ? items
        .map((i) => {
          const inLib = state.docs.some((d) => d.versionId === i.versionId);
          return `<tr>
            <td><strong>${escapeHtml(i.designation)}</strong></td>
            <td>${escapeHtml(i.title)}</td>
            <td>${escapeHtml(i.versionNumber || '—')}</td>
            <td class="mono">${escapeHtml((i.versionId || '').slice(0, 8))}…</td>
            <td class="actions">
              ${inLib ? '<span class="muted">In library</span>' : ''}
              <button type="button" data-dir-sync="${escapeHtml(i.versionId)}" title="Try API sync">Sync</button>
              <button type="button" class="secondary" data-dir-fill="${escapeHtml(i.versionId)}">Use id</button>
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="empty">No documents match this filter.</td></tr>`;
  return `
    <div class="dir-banner">
      <div class="dir-banner-head">
        <strong>${escapeHtml(dir.label || 'Directory')}</strong>
        ${staleNote}
        <span class="muted">${items.length} / ${(dir.items || []).length} shown</span>
      </div>
      ${corsNote}
      <div class="sync-row" style="margin-top:0.5rem">
        <input type="search" id="dir-filter" placeholder="Filter directory…" value="${escapeHtml(state.directoryFilter || '')}" />
      </div>
      <div class="table-scroll dir-table-wrap">
        <table class="lib dir-table">
          <thead>
            <tr>
              <th>Designation</th>
              <th>Title</th>
              <th>Version</th>
              <th>versionId</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderLibrary() {
  const rows = state.docs.length
    ? state.docs
        .map(
          (d) => `
      <tr>
        <td><strong>${escapeHtml(d.designation)}</strong></td>
        <td>${escapeHtml(d.title)}</td>
        <td><code class="mono">${escapeHtml(d.versionId)}</code></td>
        <td>${escapeHtml(d.versionNumber || formatDate(d.datePublished) || '—')}</td>
        <td>${escapeHtml(formatDate(d.importedAt))}</td>
        <td class="actions">
          <button type="button" data-open="${escapeHtml(d.versionId)}">Open</button>
          <button type="button" class="secondary" data-delete="${escapeHtml(d.versionId)}">Remove</button>
        </td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">Library is empty. Import a JSON/ZIP export, or click “Import sample fixture”.</td></tr>`;

  app.innerHTML = `
    ${banner()}
    <header class="top">
      <h1>UFC Offline Viewer</h1>
      <p class="lede">Read Unified Facilities Criteria offline in the field — keep a personal library of UFC snapshots on this device, search and review requirements without network, and open the live CIM site when you need the current published version.</p>
    </header>

    <section class="panel">
      <h2>Import</h2>
      <div class="import-row">
        <label class="file-btn">
          Choose .json or .zip
          <input type="file" id="file-input" accept=".json,.zip,application/json,application/zip" hidden />
        </label>
        <button type="button" id="btn-fixture">Import sample fixture (UFC 1-200-01)</button>
        <button type="button" class="secondary" id="btn-image-demo">Import image demo pack</button>
        <a class="link-btn" href="${FIXTURE}" download="ufc-1-200-01-content.json">Download fixture</a>
        <a class="link-btn" href="${IMAGE_DEMO_PACK}" download="image-demo-pack.zip">Download image demo pack</a>
      </div>
      <div id="drop-zone" class="drop-zone" tabindex="0">
        Or drag &amp; drop a <code>.json</code> / <code>.zip</code> here
        <span class="hint">Sample path: <code>public/fixtures/ufc-1-200-01-content.json</code> · air-gap pack: <code>content.json</code> + <code>media/…</code></span>
      </div>
      <label class="check-row">
        <input type="checkbox" id="chk-include-images" ${state.includeImages ? 'checked' : ''} />
        Include images when syncing / importing packs (store blobs in IndexedDB)
      </label>
      <p class="hint">Accepts API wrapper <code>{ statusCode, success, data }</code> or unwrapped <code>{ criterion, sections }</code>. ZIP may include <code>media/</code> (relative paths like <code>ces/…/images/foo.png</code>) for offline IMAGE rendering. UFC 1-200-01 sample has 0 IMAGES — use the image demo pack to try blob URLs + “not in pack”.</p>
    </section>

    <section class="panel">
      <h2>Online directory &amp; sync</h2>
      <p class="hint" style="margin-top:0">Pick an <strong>as-of</strong> date to list published UFCs available to sync. Live API works only when this origin is CORS-allowlisted (today: digital.wbdg.org). Otherwise a cached public directory still lets you browse titles — use <strong>Import</strong> above to load content.</p>
      <div class="sync-row">
        <label class="sync-asof-label" for="sync-asof">As of</label>
        <input id="sync-asof" type="date" value="${escapeHtml(state.syncAsOf || '')}" aria-label="asOf date YYYY-MM-DD" />
        <button type="button" id="btn-load-directory">Load directory</button>
        <button type="button" class="secondary" id="btn-load-cached">Show cached directory</button>
      </div>
      ${renderDirectoryBlock()}
      <div class="sync-row" style="margin-top:0.75rem">
        <input id="sync-version" type="text" value="${SAMPLE_VERSION_ID}" aria-label="versionId" placeholder="versionId UUID" />
        <button type="button" id="btn-sync">Try sync version</button>
      </div>
      <p class="hint">Sync prefers <code>GET /v1/versions/{id}/content</code> then optional <code>GET /v1/storage/files/{path}</code> per IMAGE (not the export zip). No proxy — on CORS failure, import a JSON/ZIP pack with <code>media/</code> instead.</p>
    </section>

    <section class="panel">
      <h2>Library</h2>
      <div class="table-scroll">
        <table class="lib">
          <thead>
            <tr>
              <th>Designation</th>
              <th>Title</th>
              <th>versionId</th>
              <th>Version / date</th>
              <th>Imported</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    ${statusBlock()}
  `;

  bindLibrary();
}

function statusBlock() {
  if (state.error) return `<div class="flash error">${escapeHtml(state.error)}</div>`;
  if (state.status) return `<div class="flash ok">${escapeHtml(state.status)}</div>`;
  return '';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function bindLibrary() {
  document.getElementById('file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await doImport(file);
    e.target.value = '';
  });

  document.getElementById('btn-fixture')?.addEventListener('click', async () => {
    try {
      if (location.protocol === 'file:') {
        setStatus(
          'Opened from disk (file://): browsers block fetching the sample fixture. Use “Choose .json or .zip” and pick fixtures/ufc-1-200-01-content.json next to this HTML (or any CIM export).',
          true
        );
        renderLibrary();
        return;
      }
      setStatus('Importing fixture…');
      renderLibrary();
      const rec = await importFromUrl(FIXTURE, 'fixture: ufc-1-200-01-content.json');
      await refreshLibrary();
      setStatus(`Imported ${rec.designation} (${rec.versionId})`);
      renderLibrary();
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderLibrary();
    }
  });

  document.getElementById('btn-image-demo')?.addEventListener('click', async () => {
    try {
      if (location.protocol === 'file:') {
        setStatus(
          'Opened from disk (file://): use Choose .json or .zip and pick fixtures/image-demo-pack.zip.',
          true
        );
        renderLibrary();
        return;
      }
      setStatus('Fetching image demo pack…');
      renderLibrary();
      const res = await fetch(IMAGE_DEMO_PACK);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], 'image-demo-pack.zip', { type: 'application/zip' });
      await doImport(file);
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderLibrary();
    }
  });

  document.getElementById('btn-sync')?.addEventListener('click', async () => {
    const vid = document.getElementById('sync-version')?.value?.trim() || SAMPLE_VERSION_ID;
    await doSyncVersion(vid);
  });

  const asofEl = document.getElementById('sync-asof');
  asofEl?.addEventListener('change', () => {
    state.syncAsOf = asofEl.value || '';
  });

  document.getElementById('btn-load-directory')?.addEventListener('click', async () => {
    const asOf = document.getElementById('sync-asof')?.value?.trim() || '';
    state.syncAsOf = asOf;
    if (!asOf) {
      setStatus('Pick an as-of date (YYYY-MM-DD), or use “Show cached directory”.', true);
      renderLibrary();
      return;
    }
    setStatus(`Loading directory asOf ${asOf}…`);
    renderLibrary();
    const result = await loadPreliminaryDirectory(asOf);
    state.directory = result;
    state.directoryFilter = '';
    if (result.ok) {
      setStatus(`Directory: ${result.items.length} documents (${result.label})`);
    } else {
      setStatus(result.message || 'Directory load failed', true);
    }
    renderLibrary();
  });

  document.getElementById('btn-load-cached')?.addEventListener('click', async () => {
    setStatus('Loading cached public directory…');
    renderLibrary();
    const result = await loadCachedDirectory();
    state.directory = result;
    state.directoryFilter = '';
    if (result.ok) {
      setStatus(`Cached directory: ${result.items.length} documents`);
    } else {
      setStatus(result.message || 'Cached directory missing', true);
    }
    renderLibrary();
  });

  let dirFilterTimer;
  document.getElementById('dir-filter')?.addEventListener('input', (e) => {
    clearTimeout(dirFilterTimer);
    dirFilterTimer = setTimeout(() => {
      state.directoryFilter = e.target.value || '';
      renderLibrary();
      const again = document.getElementById('dir-filter');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }, 160);
  });

  app.querySelectorAll('[data-dir-sync]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const vid = btn.getAttribute('data-dir-sync');
      if (vid) await doSyncVersion(vid);
    });
  });

  app.querySelectorAll('[data-dir-fill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vid = btn.getAttribute('data-dir-fill');
      const input = document.getElementById('sync-version');
      if (input && vid) {
        input.value = vid;
        input.focus();
      }
    });
  });

  const zone = document.getElementById('drop-zone');
  if (zone) {
    ['dragenter', 'dragover'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add('drag');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove('drag');
      })
    );
    zone.addEventListener('drop', async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) await doImport(file);
    });
  }

  app.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-open');
      const doc = await getDoc(id);
      if (!doc) {
        setStatus('Document not found', true);
        renderLibrary();
        return;
      }
      state.view = 'reader';
      state.current = doc;
      state.searchHits = [];
      state.noteDraft = null;
      setStatus('');
      await refreshNotes();
      await refreshMediaStats();
      renderReader();
    });
  });

  app.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete');
      if (!confirm('Remove this document (and its stored images) from IndexedDB?')) return;
      revokeObjectUrlsForVersion(id);
      await deleteDoc(id);
      try {
        await deleteMediaForVersion(id);
      } catch {
        /* ignore */
      }
      await refreshLibrary();
      setStatus('Removed from library');
      renderLibrary();
    });
  });

  document.getElementById('chk-include-images')?.addEventListener('change', (e) => {
    state.includeImages = !!e.target.checked;
  });
}

async function doSyncVersion(vid) {
  setStatus(`Trying API sync for ${vid}…`);
  renderLibrary();
  const result = await trySyncFromApi(vid);
  if (result.ok) {
    try {
      const rec = await saveDoc(result.data, 'api-sync');
      let imgMsg = '';
      if (state.includeImages) {
        const sections = rec.content?.sections || [];
        const assets = collectImageAssets(sections);
        if (assets.length) {
          setStatus(`Synced ${rec.designation} — fetching images 0/${assets.length}…`);
          renderLibrary();
          const imgResult = await syncImagesForContent(rec.versionId, sections, {
            skipExisting: true,
            onProgress: (done, total, path) => {
              if (total && done < total) {
                setStatus(
                  `Synced ${rec.designation} — images ${done}/${total}${path ? `: ${path.split('/').pop()}` : ''}`
                );
                // avoid full re-render thrash: update flash only
                const flash = app.querySelector('.flash');
                if (flash) flash.textContent = state.status;
              }
            },
          });
          if (imgResult.corsBlocked) {
            imgMsg = ` · images blocked by CORS (${imgResult.failed}/${imgResult.total}) — import a media pack`;
          } else if (imgResult.failed) {
            imgMsg = ` · images ${imgResult.saved} saved, ${imgResult.failed} failed`;
          } else {
            imgMsg = ` · ${imgResult.saved} image(s) stored`;
          }
        } else {
          imgMsg = ' · no IMAGE assets in content';
        }
      }
      await refreshLibrary();
      setStatus(`Synced ${rec.designation} from API${imgMsg}`);
    } catch (err) {
      setStatus('API OK but save failed: ' + (err.message || err), true);
    }
  } else {
    setStatus(result.message, true);
  }
  renderLibrary();
}

async function doImport(file) {
  try {
    setStatus(`Importing ${file.name}…`);
    renderLibrary();
    const rec = await importFile(file, {
      includeMedia: state.includeImages,
      onProgress: (msg) => {
        setStatus(msg);
        const flash = app.querySelector('.flash');
        if (flash) flash.textContent = state.status;
      },
    });
    await refreshLibrary();
    if (rec.mediaOnly) {
      setStatus(
        `Media pack: stored ${rec.mediaStats?.saved || 0} image(s) for ${rec.versionId}`
      );
    } else {
      const ms = rec.mediaStats;
      const imgBit =
        ms && ms.saved
          ? ` · ${ms.saved} image(s) from pack`
          : state.includeImages
            ? ''
            : '';
      setStatus(`Imported ${rec.designation} — ${rec.title}${imgBit}`);
    }
    renderLibrary();
  } catch (err) {
    setStatus(err.message || String(err), true);
    renderLibrary();
  }
}

function readerActionLinks(versionId) {
  const live = liveVersionUrl(versionId);
  const ms = state.mediaStats;
  const mediaHint = ms
    ? `<p class="hint media-stat-hint">Images in IndexedDB: <strong>${ms.local}</strong> / ${ms.total} referenced</p>`
    : '';
  return `
    <div class="live-links">
      <a class="link-btn primary" href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">Open on live site</a>
      <button type="button" class="secondary" id="btn-export-pack" title="JSON + media/ for air-gap">Export pack</button>
      <button type="button" class="secondary" id="btn-fetch-images" title="GET /v1/storage/files/… when CORS allows">Fetch images</button>
      <label class="file-btn secondary-file">
        Import media pack…
        <input type="file" id="media-pack-input" accept=".zip,application/zip" hidden />
      </label>
    </div>
    ${mediaHint}
    <p class="write-hint">Formal change requests and other writes happen on the live CIM site. Local notes stay in this browser and do not sync to CIM. See docs/CCR-PLAN.md. Offline images use blob: URLs from IndexedDB — never hot-linked when offline.</p>`;
}

function renderNotesPanel() {
  const notes = state.notes || [];
  const open = state.notesPanelOpen !== false;
  const list = notes.length
    ? notes
        .map((n) => {
          const preview = n.body.length > 120 ? `${escapeHtml(n.body.slice(0, 120))}…` : escapeHtml(n.body);
          return `<li class="note-item" data-jump-note="${escapeHtml(n.targetType)}" data-jump-id="${escapeHtml(n.targetId)}">
            <button type="button" class="note-jump" data-jump-note="${escapeHtml(n.targetType)}" data-jump-id="${escapeHtml(n.targetId)}">
              <span class="note-target-label">${escapeHtml(n.targetType)} · ${escapeHtml(n.targetId.slice(0, 8))}…</span>
              <span class="note-preview">${preview}</span>
              <span class="note-when muted">${escapeHtml(formatDate(n.updatedAt))}</span>
            </button>
            <div class="note-item-actions">
              <button type="button" class="secondary" data-edit-note="${escapeHtml(n.id)}">Edit</button>
              <button type="button" class="secondary" data-del-note="${escapeHtml(n.id)}">Delete</button>
            </div>
          </li>`;
        })
        .join('')
    : `<li class="empty muted">No local notes for this version yet. Use <strong>Note</strong> on a section or the ✉ control on a sentence.</li>`;

  return `
    <aside class="notes-panel ${open ? 'open' : 'collapsed'}" aria-label="Local commentary">
      <div class="notes-panel-head">
        <h2>Local notes <span class="note-count-pill">${notes.length}</span></h2>
        <button type="button" class="secondary" id="btn-toggle-notes" aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button>
      </div>
      <p class="hint notes-offline-hint">Offline-only · stored in IndexedDB · never syncs to CIM</p>
      <div class="notes-io" ${open ? '' : 'hidden'}>
        <button type="button" class="secondary" id="btn-notes-export">Export notes JSON</button>
        <label class="file-btn secondary-file">
          Import notes…
          <input type="file" id="notes-import-input" accept=".json,application/json" hidden />
        </label>
      </div>
      <ul class="notes-list" ${open ? '' : 'hidden'}>${list}</ul>
    </aside>`;
}

function renderNoteModal() {
  const d = state.noteDraft;
  if (!d) return '';
  const editing = !!d.noteId;
  return `
    <div class="modal-backdrop" id="note-modal" role="dialog" aria-modal="true" aria-labelledby="note-modal-title">
      <div class="modal">
        <h2 id="note-modal-title">${editing ? 'Edit' : 'Add'} local note</h2>
        <p class="muted">Target: <strong>${escapeHtml(d.targetType)}</strong> <code class="mono">${escapeHtml(d.targetId)}</code></p>
        <label class="sr-only" for="note-body">Note text</label>
        <textarea id="note-body" rows="6" placeholder="Your offline commentary…">${escapeHtml(d.body || '')}</textarea>
        <div class="modal-actions">
          <button type="button" id="note-save">Save</button>
          <button type="button" class="secondary" id="note-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
}

function disconnectTocSpy() {
  if (tocObserver) {
    tocObserver.disconnect();
    tocObserver = null;
  }
}

function setupTocScrollSpy() {
  disconnectTocSpy();
  const links = [...app.querySelectorAll('.toc nav a[href^="#sec-"]')];
  if (!links.length) return;
  const byId = new Map();
  for (const a of links) {
    const id = a.getAttribute('href')?.slice(1);
    if (id) byId.set(id, a);
  }
  const sections = [...app.querySelectorAll('.doc-body .sec[id^="sec-"]')].filter((el) =>
    byId.has(el.id)
  );
  if (!sections.length) return;

  const setActive = (id) => {
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  };

  tocObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    },
    { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.1, 0.5] }
  );
  sections.forEach((el) => tocObserver.observe(el));
}

function renderReader() {
  const doc = state.current;
  if (!doc) {
    state.view = 'library';
    renderLibrary();
    return;
  }
  const c = doc.content.criterion;
  const sections = doc.content.sections || [];
  const versionId = c.versionId;
  const docMeta = {
    designation: c.designation || '',
    title: c.title || '',
    versionNumber: c.versionNumber || '',
    versionId: c.versionId || '',
    datePublished: c.datePublished || '',
  };
  const allRows = flattenRequirements(sections, docMeta);
  const mode = state.readerMode || 'document';
  const metaPanel = renderDocMetaPanel(c, doc.content, {
    importedAt: doc.importedAt,
    source: doc.source,
    requirementCount: allRows.length,
  });

  const modeToggle = `
    <div class="mode-toggle" role="tablist" aria-label="Reader mode">
      <button type="button" class="mode-btn ${mode === 'document' ? 'active' : ''}" data-mode="document" role="tab" aria-selected="${mode === 'document'}">Document</button>
      <button type="button" class="mode-btn ${mode === 'table' ? 'active' : ''}" data-mode="table" role="tab" aria-selected="${mode === 'table'}">Requirements table</button>
    </div>`;

  const header = `
    ${banner()}
    <header class="top reader-top">
      <button type="button" id="btn-back" class="secondary">← Library</button>
      <div class="meta">
        <h1>${escapeHtml(c.designation)} — ${escapeHtml(c.title)}</h1>
        <p class="lede">
          version <strong>${escapeHtml(c.versionNumber || '—')}</strong>
          · <code class="mono">${escapeHtml(c.versionId)}</code>
          ${c.datePublished ? ` · published ${escapeHtml(formatDate(c.datePublished))}` : ''}
        </p>
      </div>
      <div class="reader-actions">
        ${modeToggle}
        ${readerActionLinks(versionId)}
      </div>
    </header>
    ${metaPanel}`;

  let mainHtml = '';
  if (mode === 'table') {
    const q = (state.tableFilter || '').trim().toLowerCase();
    const typeF = state.tableTypeFilter || 'all';
    let rows = allRows;
    if (typeF === 'notes') {
      rows = rows.filter((r) => r.commentary || r.explanation);
    } else if (typeF !== 'all') {
      rows = rows.filter((r) => r.type === typeF);
    }
    if (q) {
      rows = rows.filter((r) =>
        [r.path, r.label, r.heading, r.text, r.commentary, r.explanation, r.status]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }

    const bodyRows = rows.length
      ? rows
          .map((r) => {
            const text = r.text.length > 280 ? `${escapeHtml(r.text.slice(0, 280))}…` : escapeHtml(r.text);
            const notes = [
              r.commentary && `<div class="note"><strong>Commentary:</strong> ${escapeHtml(r.commentary)}</div>`,
              r.explanation && `<div class="note"><strong>Explanation:</strong> ${escapeHtml(r.explanation)}</div>`,
            ]
              .filter(Boolean)
              .join('');
            return `<tr data-sec="${escapeHtml(r.id)}">
              <td class="path">${escapeHtml(r.path || '—')}</td>
              <td class="label">${escapeHtml(r.label || '—')}</td>
              <td class="heading">${escapeHtml(r.heading || '—')}</td>
              <td class="type"><span class="pill">${escapeHtml(r.type || '—')}</span></td>
              <td class="status">${escapeHtml(r.status || '—')}</td>
              <td class="req">${text}${notes}${r.hasTable ? '<div class="flag">Contains table</div>' : ''}${r.hasImage ? '<div class="flag">Contains image ref</div>' : ''}</td>
              <td class="jump"><button type="button" class="secondary" data-jump="${escapeHtml(r.id)}">View</button></td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="7" class="empty">No rows match this filter.</td></tr>`;

    mainHtml = `
      <div class="reader-with-notes">
        <section class="panel table-panel">
          <div class="table-toolbar">
            <input type="search" id="table-filter" placeholder="Filter requirements…" value="${escapeHtml(state.tableFilter || '')}" />
            <select id="table-type">
              <option value="all"${typeF === 'all' ? ' selected' : ''}>All types</option>
              <option value="TEXT"${typeF === 'TEXT' ? ' selected' : ''}>TEXT</option>
              <option value="HEADING"${typeF === 'HEADING' ? ' selected' : ''}>HEADING</option>
              <option value="CHAPTER"${typeF === 'CHAPTER' ? ' selected' : ''}>CHAPTER</option>
              <option value="notes"${typeF === 'notes' ? ' selected' : ''}>Has commentary/explanation</option>
            </select>
            <span class="muted">${rows.length} / ${allRows.length} rows</span>
            <button type="button" id="btn-csv" class="secondary">Export CSV</button>
          </div>
          <p class="hint">Tabular view for project review — filter, then export CSV. “View” switches to Document and jumps to that section.</p>
          <div class="table-scroll req-table-wrap">
            <table class="req-table">
              <thead>
                <tr>
                  <th>Section path</th>
                  <th>Label</th>
                  <th>Heading</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Requirement / notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${bodyRows}</tbody>
            </table>
          </div>
        </section>
        ${renderNotesPanel()}
      </div>`;
  } else {
    const toc = walkToc(sections);
    const body = renderDocumentBody(sections, state.noteCounts);
    const hitsHtml = state.searchHits.length
      ? `<ul class="hits">${state.searchHits
          .map(
            (h) =>
              `<li><a href="#sec-${escapeHtml(h.sectionId)}"><strong>${escapeHtml(h.title)}</strong></a><br/><span class="snippet">${escapeHtml(h.snippet)}</span></li>`
          )
          .join('')}</ul>`
      : state._lastQuery
        ? `<p class="muted">No hits for “${escapeHtml(state._lastQuery)}”.</p>`
        : '';

    mainHtml = `
      <div class="reader-layout">
        <aside class="toc">
          <div class="toc-chrome">
            <h2>Contents</h2>
          </div>
          <nav aria-label="Table of contents">
            <ul>
              ${toc
                .map((t) => {
                  const depthClass = `d${Math.min(t.depth, 4)}`;
                  const typeClass =
                    t.type === 'CHAPTER' || t.type === 'APPENDIX'
                      ? 'toc-chapter'
                      : t.depth >= 2
                        ? 'toc-deep'
                        : 'toc-heading';
                  return `<li class="${depthClass} ${typeClass}"><a href="#sec-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a></li>`;
                })
                .join('')}
            </ul>
          </nav>
          <div class="search-box">
            <h2>Search</h2>
            <form id="search-form">
              <input type="search" id="search-q" placeholder="In-document search…" />
              <button type="submit">Search</button>
            </form>
            <div id="search-results">${hitsHtml}</div>
          </div>
        </aside>
        <main class="doc-body">
          ${body}
        </main>
        ${renderNotesPanel()}
      </div>`;
  }

  disconnectTocSpy();
  app.innerHTML = `${header}${mainHtml}${renderNoteModal()}${statusBlock()}`;

  document.getElementById('btn-back')?.addEventListener('click', async () => {
    disconnectTocSpy();
    if (state.current?.versionId) revokeObjectUrlsForVersion(state.current.versionId);
    state.view = 'library';
    state.current = null;
    state.readerMode = 'document';
    state.notes = [];
    state.noteCounts = {};
    state.noteDraft = null;
    state.mediaStats = null;
    await refreshLibrary();
    renderLibrary();
  });

  document.getElementById('btn-export-pack')?.addEventListener('click', async () => {
    try {
      setStatus('Building pack (JSON + media)…');
      const pack = await buildMediaPackZip(state.current, { includeMedia: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pack.blob);
      a.download = pack.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(
        `Exported ${pack.filename}: ${pack.imageIncluded}/${pack.imageTotal} image(s) included` +
          (pack.imageMissing.length ? ` (${pack.imageMissing.length} missing from IndexedDB)` : '')
      );
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
    renderReader();
  });

  document.getElementById('btn-fetch-images')?.addEventListener('click', async () => {
    const doc = state.current;
    if (!doc) return;
    const versionId = doc.versionId || doc.content?.criterion?.versionId;
    const sections = doc.content?.sections || [];
    const assets = collectImageAssets(sections);
    if (!assets.length) {
      setStatus('This document has no IMAGE mediaAssets (UFC 1-200-01 sample has none).');
      renderReader();
      return;
    }
    setStatus(`Fetching images 0/${assets.length}…`);
    renderReader();
    const result = await syncImagesForContent(versionId, sections, {
      skipExisting: true,
      onProgress: (done, total, path) => {
        if (done < total) {
          setStatus(`Fetching images ${done}/${total}${path ? `: ${path.split('/').pop()}` : ''}`);
          const flash = app.querySelector('.flash');
          if (flash) flash.textContent = state.status;
        }
      },
    });
    await refreshMediaStats();
    if (result.corsBlocked) {
      setStatus(
        `CORS blocked storage fetches (${result.failed}/${result.total}). Import a media pack ZIP with media/… instead.`,
        true
      );
    } else {
      setStatus(
        `Images: ${result.saved} saved, ${result.skipped} already local, ${result.failed} failed (${result.total} total)`
      );
    }
    renderReader();
  });

  document.getElementById('media-pack-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const doc = state.current;
    if (!doc) return;
    try {
      const versionId = doc.versionId || doc.content?.criterion?.versionId;
      setStatus(`Importing media pack ${file.name}…`);
      renderReader();
      const result = await importMediaPackFile(versionId, file, doc.content?.sections || []);
      await refreshMediaStats();
      setStatus(`Media pack: stored ${result.saved} image(s)`);
      renderReader();
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderReader();
    }
  });

  app.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.readerMode = btn.getAttribute('data-mode');
      renderReader();
    });
  });

  bindNotesUi();

  if (mode === 'table') {
    const filterEl = document.getElementById('table-filter');
    const typeEl = document.getElementById('table-type');
    let timer;
    filterEl?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.tableFilter = filterEl.value;
        renderReader();
        const again = document.getElementById('table-filter');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 180);
    });
    typeEl?.addEventListener('change', () => {
      state.tableTypeFilter = typeEl.value;
      renderReader();
    });
    document.getElementById('btn-csv')?.addEventListener('click', () => {
      const csv = requirementsToCsv(allRows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(c.designation || 'ufc').replace(/\s+/g, '-')}-requirements.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(`Exported ${allRows.length} rows to CSV`);
    });
    app.querySelectorAll('[data-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-jump');
        state.readerMode = 'document';
        state._jumpTo = id;
        renderReader();
      });
    });
  } else {
    document.getElementById('search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('search-q')?.value || '';
      state._lastQuery = q;
      state.searchHits = searchDocument(sections, q);
      renderReader();
      const input = document.getElementById('search-q');
      if (input) {
        input.value = q;
        input.focus();
      }
    });
    setupTocScrollSpy();
    if (state._jumpTo) {
      const id = state._jumpTo;
      state._jumpTo = null;
      requestAnimationFrame(() => {
        document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    // Offline IMAGE hydrate: blob: object URLs from IndexedDB (never hot-link API)
    const versionId = c.versionId;
    const bodyEl = app.querySelector('.doc-body');
    if (bodyEl) {
      hydrateDocumentImages(bodyEl, versionId).then((r) => {
        if (r.missing || r.hydrated) {
          /* keep quiet unless useful */
        }
      });
    }
  }
}

function bindNotesUi() {
  document.getElementById('btn-toggle-notes')?.addEventListener('click', () => {
    state.notesPanelOpen = !state.notesPanelOpen;
    renderReader();
  });

  document.getElementById('btn-notes-export')?.addEventListener('click', async () => {
    try {
      const versionId = state.current?.versionId || state.current?.content?.criterion?.versionId;
      const payload = await exportNotesJson(versionId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const des = (state.current?.designation || 'notes').replace(/\s+/g, '-');
      a.download = `${des}-notes.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(`Exported ${payload.notes.length} note(s)`);
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderReader();
    }
  });

  document.getElementById('notes-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw new Error('Notes file is not valid JSON');
      }
      const versionId = state.current?.versionId || state.current?.content?.criterion?.versionId;
      const choice = window.prompt(
        'Import mode for local notes:\n\n' +
          'merge — keep existing notes; add/update from file (by id or same target)\n' +
          'replace — delete this version’s notes, then import from file\n\n' +
          'Type merge or replace:',
        'merge'
      );
      if (choice == null) return;
      const mode = String(choice).trim().toLowerCase() === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace') {
        const ok = confirm(
          'Replace will delete all local notes for this document version, then import from the file. Continue?'
        );
        if (!ok) return;
      }
      const result = await importNotesPayload(raw, { mode, versionId });
      await refreshNotes();
      setStatus(
        `Notes ${result.mode}: saved ${result.saved}` +
          (result.deleted ? `, removed ${result.deleted}` : '') +
          (result.updated ? ` (${result.updated} updated)` : '')
      );
      renderReader();
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderReader();
    }
  });

  const openDraft = (targetType, targetId, existing) => {
    state.noteDraft = {
      targetType,
      targetId,
      noteId: existing?.id || null,
      body: existing?.body || '',
      createdAt: existing?.createdAt,
    };
    renderReader();
    requestAnimationFrame(() => document.getElementById('note-body')?.focus());
  };

  app.querySelectorAll('[data-note-target]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetType = btn.getAttribute('data-note-target');
      const targetId = btn.getAttribute('data-note-id');
      if (!targetType || !targetId) return;
      const existing = (state.notes || []).find(
        (n) => n.targetType === targetType && n.targetId === targetId
      );
      openDraft(targetType, targetId, existing || null);
    });
  });

  app.querySelectorAll('[data-edit-note]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-edit-note');
      const n = (state.notes || []).find((x) => x.id === id);
      if (n) openDraft(n.targetType, n.targetId, n);
    });
  });

  app.querySelectorAll('[data-del-note]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-del-note');
      if (!confirm('Delete this local note?')) return;
      await deleteNote(id);
      await refreshNotes();
      setStatus('Note deleted');
      renderReader();
    });
  });

  app.querySelectorAll('[data-jump-note]').forEach((el) => {
    if (el.tagName === 'LI') return;
    el.addEventListener('click', () => {
      const type = el.getAttribute('data-jump-note');
      const id = el.getAttribute('data-jump-id');
      if (state.readerMode !== 'document') {
        state.readerMode = 'document';
        state._jumpTo = type === 'section' ? id : null;
        state._jumpSentence = type === 'sentence' ? id : null;
        renderReader();
        return;
      }
      jumpToNoteTarget(type, id);
    });
  });

  document.getElementById('note-cancel')?.addEventListener('click', () => {
    state.noteDraft = null;
    renderReader();
  });

  document.getElementById('note-save')?.addEventListener('click', async () => {
    const body = document.getElementById('note-body')?.value || '';
    const d = state.noteDraft;
    if (!d) return;
    try {
      const versionId = state.current?.versionId || state.current?.content?.criterion?.versionId;
      await saveNote({
        id: d.noteId || undefined,
        versionId,
        targetType: d.targetType,
        targetId: d.targetId,
        body,
        createdAt: d.createdAt,
      });
      state.noteDraft = null;
      await refreshNotes();
      setStatus('Note saved (local only)');
      renderReader();
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderReader();
    }
  });

  document.getElementById('note-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'note-modal') {
      state.noteDraft = null;
      renderReader();
    }
  });

  if (state._jumpSentence) {
    const sid = state._jumpSentence;
    state._jumpSentence = null;
    requestAnimationFrame(() => {
      const el = app.querySelector(`.sentence[data-sid="${CSS.escape(sid)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('note-flash');
      setTimeout(() => el?.classList.remove('note-flash'), 1600);
    });
  }
}

function jumpToNoteTarget(type, id) {
  if (type === 'section') {
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (type === 'sentence') {
    const el = app.querySelector(`.sentence[data-sid="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('note-flash');
    setTimeout(() => el?.classList.remove('note-flash'), 1600);
  }
}

async function boot() {
  if (!state.syncAsOf) {
    // Default asOf: today (local), clamped sensibly for snapshot API (not future beyond today)
    const d = new Date();
    state.syncAsOf = d.toISOString().slice(0, 10);
  }
  try {
    await refreshLibrary();
  } catch (err) {
    setStatus('IndexedDB error: ' + (err.message || err), true);
  }
  renderLibrary();
}

boot();
