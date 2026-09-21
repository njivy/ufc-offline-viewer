/**
 * Light HTML sanitize for trusted CIM table HTML.
 * Strips scripts/event handlers; keeps table markup.
 */
export function sanitizeTableHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((el) => el.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' || (n === 'href' && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tpl.innerHTML;
}

export function sectionTitle(node) {
  const parts = [];
  if (node.label) parts.push(node.label);
  if (node.heading) parts.push(node.heading);
  if (!parts.length && node.type) parts.push(node.type);
  return parts.join(' — ') || 'Section';
}

/** Flatten tree for TOC */
export function walkToc(sections, depth = 0, out = []) {
  for (const node of sections || []) {
    const show =
      node.type === 'CHAPTER' ||
      node.type === 'APPENDIX' ||
      node.type === 'HEADING' ||
      (node.heading && node.type !== 'TEXT');
    if (show || (node.label && node.type !== 'TEXT')) {
      out.push({
        id: node.id,
        depth,
        type: node.type,
        title: sectionTitle(node),
      });
    }
    if (node.children?.length) walkToc(node.children, depth + 1, out);
  }
  return out;
}

/**
 * Shared document metadata — compact <details> disclosure (reader header).
 * extras: { importedAt, source, requirementCount, open }
 */
export function renderDocMetaPanel(criterion, content, extras = {}) {
  const c = criterion || {};
  const fields = content?.metadataFields || [];
  const rows = [];

  const push = (label, value, opts = {}) => {
    if (value == null || value === '') return;
    const display = opts.mono
      ? `<code class="mono">${escapeHtml(String(value))}</code>`
      : escapeHtml(String(value));
    rows.push(`<div class="meta-row"><dt>${escapeHtml(label)}</dt><dd>${display}</dd></div>`);
  };

  push('Designation', c.designation);
  push('Title', c.title);
  push('Version', c.versionNumber);
  push('versionId', c.versionId, { mono: true });
  push('Published', formatMetaDate(c.datePublished));
  push('Status', c.criterionStatus);
  if (typeof c.isCurrent === 'boolean') {
    push('Current', c.isCurrent ? 'Yes' : 'No');
  }
  if (extras.importedAt) push('Imported', formatMetaDate(extras.importedAt));
  if (extras.source) push('Source', extras.source);
  if (extras.requirementCount != null) push('Requirement rows', String(extras.requirementCount));

  for (const f of fields) {
    const key = f.key || f.name || f.label || f.fieldName;
    const val = f.value ?? f.fieldValue ?? f.text;
    if (key && val != null && val !== '') push(String(key), String(val));
  }

  if (!rows.length) return '';

  const openAttr = extras.open ? ' open' : '';
  const summaryBits = [
    c.designation,
    c.versionNumber ? `v${c.versionNumber}` : null,
    extras.source || null,
  ].filter(Boolean);
  const summaryLine = summaryBits.length
    ? escapeHtml(summaryBits.join(' · '))
    : 'Document metadata & provenance';

  return `
    <details class="meta-panel" id="meta-details"${openAttr}>
      <summary class="meta-panel-summary">
        <span class="meta-panel-title">Details</span>
        <span class="meta-summary-line">${summaryLine}</span>
      </summary>
      <dl class="meta-grid">${rows.join('')}</dl>
    </details>`;
}

function formatMetaDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

