/** IndexedDB helpers for UFC offline docs. Store: ufc-offline / docs keyed by versionId */

const DB_NAME = 'ufc-offline';
const DB_VERSION = 1;
const STORE = 'docs';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'versionId' });
        os.createIndex('designation', 'designation', { unique: false });
        os.createIndex('importedAt', 'importedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

/**
 * Normalize API wrapper or unwrapped data into { criterion, sections, metadataFields }
 */
export function normalizeContent(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON: expected an object');
  }
  let data = raw;
  if (raw.data && (raw.data.criterion || raw.data.sections)) {
    data = raw.data;
  }
  if (!data.criterion || !Array.isArray(data.sections)) {
    throw new Error('JSON must include criterion and sections[] (API wrapper or unwrapped data)');
  }
  const c = data.criterion;
  if (!c.versionId) {
    throw new Error('criterion.versionId is required');
  }
  return {
    criterion: c,
    sections: data.sections,
    metadataFields: data.metadataFields || [],
  };
}

export async function saveDoc(content, sourceLabel = 'import') {
  const normalized = normalizeContent(content);
  const c = normalized.criterion;
  const record = {
    versionId: c.versionId,
    designation: c.designation || 'Unknown',
    title: c.title || '',
    versionNumber: c.versionNumber || '',
    datePublished: c.datePublished || null,
    criterionId: c.criterionId || null,
    importedAt: new Date().toISOString(),
    source: sourceLabel,
    content: normalized,
  };
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(record);
  await txDone(tx);
  db.close();
  return record;
}

export async function listDocs() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const docs = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return docs.sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
}

export async function getDoc(versionId) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const doc = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).get(versionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return doc;
}

export async function deleteDoc(versionId) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(versionId);
  await txDone(tx);
  db.close();
}
