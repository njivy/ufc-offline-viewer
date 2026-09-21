/** IndexedDB helpers for UFC offline docs. Store: ufc-offline (v4 + workspaces). */

const DB_NAME = 'ufc-offline';
const DB_VERSION = 4;
const STORE = 'docs';
const MEDIA_STORE = 'media';
const NOTES_STORE = 'notes';
const WORKSPACES_STORE = 'workspaces';

export const DEFAULT_WORKSPACE_ID = 'default';
export const ACTIVE_WORKSPACE_KEY = 'ufc-offline-active-workspace';
const LEGACY_PROJECT_KEY = 'ufc-offline-applicable-project';

export function docRecordId(workspaceId, versionId) {
  return `${workspaceId}::${versionId}`;
}

export function getActiveWorkspaceId() {
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_KEY) || DEFAULT_WORKSPACE_ID;
  } catch {
    return DEFAULT_WORKSPACE_ID;
  }
}

export function setActiveWorkspaceId(id) {
  const v = String(id || DEFAULT_WORKSPACE_ID);
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, v);
  } catch {
    /* ignore */
  }
  return v;
}

function readLegacyProjectName() {
  try {
    const v = (localStorage.getItem(LEGACY_PROJECT_KEY) || '').trim();
    return v || 'Default';
  } catch {
    return 'Default';
  }
}

function createDocsStore(db) {
  const os = db.createObjectStore(STORE, { keyPath: 'id' });
  os.createIndex('workspaceId', 'workspaceId', { unique: false });
  os.createIndex('versionId', 'versionId', { unique: false });
  os.createIndex('workspaceVersion', ['workspaceId', 'versionId'], { unique: true });
  os.createIndex('designation', 'designation', { unique: false });
  os.createIndex('importedAt', 'importedAt', { unique: false });
  return os;
}

function createNotesStore(db) {
  const ns = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
  ns.createIndex('versionId', 'versionId', { unique: false });
  ns.createIndex('workspaceId', 'workspaceId', { unique: false });
  ns.createIndex('workspaceVersion', ['workspaceId', 'versionId'], { unique: false });
  ns.createIndex('target', ['versionId', 'targetType', 'targetId'], { unique: false });
  return ns;
}

function createMediaStore(db) {
  const ms = db.createObjectStore(MEDIA_STORE, { keyPath: 'key' });
  ms.createIndex('versionId', 'versionId', { unique: false });
  ms.createIndex('workspaceId', 'workspaceId', { unique: false });
  ms.createIndex('path', 'path', { unique: false });
  ms.createIndex('versionPath', ['versionId', 'path'], { unique: false });
  ms.createIndex('workspaceVersionPath', ['workspaceId', 'versionId', 'path'], {
    unique: true,
  });
  return ms;
}

function createWorkspacesStore(db) {
  return db.createObjectStore(WORKSPACES_STORE, { keyPath: 'id' });
}

function legacyMediaKey(versionId, path) {
  return `${versionId}\0${path}`;
}

export function mediaRecordKey(workspaceId, versionId, path) {
  return `${workspaceId}::${legacyMediaKey(versionId, path)}`;
}

