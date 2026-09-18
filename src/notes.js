/** Offline-only local commentary attached to document elements (IndexedDB). Does not sync to CIM. */

import { openDb, txDone } from './db.js';

const NOTES = 'notes';

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
