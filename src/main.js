import './style.css';
import { listDocs, getDoc, deleteDoc, saveDoc } from './db.js';
import { importFile, importFromUrl } from './import.js';
import { walkToc, renderDocumentBody, searchDocument, escapeHtml } from './render.js';
import { trySyncFromApi, liveVersionUrl } from './api.js';

const FIXTURE = '/fixtures/ufc-1-200-01-content.json';
const SAMPLE_VERSION_ID = 'a093a449-9220-45e0-866a-67d3139af067';

const app = document.querySelector('#app');
let state = {
  view: 'library', // library | reader
  docs: [],
  current: null,
  searchHits: [],
  status: '',
  error: '',
};

async function refreshLibrary() {
  state.docs = await listDocs();
}

function setStatus(msg, isError = false) {
  state.status = isError ? '' : msg;
  state.error = isError ? msg : '';
}

function banner() {
  return `<div class="banner" role="status">Offline snapshot · not live CIM</div>`;
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
      <p class="lede">Import public CIM JSON or JSON.zip into this browser’s IndexedDB, then read fully offline. API sync is optional and often blocked by CORS outside digital.wbdg.org.</p>
    </header>

    <section class="panel">
      <h2>Import</h2>
      <div class="import-row">
        <label class="file-btn">
          Choose .json or .zip
          <input type="file" id="file-input" accept=".json,.zip,application/json,application/zip" hidden />
        </label>
        <button type="button" id="btn-fixture">Import sample fixture (UFC 1-200-01)</button>
        <a class="link-btn" href="${FIXTURE}" download="ufc-1-200-01-content.json">Download fixture</a>
      </div>
      <div id="drop-zone" class="drop-zone" tabindex="0">
        Or drag &amp; drop a <code>.json</code> / <code>.zip</code> here
        <span class="hint">Sample path: <code>public/fixtures/ufc-1-200-01-content.json</code></span>
      </div>
      <p class="hint">Accepts API wrapper <code>{ statusCode, success, data }</code> or unwrapped <code>{ criterion, sections }</code>. ZIP must contain a <code>.json</code> file.</p>
    </section>

    <section class="panel">
      <h2>Sync from API (Mode B stub)</h2>
      <div class="sync-row">
        <input id="sync-version" type="text" value="${SAMPLE_VERSION_ID}" aria-label="versionId" />
        <button type="button" id="btn-sync">Try sync</button>
      </div>
      <p class="hint">Calls <code>GET https://api.digital.wbdg.org/v1/versions/{id}/content</code>. On CORS failure, shows Import guidance — no proxy.</p>
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

  document.getElementById('btn-sync')?.addEventListener('click', async () => {
    const vid = document.getElementById('sync-version')?.value?.trim() || SAMPLE_VERSION_ID;
    setStatus('Trying API sync…');
    renderLibrary();
    const result = await trySyncFromApi(vid);
    if (result.ok) {
      try {
        const rec = await saveDoc(result.data, 'api-sync');
        await refreshLibrary();
        setStatus(`Synced ${rec.designation} from API`);
      } catch (err) {
        setStatus('API OK but save failed: ' + (err.message || err), true);
      }
    } else {
      setStatus(result.message, true);
    }
    renderLibrary();
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
      setStatus('');
      renderReader();
    });
  });

  app.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete');
      if (!confirm('Remove this document from IndexedDB?')) return;
      await deleteDoc(id);
      await refreshLibrary();
      setStatus('Removed from library');
      renderLibrary();
    });
  });
}

async function doImport(file) {
  try {
    setStatus(`Importing ${file.name}…`);
    renderLibrary();
    const rec = await importFile(file);
    await refreshLibrary();
    setStatus(`Imported ${rec.designation} — ${rec.title}`);
    renderLibrary();
  } catch (err) {
    setStatus(err.message || String(err), true);
    renderLibrary();
  }
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
  const toc = walkToc(sections);
  const body = renderDocumentBody(sections);
  const live = liveVersionUrl(c.versionId);

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

  app.innerHTML = `
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
        <a class="link-btn primary" href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">Open on live site</a>
      </div>
    </header>

    <div class="reader-layout">
      <aside class="toc">
        <h2>Contents</h2>
        <nav>
          <ul>
            ${toc
              .map(
                (t) =>
                  `<li class="d${t.depth}"><a href="#sec-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a></li>`
              )
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
    </div>
    ${statusBlock()}
  `;

  document.getElementById('btn-back')?.addEventListener('click', async () => {
    state.view = 'library';
    state.current = null;
    await refreshLibrary();
    renderLibrary();
  });

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
}

async function boot() {
  try {
    await refreshLibrary();
  } catch (err) {
    setStatus('IndexedDB error: ' + (err.message || err), true);
  }
  renderLibrary();
}

boot();