/**
 * Open DB; upgrade to v4 creates workspaces and migrates existing data into Default.
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      const oldVersion = event.oldVersion || 0;
      const now = new Date().toISOString();
      const defaultName = readLegacyProjectName();

      if (oldVersion < 1) {
        /* fresh path handled below via missing-store creates */
      }

      // Fresh install or pre-v3: ensure base stores exist (old schema) before v4 migrate.
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'versionId' });
          os.createIndex('designation', 'designation', { unique: false });
          os.createIndex('importedAt', 'importedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(NOTES_STORE)) {
          const ns = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
          ns.createIndex('versionId', 'versionId', { unique: false });
          ns.createIndex('target', ['versionId', 'targetType', 'targetId'], { unique: false });
        }
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          const ms = db.createObjectStore(MEDIA_STORE, { keyPath: 'key' });
          ms.createIndex('versionId', 'versionId', { unique: false });
          ms.createIndex('path', 'path', { unique: false });
          ms.createIndex('versionPath', ['versionId', 'path'], { unique: true });
        }
      }

      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains(WORKSPACES_STORE)) {
          createWorkspacesStore(db);
        }
        const wsStore = tx.objectStore(WORKSPACES_STORE);
        wsStore.put({
          id: DEFAULT_WORKSPACE_ID,
          name: defaultName,
          createdAt: now,
          updatedAt: now,
        });

        // --- docs: recreate with composite id key ---
        if (db.objectStoreNames.contains(STORE)) {
          const oldDocs = tx.objectStore(STORE);
          const docsReq = oldDocs.getAll();
          docsReq.onsuccess = () => {
            const rows = docsReq.result || [];
            db.deleteObjectStore(STORE);
            const ns = createDocsStore(db);
            for (const r of rows) {
              const wid = r.workspaceId || DEFAULT_WORKSPACE_ID;
              ns.put({
                ...r,
                workspaceId: wid,
                id: docRecordId(wid, r.versionId),
              });
            }
          };
          docsReq.onerror = () => {
            console.error('docs migration failed', docsReq.error);
          };
        } else {
          createDocsStore(db);
        }

        // --- notes: tag workspaceId + add indexes via recreate ---
        if (db.objectStoreNames.contains(NOTES_STORE)) {
          const oldNotes = tx.objectStore(NOTES_STORE);
          const notesReq = oldNotes.getAll();
          notesReq.onsuccess = () => {
            const rows = notesReq.result || [];
            db.deleteObjectStore(NOTES_STORE);
            const ns = createNotesStore(db);
            for (const r of rows) {
              ns.put({
                ...r,
                workspaceId: r.workspaceId || DEFAULT_WORKSPACE_ID,
              });
            }
          };
        } else {
          createNotesStore(db);
        }

        // --- media: namespace keys with workspaceId ---
        if (db.objectStoreNames.contains(MEDIA_STORE)) {
          const oldMedia = tx.objectStore(MEDIA_STORE);
          const mediaReq = oldMedia.getAll();
          mediaReq.onsuccess = () => {
            const rows = mediaReq.result || [];
            db.deleteObjectStore(MEDIA_STORE);
            const ms = createMediaStore(db);
            for (const r of rows) {
              const wid = r.workspaceId || DEFAULT_WORKSPACE_ID;
              const path = r.path || '';
              const versionId = r.versionId || '';
              ms.put({
                ...r,
                workspaceId: wid,
                key: mediaRecordKey(wid, versionId, path),
              });
            }
          };
        } else {
          createMediaStore(db);
        }

        try {
          setActiveWorkspaceId(DEFAULT_WORKSPACE_ID);
          localStorage.removeItem(LEGACY_PROJECT_KEY);
        } catch {
          /* ignore */
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Ensure active workspace key exists for fresh DBs created at v4
      ensureDefaultWorkspace(db)
        .then(() => resolve(db))
        .catch((err) => {
          db.close();
          reject(err);
        });
    };
  });
}

