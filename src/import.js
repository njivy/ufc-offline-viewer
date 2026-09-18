import JSZip from 'jszip';
import { saveDoc, normalizeContent } from './db.js';
import {
  collectImageAssets,
  importMediaFromZip,
  normalizeMediaPath,
  putMediaBlob,
} from './media.js';

/**
 * Parse a File (.json or .zip containing .json) and save to IndexedDB.
 * ZIP may also include media/ (or relative image paths) for offline IMAGE blobs.
 * @param {File} file
 * @param {{ onProgress?: (msg: string) => void, includeMedia?: boolean }} opts
 * @returns {Promise<object>} saved library record (+ mediaStats if any)
 */
export async function importFile(file, opts = {}) {
  const name = (file.name || '').toLowerCase();
  let text;
  let sourceLabel = file.name || 'import';
  let zipBuffer = null;
  const includeMedia = opts.includeMedia !== false;

  if (name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    zipBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(zipBuffer);
    const jsonEntry = Object.keys(zip.files).find(
      (p) => p.toLowerCase().endsWith('.json') && !zip.files[p].dir
    );
    if (!jsonEntry) {
      // Media-only pack: no JSON — caller must pass versionId via opts.versionId
      if (opts.versionId) {
        opts.onProgress?.('Importing media pack (no content JSON)…');
        const assets = opts.knownPaths || null;
        const result = await importMediaFromZip(opts.versionId, zipBuffer, {
          knownPaths: assets,
          sourceLabel: file.name,
        });
        return {
          versionId: opts.versionId,
          designation: opts.designation || 'Media pack',
          title: '',
          mediaOnly: true,
          mediaStats: result,
          source: file.name,
        };
      }
      throw new Error(
        'ZIP has no .json file inside. To import images only, open a document first then use “Import media pack”, or include content.json + media/ in the zip.'
      );
    }
    text = await zip.files[jsonEntry].async('string');
    sourceLabel = `${file.name} → ${jsonEntry}`;
  } else {
    text = await file.text();
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('File is not valid JSON: ' + (e.message || e));
  }

  // Validate early for clearer errors
  const normalized = normalizeContent(raw);
  opts.onProgress?.(`Saving ${normalized.criterion.designation || 'document'}…`);
  const rec = await saveDoc(raw, sourceLabel);

  let mediaStats = null;
  if (includeMedia && zipBuffer) {
    const known = collectImageAssets(normalized.sections).map((a) => a.path);
    if (known.length) {
      opts.onProgress?.(`Importing images 0/${known.length}…`);
      mediaStats = await importMediaFromZip(rec.versionId, zipBuffer, {
        knownPaths: known,
        sourceLabel: `${file.name} media`,
      });
      // Also try loose files under media/ even if path matching was partial
      if (mediaStats.saved < known.length) {
        opts.onProgress?.(
          `Images in pack: ${mediaStats.saved}/${known.length}` +
            (mediaStats.saved < known.length ? ' (missing stay as “not in pack”)' : '')
        );
      } else {
        opts.onProgress?.(`Imported ${mediaStats.saved} image(s) from pack`);
      }
    }
  }

  rec.mediaStats = mediaStats;
  return rec;
}

/**
 * Fetch JSON from a same-origin URL (e.g. fixture) and import.
 */
export async function importFromUrl(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const raw = await res.json();
  normalizeContent(raw);
  return saveDoc(raw, label || url);
}

/**
 * Import a media-only ZIP (or folder-style zip) against an existing versionId.
 */
export async function importMediaPackFile(versionId, file, sections = null) {
  const buf = await file.arrayBuffer();
  const known = sections ? collectImageAssets(sections).map((a) => a.path) : null;
  return importMediaFromZip(versionId, buf, {
    knownPaths: known,
    sourceLabel: file.name || 'media-pack',
  });
}

export { normalizeMediaPath, putMediaBlob };
