/**
 * Offline IMAGE media: walk content tree, IndexedDB blobs, blob:/object URLs.
 * Never hot-link api.digital.wbdg.org when offline.
 */

import { openDb, txDone } from './db.js';
import { API_BASE } from './api.js';
import JSZip from 'jszip';

export const MEDIA_STORE = 'media';

/** Normalize url | sourcePath to a relative storage key (ces/.../images/foo.png). */
export function normalizeMediaPath(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return '';
  let p = urlOrPath.trim();
  if (!p) return '';
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
    /* keep raw */
  }
  return p.replace(/^\/+/, '');
}

/** Encode path segments for GET /v1/storage/files/{path} */
export function encodeStoragePath(path) {
  return normalizeMediaPath(path)
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export function storageFileUrl(path) {
  const enc = encodeStoragePath(path);
  return `${API_BASE}/v1/storage/files/${enc}`;
}

/**
 * Walk section tree; collect mediaAsset type IMAGE with relative path keys.
 * @returns {{ path: string, sectionId: string|null, caption: string, altText: string, mediaId: string|null }[]}
 */
export function collectImageAssets(sections) {
  const out = [];
  const seen = new Set();

  function walk(nodes) {
    for (const node of nodes || []) {
      const m = node.mediaAsset;
      if (m && String(m.type || '').toUpperCase() === 'IMAGE') {
        const path = normalizeMediaPath(m.url || m.sourcePath || '');
        if (path && !seen.has(path)) {
          seen.add(path);
          out.push({
            path,
            sectionId: node.id || null,
            caption: m.caption || '',
            altText: m.altText || m.caption || '',
            mediaId: m.id || null,
          });
        }
      }
      if (node.children?.length) walk(node.children);
    }
  }

  walk(sections);
  return out;
}

function mediaRecordKey(versionId, path) {
  return `${versionId}\0${normalizeMediaPath(path)}`;
}

export async function putMediaBlob(versionId, path, blob, meta = {}) {
  const norm = normalizeMediaPath(path);
  if (!versionId || !norm || !blob) {
    throw new Error('putMediaBlob requires versionId, path, and blob');
  }
  const record = {
    key: mediaRecordKey(versionId, norm),
    versionId,
    path: norm,
    blob,
    contentType: meta.contentType || blob.type || 'application/octet-stream',
    byteLength: blob.size,
    source: meta.source || 'import',
    importedAt: new Date().toISOString(),
  };
  const db = await openDb();
  const tx = db.transaction(MEDIA_STORE, 'readwrite');
  tx.objectStore(MEDIA_STORE).put(record);
  await txDone(tx);
  db.close();
  return record;
}

export async function getMediaRecord(versionId, path) {
  const norm = normalizeMediaPath(path);
  if (!versionId || !norm) return null;
  const db = await openDb();
  const tx = db.transaction(MEDIA_STORE, 'readonly');
  const rec = await new Promise((resolve, reject) => {
    const req = tx.objectStore(MEDIA_STORE).get(mediaRecordKey(versionId, norm));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return rec;
}

export async function listMediaForVersion(versionId) {
  const db = await openDb();
  const tx = db.transaction(MEDIA_STORE, 'readonly');
  const idx = tx.objectStore(MEDIA_STORE).index('versionId');
  const rows = await new Promise((resolve, reject) => {
    const req = idx.getAll(versionId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return rows;
}

export async function deleteMediaForVersion(versionId) {
  const existing = await listMediaForVersion(versionId);
  if (!existing.length) return 0;
  const db = await openDb();
  const tx = db.transaction(MEDIA_STORE, 'readwrite');
  const store = tx.objectStore(MEDIA_STORE);
  for (const r of existing) store.delete(r.key);
  await txDone(tx);
  db.close();
  return existing.length;
}

/**
 * Fetch one image from storage API (CORS may fail outside digital.wbdg.org).
 */
export async function tryFetchStorageFile(path) {
  const url = storageFileUrl(path);
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!res.ok) {
      return {
        ok: false,
        corsLikely: false,
        message: `Storage HTTP ${res.status} for ${path}`,
        url,
        path,
      };
    }
    const blob = await res.blob();
    return {
      ok: true,
      blob,
      contentType: res.headers.get('content-type') || blob.type,
      url,
      path: normalizeMediaPath(path),
    };
  } catch (err) {
    const msg = err?.message || String(err);
    const corsLikely =
      /Failed to fetch|NetworkError|CORS|cross-origin|Load failed/i.test(msg) ||
      err?.name === 'TypeError';
    return {
      ok: false,
      corsLikely,
      message: corsLikely
        ? `CORS blocked image fetch (${path}). Import a media pack (ZIP with media/…) instead.`
        : `Image fetch failed: ${msg}`,
      url,
      path,
      error: msg,
    };
  }
}

/**
 * Download and store all IMAGE assets for a version.
 * @param {string} versionId
 * @param {Array} sections
 * @param {{ onProgress?: (done:number, total:number, path:string) => void, skipExisting?: boolean }} opts
 */
export async function syncImagesForContent(versionId, sections, opts = {}) {
  const assets = collectImageAssets(sections);
  const total = assets.length;
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];
  let corsBlocked = false;

  for (let i = 0; i < assets.length; i++) {
    const { path } = assets[i];
    opts.onProgress?.(i, total, path);
    if (opts.skipExisting) {
      const existing = await getMediaRecord(versionId, path);
      if (existing?.blob) {
        skipped += 1;
        continue;
      }
    }
    const result = await tryFetchStorageFile(path);
    if (result.ok) {
      await putMediaBlob(versionId, path, result.blob, {
        contentType: result.contentType,
        source: 'api-storage',
      });
      saved += 1;
    } else {
      failed += 1;
      if (result.corsLikely) corsBlocked = true;
      errors.push({ path, message: result.message });
    }
  }
  opts.onProgress?.(total, total, '');

  return {
    total,
    saved,
    skipped,
    failed,
    corsBlocked,
    errors,
    assets,
  };
}

/**
 * Map relative ZIP entry paths to storage keys.
 * Accepts media/<path>, <path> matching ces/..., or images/...
 */
export function matchZipEntryToMediaPath(entryName, knownPaths) {
  let name = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name || name.endsWith('/')) return null;
  // strip common roots
  const roots = ['media/', 'images/', 'files/', 'storage/'];
  let stripped = name;
  for (const r of roots) {
    if (stripped.toLowerCase().startsWith(r)) {
      stripped = stripped.slice(r.length);
      break;
    }
  }
  const candidates = [name, stripped, name.replace(/^.*?media\//i, '')];
  const known = knownPaths || null;
  for (const c of candidates) {
    const norm = normalizeMediaPath(c);
    if (!norm) continue;
    if (!known) return norm;
    if (known.has(norm)) return norm;
    // suffix match: zip has foo/bar/baz.png and known has ces/.../baz.png or full path ends with
    for (const k of known) {
      if (k === norm || k.endsWith('/' + norm) || norm.endsWith('/' + k) || k.endsWith(norm)) {
        return k;
      }
    }
  }
  return known ? null : normalizeMediaPath(stripped || name);
}

/**
 * Import image blobs from a ZIP (media pack) into IndexedDB for versionId.
 * If knownPaths provided (from content tree), only matching files are stored.
 */
export async function importMediaFromZip(versionId, arrayBuffer, opts = {}) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const known = opts.knownPaths
    ? new Set([...opts.knownPaths].map(normalizeMediaPath))
    : null;
  let saved = 0;
  const imported = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const lower = name.toLowerCase();
    if (lower.endsWith('.json')) continue;
    const looksMedia =
      /\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(name) ||
      lower.includes('/images/') ||
      lower.startsWith('media/') ||
      lower.includes('/media/');
    if (!looksMedia && !known) continue;

    const path = matchZipEntryToMediaPath(name, known);
    if (!path) continue;
    if (known && !known.has(path)) continue;

    const blob = await entry.async('blob');
    await putMediaBlob(versionId, path, blob, {
      contentType: blob.type || guessMime(path),
      source: opts.sourceLabel || 'media-pack',
    });
    saved += 1;
    imported.push(path);
  }

  return { saved, imported, totalEntries: Object.keys(zip.files).length };
}

function guessMime(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

/** Object URL cache keyed by versionId\0path — revoke on clear. */
const objectUrlCache = new Map();

export function revokeAllObjectUrls() {
  for (const url of objectUrlCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  objectUrlCache.clear();
}

export function revokeObjectUrlsForVersion(versionId) {
  for (const [key, url] of [...objectUrlCache.entries()]) {
    if (key.startsWith(versionId + '\0')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      objectUrlCache.delete(key);
    }
  }
}

/**
 * Resolve blob: URL for an image path, or null if not in pack.
 */
export async function resolveImageObjectUrl(versionId, path) {
  const norm = normalizeMediaPath(path);
  const cacheKey = mediaRecordKey(versionId, norm);
  if (objectUrlCache.has(cacheKey)) return objectUrlCache.get(cacheKey);
  const rec = await getMediaRecord(versionId, norm);
  if (!rec?.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  objectUrlCache.set(cacheKey, url);
  return url;
}

/**
 * After document HTML is in the DOM, fill IMAGE figures from IndexedDB blobs.
 * Missing → keep placeholder with “not in pack”.
 */
export async function hydrateDocumentImages(root, versionId) {
  if (!root || !versionId) return { hydrated: 0, missing: 0 };
  const figures = root.querySelectorAll('figure.media-image[data-media-path]');
  let hydrated = 0;
  let missing = 0;

  for (const fig of figures) {
    const path = fig.getAttribute('data-media-path') || '';
    const alt = fig.getAttribute('data-media-alt') || 'Image';
    const caption = fig.getAttribute('data-media-caption') || '';
    const objUrl = await resolveImageObjectUrl(versionId, path);
    if (objUrl) {
      const capHtml = caption
        ? `<figcaption>${escapeFig(caption)}</figcaption>`
        : '';
      fig.classList.remove('media-missing');
      fig.classList.add('media-loaded');
      fig.innerHTML = `${capHtml}<img src="${objUrl}" alt="${escapeFig(alt)}" loading="lazy" />`;
      hydrated += 1;
    } else {
      fig.classList.add('media-missing');
      fig.classList.remove('media-loaded');
      // placeholder already in HTML from render; ensure message present
      if (!fig.querySelector('.media-missing-msg')) {
        const p = document.createElement('p');
        p.className = 'media-missing-msg muted';
        p.textContent = 'Image not in pack';
        fig.appendChild(p);
      }
      missing += 1;
    }
  }

  return { hydrated, missing };
}

function escapeFig(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build air-gap pack ZIP: content.json + media/<relative paths>.
 */
export async function buildMediaPackZip(doc, opts = {}) {
  const versionId = doc.versionId || doc.content?.criterion?.versionId;
  const content = doc.content;
  const assets = collectImageAssets(content?.sections || []);
  const zip = new JSZip();
  const designation = (doc.designation || content?.criterion?.designation || 'ufc').replace(
    /\s+/g,
    '-'
  );
  const payload = {
    statusCode: 200,
    success: true,
    message: 'ufc-offline-viewer pack',
    data: {
      criterion: content.criterion,
      sections: content.sections,
      metadataFields: content.metadataFields || [],
    },
  };
  zip.file('content.json', JSON.stringify(payload, null, 2));

  let included = 0;
  const missing = [];
  if (opts.includeMedia !== false) {
    const mediaFolder = zip.folder('media');
    for (const a of assets) {
      const rec = await getMediaRecord(versionId, a.path);
      if (rec?.blob) {
        mediaFolder.file(a.path, rec.blob);
        included += 1;
      } else {
        missing.push(a.path);
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    blob,
    filename: `${designation}-pack.zip`,
    imageTotal: assets.length,
    imageIncluded: included,
    imageMissing: missing,
  };
}