async function ensureDefaultWorkspace(db) {
  if (!db.objectStoreNames.contains(WORKSPACES_STORE)) return;
  const tx = db.transaction(WORKSPACES_STORE, 'readwrite');
  const store = tx.objectStore(WORKSPACES_STORE);
  const existing = await new Promise((resolve, reject) => {
    const req = store.get(DEFAULT_WORKSPACE_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (!existing) {
    const now = new Date().toISOString();
    store.put({
      id: DEFAULT_WORKSPACE_ID,
      name: readLegacyProjectName(),
      createdAt: now,
      updatedAt: now,
    });
  }
  await txDone(tx);
  if (!getActiveWorkspaceId()) setActiveWorkspaceId(DEFAULT_WORKSPACE_ID);
}

export function txDone(tx) {
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

export async function listWorkspaces() {
  const db = await openDb();
  const tx = db.transaction(WORKSPACES_STORE, 'readonly');
  const rows = await new Promise((resolve, reject) => {
    const req = tx.objectStore(WORKSPACES_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getWorkspace(id) {
  const db = await openDb();
  const tx = db.transaction(WORKSPACES_STORE, 'readonly');
  const row = await new Promise((resolve, reject) => {
    const req = tx.objectStore(WORKSPACES_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return row;
}

export async function createWorkspace(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Workspace name is required');
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
  };
  const db = await openDb();
  const tx = db.transaction(WORKSPACES_STORE, 'readwrite');
  tx.objectStore(WORKSPACES_STORE).put(record);
  await txDone(tx);
  db.close();
  return record;
}

export async function renameWorkspace(id, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Workspace name is required');
  const db = await openDb();
  const tx = db.transaction(WORKSPACES_STORE, 'readwrite');
  const store = tx.objectStore(WORKSPACES_STORE);
  const existing = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (!existing) {
    db.close();
    throw new Error('Workspace not found');
  }
  const updated = { ...existing, name: trimmed, updatedAt: new Date().toISOString() };
  store.put(updated);
  await txDone(tx);
  db.close();
  return updated;
}

export async function deleteWorkspace(id) {
  const db = await openDb();
  // Count workspaces first
  const listTx = db.transaction(WORKSPACES_STORE, 'readonly');
  const all = await new Promise((resolve, reject) => {
    const req = listTx.objectStore(WORKSPACES_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(listTx);

  if (all.length <= 1) {
    db.close();
    throw new Error('Cannot delete the last remaining workspace');
  }
  if (!all.some((w) => w.id === id)) {
    db.close();
    throw new Error('Workspace not found');
  }

  const tx = db.transaction(
    [WORKSPACES_STORE, STORE, NOTES_STORE, MEDIA_STORE],
    'readwrite'
  );

  // docs
  const docsStore = tx.objectStore(STORE);
  const docsIdx = docsStore.index('workspaceId');
  const docs = await new Promise((resolve, reject) => {
    const req = docsIdx.getAll(id);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  for (const d of docs) docsStore.delete(d.id);

  // notes
  const notesStore = tx.objectStore(NOTES_STORE);
  const notesIdx = notesStore.index('workspaceId');
  const notes = await new Promise((resolve, reject) => {
    const req = notesIdx.getAll(id);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  for (const n of notes) notesStore.delete(n.id);

  // media
  const mediaStore = tx.objectStore(MEDIA_STORE);
  const mediaIdx = mediaStore.index('workspaceId');
  const media = await new Promise((resolve, reject) => {
    const req = mediaIdx.getAll(id);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  for (const m of media) mediaStore.delete(m.key);

  tx.objectStore(WORKSPACES_STORE).delete(id);
  await txDone(tx);
  db.close();

  const remaining = all.filter((w) => w.id !== id);
  if (getActiveWorkspaceId() === id) {
    setActiveWorkspaceId(remaining[0].id);
  }
  return { deletedId: id, switchedTo: getActiveWorkspaceId(), remaining };
}

export async function saveDoc(content, sourceLabel = 'import', workspaceId = null) {
  const wid = workspaceId || getActiveWorkspaceId();
  const normalized = normalizeContent(content);
  const c = normalized.criterion;
  const record = {
    id: docRecordId(wid, c.versionId),
    workspaceId: wid,
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

export async function listDocs(workspaceId = null) {
  const wid = workspaceId || getActiveWorkspaceId();
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const idx = tx.objectStore(STORE).index('workspaceId');
  const docs = await new Promise((resolve, reject) => {
    const req = idx.getAll(wid);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return docs.sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
}

export async function getDoc(versionId, workspaceId = null) {
  const wid = workspaceId || getActiveWorkspaceId();
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const doc = await new Promise((resolve, reject) => {
    const req = tx.objectStore(STORE).get(docRecordId(wid, versionId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return doc;
}

export async function deleteDoc(versionId, workspaceId = null) {
  const wid = workspaceId || getActiveWorkspaceId();
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(docRecordId(wid, versionId));
  await txDone(tx);
  db.close();
}

export { DB_VERSION, MEDIA_STORE, NOTES_STORE, WORKSPACES_STORE, LEGACY_PROJECT_KEY };
