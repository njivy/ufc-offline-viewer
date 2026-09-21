/** In-app User manual + Technical notes (kept out of primary chrome). */

export function renderUserManualHtml() {
  return `
    <article class="manual-doc">
      <header class="manual-header">
        <h2 id="manual-title">User manual</h2>
        <p class="manual-lede">Read UFC / CIM snapshots offline, annotate locally, and open the live site when you need the current published version.</p>
      </header>

      <nav class="manual-toc" aria-label="Manual sections">
        <a href="#man-purpose">Purpose</a>
        <a href="#man-import">Import packs</a>
        <a href="#man-project">Applicable project</a>
        <a href="#man-reading">Reading</a>
        <a href="#man-notes">Local commentary</a>
        <a href="#man-export">Export</a>
        <a href="#man-live">Open on live site</a>
        <a href="#man-airgap">Air-gap tips</a>
        <a href="#man-tech">Technical notes</a>
      </nav>

      <section id="man-purpose" class="manual-section">
        <h3>Purpose</h3>
        <p>This viewer stores imported UFC content on your device so you can read criteria without a network connection. It is a snapshot viewer — not a live connection to the Criteria Management system.</p>
        <ul>
          <li><strong>Import</strong> JSON or ZIP packs to build your library.</li>
          <li><strong>Read</strong> with table of contents, search, and an optional requirements table.</li>
          <li><strong>Annotate</strong> with local commentary that stays on this device.</li>
          <li><strong>Open on live site</strong> when you need the current published document or formal change requests.</li>
        </ul>
      </section>

      <section id="man-import" class="manual-section">
        <h3>Import packs and media</h3>
        <p>Use <strong>Import pack</strong> on the home screen: choose a file or drag and drop.</p>
        <ul>
          <li><strong>JSON</strong> — a content export for one document version.</li>
          <li><strong>ZIP</strong> — content plus optional figures under a <code>media/</code> folder (air-gap friendly).</li>
          <li><strong>Media-only ZIP</strong> — add or refresh figures for a document you already imported (also available from the reader).</li>
        </ul>
        <p>After import, documents appear in <strong>Library</strong>. Open one to read. Missing figures show as “Image not in pack” until you import a media pack that includes them.</p>
        <p><strong>Samples</strong> (collapsed under Import) includes a small UFC fixture and an image demo pack for trying the app without your own export.</p>
      </section>

      <section id="man-project" class="manual-section">
        <h3>Applicable project</h3>
        <p>Set a project name (for example, a facility or job) on the library or reader screen. It is remembered in this browser only and can be included when you export notes, so handoffs stay labeled for the right job.</p>
      </section>

      <section id="man-reading" class="manual-section">
        <h3>Reading, contents, and search</h3>
        <ul>
          <li><strong>Contents</strong> — jump by chapter and heading; the active section highlights as you scroll.</li>
          <li><strong>Search</strong> — find text inside the open document.</li>
          <li><strong>Document | Requirements table</strong> — switch to a filterable table for review, with CSV export.</li>
          <li><strong>Details</strong> — expand for designation, version, and import provenance.</li>
        </ul>
      </section>

      <section id="man-notes" class="manual-section">
        <h3>Local commentary</h3>
        <p>Notes are yours alone — they never sync to the live Criteria site.</p>
        <ul>
          <li>On a section heading, use <strong>Note</strong> to attach commentary to that section.</li>
          <li>On a sentence, use the marker control to annotate that paragraph fragment.</li>
          <li>The <strong>Local notes</strong> panel lists every note for this document: filter, jump to the tagged text, edit, or delete.</li>
          <li><strong>Export notes</strong> / <strong>Import notes</strong> move commentary between machines (merge or replace).</li>
        </ul>
      </section>

      <section id="man-export" class="manual-section">
        <h3>Export notes and packs</h3>
        <ul>
          <li><strong>Export pack</strong> (reader) — download JSON plus any stored figures for air-gap handoff.</li>
          <li><strong>Export notes JSON</strong> — download local commentary for this version (includes applicable project when set).</li>
          <li><strong>Export CSV</strong> — from Requirements table mode, for spreadsheet review.</li>
        </ul>
      </section>

      <section id="man-live" class="manual-section">
        <h3>Open on live site</h3>
        <p>Use <strong>Open on live site</strong> to view the current published version or submit formal change commentary on digital.wbdg.org. This app does not post changes to the live system.</p>
      </section>

      <section id="man-airgap" class="manual-section">
        <h3>Air-gap tips</h3>
        <ol>
          <li>On a connected machine, obtain content JSON/ZIP (and media if needed) from your usual export path.</li>
          <li>Copy the viewer release (or <code>dist/</code>) and the pack onto removable media.</li>
          <li>On the field machine, open the viewer (double-click the single-file HTML, or serve <code>dist/</code>), then import the pack.</li>
          <li>Export packs and notes back out when you return to connectivity.</li>
        </ol>
        <p>Opened from disk (<code>file://</code>), use <strong>Choose .json or .zip</strong> — browsers block loading bundled sample files automatically.</p>
      </section>

      <details class="manual-tech" id="man-tech">
        <summary>Technical notes</summary>
        <div class="manual-tech-body">
          <p>These details are optional. Day-to-day use does not require them.</p>
          <ul>
            <li><strong>Storage:</strong> Documents, figures, and notes are kept in this browser’s IndexedDB database <code>ufc-offline</code>. Applicable project uses <code>localStorage</code>.</li>
            <li><strong>No live API:</strong> The app does not call <code>api.digital.wbdg.org</code> (CORS is not available for this origin). Content arrives only via import / packs / bundled static assets.</li>
            <li><strong>Images:</strong> Figures hydrate as local <code>blob:</code> URLs from imported media — never hot-linked from the API.</li>
            <li><strong>Cached catalog:</strong> Under Samples, an optional bundled directory JSON may be shown for discovery; it can be stale and does not download content.</li>
            <li><strong>CCR:</strong> Formal change requests stay on the live site (link-out only). See repo <code>docs/CCR-PLAN.md</code>.</li>
            <li><strong>Clearing data:</strong> Clearing site data for this origin (or for <code>file://</code>) removes the library, media, and notes.</li>
            <li><strong>Pack layout:</strong> ZIP may contain <code>content.json</code> (or any <code>.json</code>) plus <code>media/&lt;relativePath&gt;</code> matching each IMAGE asset path.</li>
          </ul>
        </div>
      </details>
    </article>`;
}
