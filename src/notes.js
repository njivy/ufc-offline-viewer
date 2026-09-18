/** Offline-only local commentary attached to document elements (IndexedDB). Does not sync to CIM. */

import { openDb, txDone } from './db.js';

const NOTES = 'notes';
export const NOTES_FORMAT = 'ufc-offline-notes';
export const NOTES_FORMAT_VERSION = 1;

export async function listNotesForVersion(versionId) {
  const db = await openDb();
  const tx = db.transaction(NOTES, 'readonly');
  const idx = tx.objectStore(NOTES).index('versionId');
  const notes = await new Promise((resolve, reject) => {
    const req = idx.getAll(versionId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function listAllNotes() {
  const db = await openDb();
  const tx = db.transaction(NOTES, 'readonly');
  const notes = await new Promise((resolve, reject) => {
    const req = tx.objectStore(NOTES).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function countNotesByTarget(versionId) {
  const notes = await listNotesForVersion(versionId);
  const map = Object.create(null);
  for (const n of notes) {
    const key = `${n.targetType}:${n.targetId}`;
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

export async function saveNote(note) {
  const now = new Date().toISOString();
  const record = {
    id: note.id || crypto.randomUUID(),
    versionId: note.versionId,
    targetType: note.targetType, // 'section' | 'sentence'
    targetId: note.targetId,
    body: String(note.body || '').trim(),
    createdAt: note.createdAt || now,
    updatedAt: now,
  };
  if (!record.versionId || !record.targetId || !record.body) {
    throw new Error('Note requires versionId, targetId, and body');
  }
  if (!record.targetType) {
    throw new Error('Note requires targetType (section | sentence)');
  }
  const db = await openDb();
  const tx = db.transaction(NOTES, 'readwrite');
  tx.objectStore(NOTES).put(record);
  await txDone(tx);
  db.close();
  return record;
}

export async function deleteNote(id) {
  const db = await openDb();
  const tx = db.transaction(NOTES, 'readwrite');
  tx.objectStore(NOTES).delete(id);
  await txDone(tx);
  db.close();
}

export async function deleteNotesForVersion(versionId) {
  const existing = await listNotesForVersion(versionId);
  if (!existing.length) return 0;
  const db = await openDb();
  const tx = db.transaction(NOTES, 'readwrite');
  const store = tx.objectStore(NOTES);
  for (const n of existing) store.delete(n.id);
  await txDone(tx);
  db.close();
  return existing.length;
}

/**
 * Build a portable JSON document for download.
 * @param {object[]} notes
 * @param {{ scope?: string, versionId?: string }} meta
 */
export function buildNotesExport(notes, meta = {}) {
  return {
    format: NOTES_FORMAT,
    formatVersion: NOTES_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    scope: meta.scope || (meta.versionId ? 'version' : 'all'),
    versionId: meta.versionId || null,
    applicableProject: meta.applicableProject || null,
    notes: (notes || []).map((n) => ({
      id: n.id,
      versionId: n.versionId,
      targetType: n.targetType,
      targetId: n.targetId,
      body: n.body,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  };
}

export async function exportNotesJson(versionId = null, extraMeta = {}) {
  const notes = versionId ? await listNotesForVersion(versionId) : await listAllNotes();
  return buildNotesExport(notes, {
    scope: versionId ? 'version' : 'all',
    versionId: versionId || null,
    ...extraMeta,
  });
}

function parseNotesPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Notes file must be a JSON object');
  }
  if (raw.format && raw.format !== NOTES_FORMAT) {
    throw new Error(`Unsupported notes format “${raw.format}” (expected ${NOTES_FORMAT})`);
  }
  const formatVersion = raw.formatVersion ?? raw.version ?? 1;
  if (typeof formatVersion !== 'number' || formatVersion > NOTES_FORMAT_VERSION) {
    throw new Error(`Unsupported notes formatVersion ${formatVersion}`);
  }
  let list = raw.notes;
  if (!list && Array.isArray(raw)) list = raw;
  if (!Array.isArray(list)) {
    throw new Error('Notes file must include a notes[] array');
  }
  return { formatVersion, notes: list, versionId: raw.versionId || null };
}

/**
 * Import notes from a parsed JSON payload.
 * @param {object} raw
 * @param {{ mode: 'merge'|'replace', versionId?: string|null }} options
 *   - merge: upsert by note id; if incoming has no id, match versionId+targetType+targetId or create
 *   - replace: delete existing notes for the target versionId(s), then insert
 */
export async function importNotesPayload(raw, options = {}) {
  const mode = options.mode === 'replace' ? 'replace' : 'merge';
  const { notes: incoming } = parseNotesPayload(raw);
  const forceVersionId = options.versionId || null;

  const normalized = [];
  for (const n of incoming) {
    const versionId = forceVersionId || n.versionId;
    const targetType = n.targetType;
    const targetId = n.targetId;
    const body = String(n.body || '').trim();
    if (!versionId || !targetType || !targetId || !body) continue;
    normalized.push({
      id: n.id || null,
      versionId,
      targetType,
      targetId,
      body,
      createdAt: n.createdAt || null,
      updatedAt: n.updatedAt || null,
    });
  }

  if (!normalized.length) {
    throw new Error('No valid notes found in file (need versionId, targetType, targetId, body)');
  }

  let deleted = 0;
  if (mode === 'replace') {
    const versionIds = forceVersionId
      ? [forceVersionId]
      : [...new Set(normalized.map((n) => n.versionId))];
    for (const vid of versionIds) {
      deleted += await deleteNotesForVersion(vid);
    }
  }

  // For merge: load existing to preserve ids when matching targets without id
  const existingByVersion = new Map();
  if (mode === 'merge') {
    const vids = [...new Set(normalized.map((n) => n.versionId))];
    for (const vid of vids) {
      existingByVersion.set(vid, await listNotesForVersion(vid));
    }
  }

  let saved = 0;
  let updated = 0;
  for (const n of normalized) {
    let id = n.id;
    let createdAt = n.createdAt;
    if (mode === 'merge' && !id) {
      const match = (existingByVersion.get(n.versionId) || []).find(
        (e) => e.targetType === n.targetType && e.targetId === n.targetId
      );
      if (match) {
        id = match.id;
        createdAt = match.createdAt;
        updated += 1;
      }
    } else if (mode === 'merge' && id) {
      const match = (existingByVersion.get(n.versionId) || []).find((e) => e.id === id);
      if (match) updated += 1;
    }
    await saveNote({
      id: id || undefined,
      versionId: n.versionId,
      targetType: n.targetType,
      targetId: n.targetId,
      body: n.body,
      createdAt: createdAt || undefined,
    });
    saved += 1;
  }

  return { mode, saved, updated, deleted, total: normalized.length };
}
