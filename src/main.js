import './style.css';
import { listDocs, getDoc, deleteDoc } from './db.js';
import { importFile, importFromUrl, importMediaPackFile } from './import.js';
import {
  walkToc,
  renderDocumentBody,
  searchDocument,
  escapeHtml,
  flattenRequirements,
  requirementsToCsv,
  renderDocMetaPanel,
  buildNoteTargetIndex,
} from './render.js';
import { renderUserManualHtml } from './manual.js';
import { liveVersionUrl, loadCachedDirectory } from './api.js';
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
  hydrateDocumentImages,
  buildMediaPackZip,
  buildWorkspacePackZip,
  deleteMediaForVersion,
  listMediaForVersion,
  revokeAllObjectUrls,
  revokeObjectUrlsForVersion,
} from './media.js';
import {
  renderWorkspaceBar,
  bindWorkspaceBar,
  loadWorkspaceState,
  getActiveWorkspaceId,
} from './workspaces.js';

const FIXTURE = './fixtures/ufc-1-200-01-content.json'
const IMAGE_DEMO_PACK = './fixtures/image-demo-pack.zip'
const app = document.querySelector('#app');
function applyPrintPreviewHash() {
  document.body.classList.toggle('force-print', location.hash === '#print-preview');
}
applyPrintPreviewHash();
window.addEventListener('hashchange', applyPrintPreviewHash);


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
  directory: null, // cached static catalog only
  directoryFilter: '',
  mediaStats: null, // { total, local } for current doc
  samplesOpen: false,
  catalogOpen: false, // Samples → show cached catalog
  metaDetailsOpen: false, // reader Details disclosure
  applicableProject: '', // mirrors active workspace name
  workspaces: [],
  activeWorkspaceId: getActiveWorkspaceId(),
  manualOpen: false,
  notesFilter: '',
  notesFilterType: 'all', // all | section | sentence
  activeNoteId: null,
  targetIndex: {},
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
  return `<div class="banner" role="status">Offline snapshot · import a pack to read</div>`;
}

function projectBar(opts = {}) {
  return renderWorkspaceBar({
    workspaces: state.workspaces || [],
    activeWorkspaceId: state.activeWorkspaceId || getActiveWorkspaceId(),
    compact: !!opts.compact,
  });
}

async function handleWorkspaceChanged(flags = {}) {
  await loadWorkspaceState(state);
  if (flags.switched || flags.deleted || flags.created) {
    revokeAllObjectUrls();
    state.current = null;
    state.view = 'library';
    state.notes = [];
    state.noteCounts = {};
    state.noteDraft = null;
    state.mediaStats = null;
    state.searchHits = [];
    state.activeNoteId = null;
    state.targetIndex = {};
    await refreshLibrary();
    renderLibrary();
    return;
  }
  if (state.view === 'reader' && state.current) {
    renderWithScrollPreserve(() => renderReader());
  } else {
    await refreshLibrary();
    renderLibrary();
  }
}

function bindProjectBar(_rerender) {
  bindWorkspaceBar({
    getState: () => state,
    setStatus,
    onChanged: handleWorkspaceChanged,
  });
}