export function renderSentences(sentences, noteCounts = null, sectionId = '') {
  if (!sentences?.length) return '';
  return sentences
    .map((s) => {
      const sid = s.id || '';
      const t = (s.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const count = noteCounts ? noteCounts[`sentence:${sid}`] || 0 : 0;
      const hasNote = count > 0;
      const badge = hasNote ? `<span class="note-badge" title="${count} local note(s)">${count}</span>` : '';
      const afford = sid
        ? `<button type="button" class="note-affordance${hasNote ? ' has-note' : ''}" data-note-target="sentence" data-note-id="${escapeHtml(sid)}" data-section-id="${escapeHtml(sectionId)}" title="${hasNote ? 'View or edit local note' : 'Add local note'}" aria-label="${hasNote ? 'Edit note on sentence' : 'Annotate sentence'}">${badge || '✉'}</button>`
        : '';
      const marked = hasNote ? ' has-local-note' : '';
      return `<span class="sentence${marked}" data-sid="${escapeHtml(sid)}" data-section-id="${escapeHtml(sectionId)}">${t}${afford}</span>`;
    })
    .join(' ');
}

function normalizePathForAttr(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return '';
  let p = urlOrPath.trim();
  const prefixes = [
    'https://api.digital.wbdg.org/v1/storage/files/',
    'http://api.digital.wbdg.org/v1/storage/files/',
    '/v1/storage/files/',
    'v1/storage/files/',
  ];
  for (const pre of prefixes) {
    if (p.toLowerCase().startsWith(pre.toLowerCase())) {
      p = p.slice(pre.length);
      break;
    }
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep */
  }
  return p.replace(/^\/+/, '');
}

function renderMedia(media) {
  if (!media) return '';
  if (media.type === 'TABLE' && media.content) {
    const cap = media.caption
      ? `<figcaption>${escapeHtml(media.caption)}</figcaption>`
      : '';
    return `<figure class="media-table">${cap}<div class="table-wrap">${sanitizeTableHtml(media.content)}</div></figure>`;
  }
  if (media.type === 'IMAGE') {
    const path = normalizePathForAttr(media.url || media.sourcePath || '');
    const cap = media.caption || '';
    const alt = media.altText || media.caption || 'Image';
    const capHtml = cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : '';
    // Placeholder until hydrateDocumentImages swaps in blob: object URL (never hot-link API offline).
    return `<figure class="media-image media-missing" data-media-path="${escapeHtml(path)}" data-media-alt="${escapeHtml(alt)}" data-media-caption="${escapeHtml(cap)}">
      ${capHtml}
      <div class="media-placeholder">
        <p class="media-missing-msg">Image not in pack</p>
        ${path ? `<p class="muted media-path"><code>${escapeHtml(path)}</code></p>` : '<p class="muted">No storage path on mediaAsset</p>'}
      </div>
    </figure>`;
  }
  return '';
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNode(node, noteCounts = null) {
  const title = sectionTitle(node);
  const headingLevel =
    node.type === 'CHAPTER' || node.type === 'APPENDIX'
      ? 2
      : node.type === 'HEADING'
        ? 3
        : 4;
  const showHeading =
    node.type === 'CHAPTER' ||
    node.type === 'APPENDIX' ||
    node.type === 'HEADING' ||
    node.heading ||
    node.label;

  const secCount = noteCounts ? noteCounts[`section:${node.id}`] || 0 : 0;
  const secBadge = secCount > 0 ? ` <span class="note-badge">${secCount}</span>` : '';
  const secHasNote = secCount > 0;

  let html = `<section class="sec type-${(node.type || '').toLowerCase()}${secHasNote ? ' has-local-note' : ''}" id="sec-${node.id}" data-id="${node.id}">`;
  if (showHeading) {
    html += `<div class="sec-heading-row">
      <h${headingLevel} class="sec-heading">${escapeHtml(title)}</h${headingLevel}>
      <button type="button" class="note-btn${secHasNote ? ' has-note' : ''}" data-note-target="section" data-note-id="${escapeHtml(node.id)}" title="${secHasNote ? 'View or edit local note for this section' : 'Add local note for this section'}">${secHasNote ? 'Noted' : 'Note'}${secBadge}</button>
    </div>`;
  }
  if (node.sentences?.length) {
    html += `<div class="sec-body">${renderSentences(node.sentences, noteCounts, node.id)}</div>`;
  } else if (node.content && node.type === 'TEXT') {
    html += `<div class="sec-body">${escapeHtml(node.content)}</div>`;
  }
  html += renderMedia(node.mediaAsset);
  if (node.children?.length) {
    html += node.children.map((child) => renderNode(child, noteCounts)).join('');
  }
  html += '</section>';
  return html;
}

/**
 * @param {Array} sections
 * @param {Record<string, number>|null} noteCounts map of "section:id" | "sentence:id" → count
 */
export function renderDocumentBody(sections, noteCounts = null) {
  return (sections || []).map((n) => renderNode(n, noteCounts)).join('');
}

/**
 * Map note targets to human-readable ownership labels for the notes panel.
 * Keys: "section:<id>" | "sentence:<id>"
 */
export function buildNoteTargetIndex(sections) {
  const map = Object.create(null);

  function walk(nodes, ancestors = []) {
    for (const node of nodes || []) {
      const title = sectionTitle(node);
      const pathParts = [...ancestors];
      if (title) pathParts.push(title);
      const path = pathParts.filter(Boolean).join(' › ');
      map[`section:${node.id}`] = {
        kind: 'section',
        title: title || 'Section',
        path: path || title || 'Section',
        preview: '',
        sectionId: node.id,
      };
      for (const s of node.sentences || []) {
        const text = (s.text || '').trim();
        map[`sentence:${s.id}`] = {
          kind: 'sentence',
          title: pathParts.filter(Boolean).slice(-2).join(' › ') || title || 'Paragraph',
          path: path || title || 'Paragraph',
          preview: text.length > 140 ? `${text.slice(0, 140)}…` : text,
          sectionId: node.id,
        };
      }
      if (node.children?.length) walk(node.children, pathParts);
    }
  }
  walk(sections);
  return map;
}

/**
 * In-document search: returns hits { sectionId, title, snippet, sentenceId }
 */
export function searchDocument(sections, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];

  function walk(nodes, ancestors = []) {
    for (const node of nodes || []) {
      const title = sectionTitle(node);
      const path = [...ancestors, title];
      for (const s of node.sentences || []) {
        const text = s.text || '';
        const idx = text.toLowerCase().indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(text.length, idx + q.length + 60);
          hits.push({
            sectionId: node.id,
            sentenceId: s.id,
            title: path.filter(Boolean).slice(-2).join(' › '),
            snippet:
              (start > 0 ? '…' : '') +
              text.slice(start, end) +
              (end < text.length ? '…' : ''),
          });
        }
      }
      if (node.heading && node.heading.toLowerCase().includes(q)) {
        hits.push({
          sectionId: node.id,
          sentenceId: null,
          title: path.filter(Boolean).slice(-2).join(' › '),
          snippet: node.heading,
        });
      }
      if (node.children?.length) walk(node.children, path);
    }
  }
  walk(sections);
  return hits.slice(0, 100);
}

