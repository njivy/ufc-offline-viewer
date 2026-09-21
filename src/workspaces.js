/**
 * Workspace switcher UI helpers (create / rename / switch / delete).
 * Storage APIs live in db.js; this module is presentation + wiring only.
 */

import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from './db.js';
import { escapeHtml } from './render.js';

/**
 * Render the Workspace / project bar.
 * @param {{ workspaces: object[], activeWorkspaceId: string, compact?: boolean }} opts
 */
export function renderWorkspaceBar(opts = {}) {
  const compact = !!opts.compact;
  const workspaces = opts.workspaces || [];
  const activeId = opts.activeWorkspaceId || getActiveWorkspaceId();
  const active = workspaces.find((w) => w.id === activeId) || workspaces[0];
  const name = active?.name || 'Default';
  const options = workspaces
    .map(
      (w) =>
        `<option value="${escapeHtml(w.id)}"${w.id === activeId ? ' selected' : ''}>${escapeHtml(w.name)}</option>`
    )
    .join('');

  return `
    <section class="project-bar workspace-bar ${compact ? 'project-bar-compact' : ''}" aria-label="Workspace / project">
      <label class="project-label" for="workspace-select">Workspace / project</label>
      <div class="project-row workspace-row">
        <select id="workspace-select" class="workspace-select" aria-label="Switch workspace">
          ${options || `<option value="${escapeHtml(activeId)}">${escapeHtml(name)}</option>`}
        </select>
        <input
          type="text"
          id="workspace-name"
          class="project-input"
          placeholder="e.g. Hangar renovation — Base X"
          value="${escapeHtml(name)}"
          autocomplete="off"
          spellcheck="true"
          aria-label="Workspace / project name"
        />
        <button type="button" class="secondary" id="btn-rename-workspace" title="Save name for this workspace">Rename</button>
        <button type="button" class="secondary" id="btn-new-workspace">New</button>
        <button type="button" class="secondary danger-quiet" id="btn-delete-workspace" title="Delete this workspace and its docs">Delete</button>
      </div>
      <p class="project-current hint">
        Active: <strong class="project-name">${escapeHtml(name)}</strong>
        · docs, notes, and figures stay in this workspace
      </p>
    </section>`;
}

/**
 * Bind switcher controls.
 * @param {{
 *   getState: () => object,
 *   setStatus: (msg: string, isError?: boolean) => void,
 *   onChanged: () => void | Promise<void>,
 * }} ctx
 */
export function bindWorkspaceBar(ctx) {
  const { getState, setStatus, onChanged } = ctx;

  document.getElementById('workspace-select')?.addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id || id === getActiveWorkspaceId()) return;
    setActiveWorkspaceId(id);
    setStatus(`Switched to workspace “${e.target.selectedOptions?.[0]?.text || id}”`);
    await onChanged({ switched: true });
  });

  const rename = async () => {
    const input = document.getElementById('workspace-name');
    const name = (input?.value || '').trim();
    if (!name) {
      setStatus('Workspace name cannot be empty', true);
      return;
    }
    try {
      const id = getActiveWorkspaceId();
      const updated = await renameWorkspace(id, name);
      const state = getState();
      state.workspaces = await listWorkspaces();
      state.activeWorkspaceId = id;
      state.applicableProject = updated.name;
      setStatus(`Workspace renamed to “${updated.name}”`);
      await onChanged({ renamed: true });
    } catch (err) {
      setStatus(err.message || String(err), true);
      await onChanged({ error: true });
    }
  };

  document.getElementById('btn-rename-workspace')?.addEventListener('click', rename);
  document.getElementById('workspace-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      rename();
    }
  });

  document.getElementById('btn-new-workspace')?.addEventListener('click', async () => {
    const name = window.prompt('Name for the new workspace / project:', '');
    if (name == null) return;
    const trimmed = String(name).trim();
    if (!trimmed) {
      setStatus('Workspace name cannot be empty', true);
      return;
    }
    try {
      const ws = await createWorkspace(trimmed);
      setActiveWorkspaceId(ws.id);
      const state = getState();
      state.workspaces = await listWorkspaces();
      state.activeWorkspaceId = ws.id;
      state.applicableProject = ws.name;
      setStatus(`Created workspace “${ws.name}”`);
      await onChanged({ created: true, switched: true });
    } catch (err) {
      setStatus(err.message || String(err), true);
      await onChanged({ error: true });
    }
  });

  document.getElementById('btn-delete-workspace')?.addEventListener('click', async () => {
    const state = getState();
    const id = getActiveWorkspaceId();
    const current = (state.workspaces || []).find((w) => w.id === id);
    const label = current?.name || id;
    if ((state.workspaces || []).length <= 1) {
      setStatus('Cannot delete the last remaining workspace', true);
      await onChanged({ error: true });
      return;
    }
    const ok = confirm(
      `Delete workspace “${label}” and ALL of its documents, notes, and figures?\n\nThis cannot be undone.`
    );
    if (!ok) return;
    try {
      const result = await deleteWorkspace(id);
      state.workspaces = await listWorkspaces();
      state.activeWorkspaceId = result.switchedTo;
      const next = state.workspaces.find((w) => w.id === result.switchedTo);
      state.applicableProject = next?.name || '';
      setStatus(`Deleted “${label}” · now in “${next?.name || result.switchedTo}”`);
      await onChanged({ deleted: true, switched: true });
    } catch (err) {
      setStatus(err.message || String(err), true);
      await onChanged({ error: true });
    }
  });
}

export async function loadWorkspaceState(state) {
  state.workspaces = await listWorkspaces();
  let activeId = getActiveWorkspaceId();
  if (!state.workspaces.some((w) => w.id === activeId)) {
    activeId = state.workspaces[0]?.id || 'default';
    setActiveWorkspaceId(activeId);
  }
  state.activeWorkspaceId = activeId;
  const active = state.workspaces.find((w) => w.id === activeId);
  state.applicableProject = active?.name || 'Default';
  return state;
}

export { listWorkspaces, getWorkspace, getActiveWorkspaceId, setActiveWorkspaceId };