function renderDirectoryBlock() {
  const dir = state.directory;
  if (!dir) {
    return `<p class="hint dir-empty">No catalog loaded yet. Use <strong>Show cached catalog</strong> under Samples, or import a pack to read offline.</p>`;
  }
  if (!dir.ok) {
    return `<div class="dir-banner error">
      <p><strong>Could not load catalog.</strong> ${escapeHtml(dir.message || 'Unknown error')}</p>
      <p class="hint">Import a pack above to add documents to your library.</p>
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
  const rows = items.length
    ? items
        .map((i) => {
          const inLib = state.docs.some((d) => d.versionId === i.versionId);
          const live = liveVersionUrl(i.versionId);
          return `<tr>
            <td><strong>${escapeHtml(i.designation)}</strong></td>
            <td>${escapeHtml(i.title)}</td>
            <td>${escapeHtml(i.versionNumber || '—')}</td>
            <td class="actions">
              ${inLib ? '<span class="muted">In library</span>' : '<span class="muted">Import pack to read offline</span>'}
              <a class="link-btn" href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">Open on live site</a>
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="4" class="empty">No documents match this filter.</td></tr>`;
  return `
    <div class="dir-banner">
      <div class="dir-banner-head">
        <strong>${escapeHtml(dir.label || 'Cached catalog')}</strong>
        <span class="pill warn">may be outdated</span>
        <span class="muted">${items.length} / ${(dir.items || []).length} shown</span>
      </div>
      <div class="sync-row" style="margin-top:0.5rem">
        <input type="search" id="dir-filter" placeholder="Filter catalog…" value="${escapeHtml(state.directoryFilter || '')}" />
      </div>
      <div class="table-scroll dir-table-wrap">
        <table class="lib dir-table">
          <thead>
            <tr>
              <th>Designation</th>
              <th>Title</th>
              <th>Version</th>
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
    : `<tr><td colspan="6" class="empty">Library is empty. Use <strong>Import pack</strong> below, or open <strong>Samples</strong>.</td></tr>`;

  const samplesOpen = state.samplesOpen ? ' open' : '';
  const catalogBlock = state.catalogOpen ? renderDirectoryBlock() : '';

  app.innerHTML = `
    ${banner()}
    <header class="top library-top">
      <div class="meta">
        <h1>UFC Offline Viewer</h1>
        <p class="lede">Import a UFC pack to read offline, take local notes, and open the live site when you need the current published version.</p>
      </div>
      <div class="header-actions">
        <button type="button" class="secondary quiet-help" id="btn-manual">User manual</button>
      </div>
    </header>

    ${projectBar()}
    ${statusBlock()}

    <section class="panel library-panel" id="library-panel">
      <div class="library-heading-row">
        <h2>Library</h2>
        <button type="button" class="secondary" id="btn-export-workspace" title="Download all docs + media in this workspace">Export workspace pack</button>
      </div>
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

    <section class="panel import-panel">
      <h2>Import pack</h2>
      <div class="import-row">
        <label class="file-btn">
          Choose .json or .zip
          <input type="file" id="file-input" accept=".json,.zip,application/json,application/zip" hidden />
        </label>
      </div>
      <div id="drop-zone" class="drop-zone" tabindex="0">
        Or drag &amp; drop a pack here
        <span class="hint">JSON content, or ZIP with figures included</span>
      </div>
      <details class="disclosure samples-disclosure" id="samples-details"${samplesOpen}>
        <summary>Samples</summary>
        <div class="disclosure-body">
          <div class="import-row">
            <button type="button" id="btn-fixture">Import sample (UFC 1-200-01)</button>
            <button type="button" class="secondary" id="btn-image-demo">Import image demo pack</button>
            <a class="link-btn" href="${FIXTURE}" download="ufc-1-200-01-content.json">Download sample</a>
            <a class="link-btn" href="${IMAGE_DEMO_PACK}" download="image-demo-pack.zip">Download image demo</a>
          </div>
          <p class="hint">The UFC sample has no figures — use the image demo to try rendering and “not in pack”.</p>
          <div class="import-row" style="margin-top:0.75rem">
            <button type="button" class="secondary" id="btn-load-cached">${state.catalogOpen ? 'Refresh catalog' : 'Show cached catalog'}</button>
            ${state.catalogOpen ? '<button type="button" class="secondary" id="btn-hide-cached">Hide catalog</button>' : ''}
          </div>
          <p class="hint">Optional title list for discovery — import a pack to read offline.</p>
          ${catalogBlock}
        </div>
      </details>
    </section>
    ${renderManualModal()}
  `;

  bindLibrary();
  bindManualUi(() => renderLibrary());
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
  bindProjectBar(() => renderLibrary());

  document.getElementById('btn-export-workspace')?.addEventListener('click', async () => {
    try {
      if (!state.docs.length) {
        setStatus('Library is empty — nothing to export', true);
        renderLibrary();
        return;
      }
      setStatus('Building workspace pack…');
      renderLibrary();
      const ws =
        (state.workspaces || []).find((w) => w.id === state.activeWorkspaceId) || {
          id: state.activeWorkspaceId,
          name: state.applicableProject || 'workspace',
        };
      const pack = await buildWorkspacePackZip(state.docs, ws);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pack.blob);
      a.download = pack.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(
        `Exported ${pack.filename}: ${pack.docCount} doc(s), ${pack.imageIncluded}/${pack.imageTotal} figure(s)`
      );
      renderLibrary();
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderLibrary();
    }
  });

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
          'Opened from disk (file://): use Choose .json or .zip and pick fixtures/image-demo-pack.zip',
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

  document.getElementById('btn-load-cached')?.addEventListener('click', async () => {
    setStatus('Loading catalog…');
    state.catalogOpen = true;
    state.samplesOpen = true;
    renderLibrary();
    const result = await loadCachedDirectory();
    state.directory = result;
    state.directoryFilter = '';
    if (result.ok) {
      setStatus(`Catalog: ${result.items.length} documents`);
    } else {
      setStatus(result.message || 'Cached catalog missing', true);
    }
    renderLibrary();
  });

  document.getElementById('btn-hide-cached')?.addEventListener('click', () => {
    state.catalogOpen = false;
    setStatus('');
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
      if (!confirm('Remove this document and its stored images from your library?')) return;
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

  document.getElementById('samples-details')?.addEventListener('toggle', (e) => {
    state.samplesOpen = e.target.open;
  });
}

async function doImport(file) {
  try {
    setStatus(`Importing ${file.name}…`);
    renderLibrary();
    const rec = await importFile(file, {
      includeMedia: true,
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
          : ''
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
    ? `<p class="hint media-stat-hint">Figures available: <strong>${ms.local}</strong> of ${ms.total}</p>`
    : '';
  return `
    <div class="live-links">
      <a class="link-btn primary" href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">Open on live site</a>
      <button type="button" class="secondary" id="btn-print" title="Print this document with a clean layout">Print</button>
      <button type="button" class="secondary" id="btn-export-pack" title="Download content + figures for handoff">Export pack</button>
      <label class="file-btn secondary-file">
        Import media pack…
        <input type="file" id="media-pack-input" accept=".zip,application/zip" hidden />
      </label>
      <button type="button" class="secondary quiet-help" id="btn-manual">User manual</button>
    </div>
    ${mediaHint}`;
}

function noteOwnershipLabel(n) {
  const idx = state.targetIndex || {};
  const meta = idx[`${n.targetType}:${n.targetId}`];
  if (!meta) {
    return {
      kindLabel: n.targetType === 'sentence' ? 'Paragraph' : 'Section',
      path: n.targetId.slice(0, 10) + '…',
      snippet: '',
    };
  }
  return {
    kindLabel: meta.kind === 'sentence' ? 'Paragraph' : 'Section',
    path: meta.path || meta.title,
    snippet: meta.preview || '',
  };
}

function renderNotesPanel() {
  const allNotes = state.notes || [];
  const open = state.notesPanelOpen !== false;
  const q = (state.notesFilter || '').trim().toLowerCase();
  const typeF = state.notesFilterType || 'all';
  let notes = allNotes;
  if (typeF === 'section' || typeF === 'sentence') {
    notes = notes.filter((n) => n.targetType === typeF);
  }
  if (q) {
    notes = notes.filter((n) => {
      const own = noteOwnershipLabel(n);
      return [n.body, own.path, own.snippet, own.kindLabel, n.targetType]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }

  const list = notes.length
    ? notes
        .map((n) => {
          const own = noteOwnershipLabel(n);
          const preview = n.body.length > 160 ? `${escapeHtml(n.body.slice(0, 160))}…` : escapeHtml(n.body);
          const active = state.activeNoteId === n.id ? ' active' : '';
          const snippet = own.snippet
            ? `<span class="note-src-snippet muted">${escapeHtml(own.snippet)}</span>`
            : '';
          return `<li class="note-item${active}" data-note-row="${escapeHtml(n.id)}">
            <button type="button" class="note-jump" data-jump-note="${escapeHtml(n.targetType)}" data-jump-id="${escapeHtml(n.targetId)}" data-activate-note="${escapeHtml(n.id)}">
              <span class="note-target-label"><span class="note-kind">${escapeHtml(own.kindLabel)}</span> · ${escapeHtml(own.path)}</span>
              ${snippet}
              <span class="note-preview">${preview}</span>
              <span class="note-when muted">${escapeHtml(formatDate(n.updatedAt))}</span>
            </button>
            <div class="note-item-actions">
              <button type="button" class="secondary" data-jump-note="${escapeHtml(n.targetType)}" data-jump-id="${escapeHtml(n.targetId)}" data-activate-note="${escapeHtml(n.id)}">Jump</button>
              <button type="button" class="secondary" data-edit-note="${escapeHtml(n.id)}">Edit</button>
              <button type="button" class="secondary danger-quiet" data-del-note="${escapeHtml(n.id)}">Delete</button>
            </div>
          </li>`;
        })
        .join('')
    : allNotes.length
      ? `<li class="empty muted">No notes match this filter.</li>`
      : `<li class="empty muted">No local notes yet. Use <strong>Note</strong> on a section heading, or the marker on a sentence.</li>`;

  return `
    <aside class="notes-panel ${open ? 'open' : 'collapsed'}" aria-label="Local commentary">
      <div class="notes-panel-head">
        <h2>Local notes <span class="note-count-pill">${allNotes.length}</span></h2>
        <button type="button" class="secondary" id="btn-toggle-notes" aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button>
      </div>
      <p class="hint notes-offline-hint">Stays on this device · never syncs to the live site</p>
      <div class="notes-toolbar" ${open ? '' : 'hidden'}>
        <input type="search" id="notes-filter" placeholder="Filter notes…" value="${escapeHtml(state.notesFilter || '')}" />
        <select id="notes-type-filter" aria-label="Filter by target">
          <option value="all"${typeF === 'all' ? ' selected' : ''}>All</option>
          <option value="section"${typeF === 'section' ? ' selected' : ''}>Sections</option>
          <option value="sentence"${typeF === 'sentence' ? ' selected' : ''}>Paragraphs</option>
        </select>
      </div>
      <div class="notes-io" ${open ? '' : 'hidden'}>
        <button type="button" class="secondary" id="btn-notes-export">Export notes</button>
        <label class="file-btn secondary-file">
          Import notes…
          <input type="file" id="notes-import-input" accept=".json,application/json" hidden />
        </label>
      </div>
      <p class="hint notes-filter-meta" ${open ? '' : 'hidden'}>${notes.length} shown${q || typeF !== 'all' ? ` · ${allNotes.length} total` : ''}</p>
      <ul class="notes-list" ${open ? '' : 'hidden'}>${list}</ul>
    </aside>`;
}

function renderNoteModal() {
  const d = state.noteDraft;
  if (!d) return '';
  const editing = !!d.noteId;
  const meta = (state.targetIndex || {})[`${d.targetType}:${d.targetId}`];
  const kindLabel = d.targetType === 'sentence' ? 'Paragraph' : 'Section';
  const path = meta?.path || meta?.title || d.targetId;
  const snippet = meta?.preview
    ? `<blockquote class="note-target-quote">${escapeHtml(meta.preview)}</blockquote>`
    : '';
  return `
    <div class="modal-backdrop" id="note-modal" role="dialog" aria-modal="true" aria-labelledby="note-modal-title">
      <div class="modal note-edit-modal">
        <h2 id="note-modal-title">${editing ? 'Edit' : 'Add'} local note</h2>
        <p class="note-target-meta"><span class="note-kind">${escapeHtml(kindLabel)}</span> · ${escapeHtml(path)}</p>
        ${snippet}
        <label class="sr-only" for="note-body">Note text</label>
        <textarea id="note-body" rows="7" placeholder="Your commentary for this passage…">${escapeHtml(d.body || '')}</textarea>
        <div class="modal-actions">
          <button type="button" class="secondary" id="note-cancel">Cancel</button>
          <button type="button" id="note-save">Save note</button>
        </div>
        <p class="hint modal-hint">Esc cancels · stays on this device only</p>
      </div>
    </div>`;
}

function renderManualModal() {
  if (!state.manualOpen) return '';
  return `
    <div class="modal-backdrop manual-backdrop" id="manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-title">
      <div class="modal manual-modal">
        <div class="manual-modal-chrome">
          <button type="button" class="secondary" id="manual-close">Close</button>
        </div>
        ${renderUserManualHtml()}
      </div>
    </div>`;
}

function captureScroll() {
  return {
    y: window.scrollY,
    body: app.querySelector('.doc-body')?.scrollTop ?? null,
    notes: app.querySelector('.notes-panel')?.scrollTop ?? null,
  };
}

function restoreScroll(saved) {
  if (!saved) return;
  requestAnimationFrame(() => {
    window.scrollTo(0, saved.y || 0);
    const body = app.querySelector('.doc-body');
    if (body && saved.body != null) body.scrollTop = saved.body;
    const notes = app.querySelector('.notes-panel');
    if (notes && saved.notes != null) notes.scrollTop = saved.notes;
  });
}

function renderWithScrollPreserve(fn) {
  const saved = captureScroll();
  fn();
  restoreScroll(saved);
}

function bindManualUi(rerender) {
  document.getElementById('btn-manual')?.addEventListener('click', () => {
    state.manualOpen = true;
    rerender();
  });
  const close = () => {
    if (!state.manualOpen) return;
    state.manualOpen = false;
    rerender();
  };
  document.getElementById('manual-close')?.addEventListener('click', close);
  document.getElementById('manual-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'manual-modal') close();
  });
  if (state.manualOpen) {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        document.removeEventListener('keydown', onKey);
        close();
      }
    };
    document.addEventListener('keydown', onKey);
  }
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
  state.targetIndex = buildNoteTargetIndex(sections);
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
    open: state.metaDetailsOpen,
  });

  const modeToggle = `
    <div class="mode-toggle" role="tablist" aria-label="Reader mode">
      <button type="button" class="mode-btn ${mode === 'document' ? 'active' : ''}" data-mode="document" role="tab" aria-selected="${mode === 'document'}">Document</button>
      <button type="button" class="mode-btn ${mode === 'table' ? 'active' : ''}" data-mode="table" role="tab" aria-selected="${mode === 'table'}">Requirements table</button>
    </div>`;

  const header = `
    ${banner()}
    ${projectBar({ compact: true })}
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
    <div class="print-only print-doc-header" aria-hidden="true">
      <p class="print-kicker">UFC Offline Viewer · field printout</p>
      <h1 class="print-title">${escapeHtml(c.designation)} — ${escapeHtml(c.title)}</h1>
      <p class="print-meta">
        Version ${escapeHtml(c.versionNumber || '—')}
        · ${escapeHtml(c.versionId)}
        ${c.datePublished ? ` · Published ${escapeHtml(formatDate(c.datePublished))}` : ''}
        · Applicable project: <strong>${escapeHtml(state.applicableProject || '—')}</strong>
      </p>
    </div>
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
          <p class="hint">Filter and export CSV for review. <strong>View</strong> jumps to that section in Document mode.</p>
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
  app.innerHTML = `${header}${mainHtml}${renderNoteModal()}${renderManualModal()}${statusBlock()}`;

  bindProjectBar(() => renderWithScrollPreserve(() => renderReader()));
  bindManualUi(() => renderWithScrollPreserve(() => renderReader()));

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
    state.notesFilter = '';
    state.notesFilterType = 'all';
    state.activeNoteId = null;
    state.targetIndex = {};
    state.manualOpen = false;
    await refreshLibrary();
    renderLibrary();
  });

  document.getElementById('meta-details')?.addEventListener('toggle', (e) => {
    state.metaDetailsOpen = e.target.open;
  });

  document.getElementById('btn-print')?.addEventListener('click', () => {
    window.print();
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
        `Exported ${pack.filename}: ${pack.imageIncluded}/${pack.imageTotal} figure(s) included` +
          (pack.imageMissing.length ? ` (${pack.imageMissing.length} missing from library)` : '')
      );
    } catch (err) {
      setStatus(err.message || String(err), true);
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
    renderWithScrollPreserve(() => renderReader());
  });

  let notesFilterTimer;
  document.getElementById('notes-filter')?.addEventListener('input', (e) => {
    clearTimeout(notesFilterTimer);
    notesFilterTimer = setTimeout(() => {
      state.notesFilter = e.target.value || '';
      renderWithScrollPreserve(() => renderReader());
      const again = document.getElementById('notes-filter');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }, 140);
  });

  document.getElementById('notes-type-filter')?.addEventListener('change', (e) => {
    state.notesFilterType = e.target.value || 'all';
    renderWithScrollPreserve(() => renderReader());
  });

  document.getElementById('btn-notes-export')?.addEventListener('click', async () => {
    try {
      const versionId = state.current?.versionId || state.current?.content?.criterion?.versionId;
      const payload = await exportNotesJson(versionId, {
        applicableProject: state.applicableProject || null,
        workspaceName: state.applicableProject || null,
        workspaceId: state.activeWorkspaceId || getActiveWorkspaceId(),
      });
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
      renderWithScrollPreserve(() => renderReader());
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
          'merge — keep existing notes; add/update from file\n' +
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
      renderWithScrollPreserve(() => renderReader());
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderWithScrollPreserve(() => renderReader());
    }
  });

  const openDraft = (targetType, targetId, existing) => {
    const saved = captureScroll();
    state._scrollPreserve = saved;
    state.noteDraft = {
      targetType,
      targetId,
      noteId: existing?.id || null,
      body: existing?.body || '',
      createdAt: existing?.createdAt,
    };
    if (existing?.id) state.activeNoteId = existing.id;
    renderReader();
    restoreScroll(saved);
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
      const saved = captureScroll();
      await deleteNote(id);
      if (state.activeNoteId === id) state.activeNoteId = null;
      await refreshNotes();
      setStatus('Note deleted');
      renderReader();
      restoreScroll(saved);
    });
  });

  app.querySelectorAll('[data-jump-note]').forEach((el) => {
    if (el.tagName === 'LI') return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = el.getAttribute('data-jump-note');
      const id = el.getAttribute('data-jump-id');
      const activate = el.getAttribute('data-activate-note');
      if (activate) state.activeNoteId = activate;
      if (state.readerMode !== 'document') {
        state.readerMode = 'document';
        state._jumpTo = type === 'section' ? id : null;
        state._jumpSentence = type === 'sentence' ? id : null;
        renderReader();
        return;
      }
      jumpToNoteTarget(type, id);
      // Refresh active highlight without losing scroll much
      app.querySelectorAll('.note-item').forEach((li) => {
        li.classList.toggle('active', li.getAttribute('data-note-row') === state.activeNoteId);
      });
    });
  });

  const closeDraft = () => {
    const saved = state._scrollPreserve || captureScroll();
    state.noteDraft = null;
    state._scrollPreserve = null;
    renderReader();
    restoreScroll(saved);
  };

  document.getElementById('note-cancel')?.addEventListener('click', closeDraft);

  document.getElementById('note-save')?.addEventListener('click', async () => {
    const body = document.getElementById('note-body')?.value || '';
    const d = state.noteDraft;
    if (!d) return;
    try {
      const versionId = state.current?.versionId || state.current?.content?.criterion?.versionId;
      const savedScroll = state._scrollPreserve || captureScroll();
      const record = await saveNote({
        id: d.noteId || undefined,
        versionId,
        targetType: d.targetType,
        targetId: d.targetId,
        body,
        createdAt: d.createdAt,
      });
      state.noteDraft = null;
      state._scrollPreserve = null;
      state.activeNoteId = record.id;
      state.notesPanelOpen = true;
      await refreshNotes();
      setStatus('Note saved');
      renderReader();
      restoreScroll(savedScroll);
      requestAnimationFrame(() => {
        jumpToNoteTarget(record.targetType, record.targetId);
        const row = app.querySelector(`[data-note-row="${CSS.escape(record.id)}"]`);
        row?.scrollIntoView({ block: 'nearest' });
      });
    } catch (err) {
      setStatus(err.message || String(err), true);
      renderWithScrollPreserve(() => renderReader());
    }
  });

  document.getElementById('note-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'note-modal') closeDraft();
  });

  const onKey = (e) => {
    if (e.key === 'Escape' && state.noteDraft) {
      e.preventDefault();
      document.removeEventListener('keydown', onKey);
      closeDraft();
    }
  };
  if (state.noteDraft) {
    document.addEventListener('keydown', onKey);
  }

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
    const el = document.getElementById(`sec-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.classList.add('note-flash');
    setTimeout(() => el?.classList.remove('note-flash'), 1600);
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
    await loadWorkspaceState(state);
    await refreshLibrary();
  } catch (err) {
    setStatus('Could not open local library: ' + (err.message || err), true);
  }
  renderLibrary();
}

boot();
