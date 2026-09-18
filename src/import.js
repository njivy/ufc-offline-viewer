import JSZip from 'jszip';
import { saveDoc, normalizeContent } from './db.js';

/**
 * Parse a File (.json or .zip containing .json) and save to IndexedDB.
 * @returns {Promise<object>} saved library record
 */
export async function importFile(file) {
  const name = (file.name || '').toLowerCase();
  let text;
  let sourceLabel = file.name || 'import';

  if (name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const jsonEntry = Object.keys(zip.files).find(
      (p) => p.toLowerCase().endsWith('.json') && !zip.files[p].dir
    );
    if (!jsonEntry) {
      throw new Error('ZIP has no .json file inside');
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
  normalizeContent(raw);
  return saveDoc(raw, sourceLabel);
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