/**
 * Flatten section tree into requirement-oriented rows for tabular / project review.
 * One row per node that carries requirement text, notes, or table media.
 */

function asPlainText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.text || item.content || item.value || '';
        }
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof value === 'object') {
    return String(value.text || value.content || value.value || '').trim();
  }
  return String(value).trim();
}

export function flattenRequirements(sections, docMeta = {}) {
  const rows = [];

  function nodeText(node) {
    if (node.sentences?.length) {
      return node.sentences.map((s) => s.text || '').filter(Boolean).join(' ').trim();
    }
    if (node.type === 'TEXT' && node.content) return String(node.content).trim();
    return '';
  }

  function walk(nodes, ancestors = []) {
    for (const node of nodes || []) {
      const title = sectionTitle(node);
      const pathParts = [...ancestors];
      if (title && node.type !== 'TEXT') pathParts.push(title);
      else if (title && !ancestors.length) pathParts.push(title);

      const text = nodeText(node);
      const commentary = asPlainText(node.commentary);
      const explanation = asPlainText(node.explanation);
      const hasTable = !!(node.mediaAsset && node.mediaAsset.type === 'TABLE');
      const hasImage = !!(node.mediaAsset && node.mediaAsset.type === 'IMAGE');
      const isReq =
        !!text ||
        !!commentary ||
        !!explanation ||
        hasTable ||
        hasImage ||
        (node.type === 'TEXT' && (node.label || node.heading));

      if (isReq) {
        const crumb = ancestors.filter(Boolean);
        rows.push({
          id: node.id,
          designation: docMeta.designation || '',
          docTitle: docMeta.title || '',
          versionNumber: docMeta.versionNumber || '',
          versionId: docMeta.versionId || '',
          datePublished: docMeta.datePublished || '',
          path: crumb.join(' › '),
          label: node.label || '',
          heading: node.heading || '',
          type: node.type || '',
          status: node.status || '',
          text,
          commentary,
          explanation,
          hasTable,
          hasImage,
          mediaCaption: node.mediaAsset?.caption || '',
        });
      }

      const nextAncestors =
        node.type === 'CHAPTER' ||
        node.type === 'APPENDIX' ||
        node.type === 'HEADING' ||
        (node.heading && node.type !== 'TEXT') ||
        (node.label && node.type !== 'TEXT')
          ? [...ancestors, title]
          : ancestors;
      if (node.children?.length) walk(node.children, nextAncestors);
    }
  }

  walk(sections);
  return rows;
}

/** Build CSV string from requirement rows (for project spreadsheets). */
export function requirementsToCsv(rows) {
  const cols = [
    'designation',
    'docTitle',
    'versionNumber',
    'versionId',
    'datePublished',
    'path',
    'label',
    'heading',
    'type',
    'status',
    'text',
    'commentary',
    'explanation',
    'hasTable',
    'hasImage',
    'mediaCaption',
  ];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => esc(r[c])).join(','));
  }
  return lines.join('\r\n');
}
