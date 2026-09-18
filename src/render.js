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

function renderSentences(sentences) {
  if (!sentences?.length) return '';
  return sentences
    .map((s) => {
      const t = (s.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span class="sentence" data-sid="${s.id || ''}">${t}</span>`;
    })
    .join(' ');
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
    const cap = media.caption || media.altText || 'Image';
    return `<figure class="media-image"><p class="muted">Image (offline): ${escapeHtml(cap)}${
      media.url || media.sourcePath
        ? ` — path <code>${escapeHtml(media.url || media.sourcePath)}</code>`
        : ''
    }</p></figure>`;
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

function renderNode(node) {
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

  let html = `<section class="sec type-${(node.type || '').toLowerCase()}" id="sec-${node.id}" data-id="${node.id}">`;
  if (showHeading) {
    html += `<h${headingLevel} class="sec-heading">${escapeHtml(title)}</h${headingLevel}>`;
  }
  if (node.sentences?.length) {
    html += `<div class="sec-body">${renderSentences(node.sentences)}</div>`;
  } else if (node.content && node.type === 'TEXT') {
    html += `<div class="sec-body">${escapeHtml(node.content)}</div>`;
  }
  html += renderMedia(node.mediaAsset);
  if (node.children?.length) {
    html += node.children.map(renderNode).join('');
  }
  html += '</section>';
  return html;
}

export function renderDocumentBody(sections) {
  return (sections || []).map(renderNode).join('');
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
