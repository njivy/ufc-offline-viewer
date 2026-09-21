/**
 * Workspace switcher UI helpers (create / rename / switch / delete).
 * Storage APIs live in db.js; this module is presentation + wiring only.
 *
 * v0.9.1 UX: one select shows the current name; Rename/New/Delete are actions
 * (no duplicate text field + no redundant “Active: Name” line).
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
        <button type="button" class="secondary" id="btn-rename-workspace" title="Rename this workspace">Rename</button>
        <button type="button" class="secondary" id="btn-new-workspace">New</button>
        <button type="button" class="secondary danger-quiet" id="btn-delete-workspace" title="Delete this workspace and its docs">Delete</button>
      </div>
      <p class="project-current hint">Docs, notes, and figures stay in this workspace.</p>
    </section>`;
}

/**
 * Lightweight in-app prompt (non-blocking vs window.prompt when possible).
 * Falls back to window.prompt if dialog API unavailable mid-render.
 */
function askName(title, initial) {
  const next = window.prompt(title, initial ?? '');
  if (next == null) return null;
  return String(next).trim();
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

  document.getElementById('btn-rename-workspace')?.addEventListener('click', async () => {
    const id = getActiveWorkspaceId();
    const state = getState();
    const current = (state.workspaces || []).find((w) => w.id === id);
    const name = askName('Rename workspace / project:', current?.name || '');
    if (name == null) return;
    if (!name) {
      setStatus('Workspace name cannot be empty', true);
      return;
    }
    try {
      const updated = await renameWorkspace(id, name);
      state.workspaces = await listWorkspaces();
      state.activeWorkspaceId = id;
      state.applicableProject = updated.name;
      setStatus(`Workspace renamed to “${updated.name}”`);
      await onChanged({ renamed: true });
    } catch (err) {
      setStatus(err.message || String(err), true);
      await onChanged({ error: true });
    }
  });

  document.getElementById('btn-new-workspace')?.addEventListener('click', async () => {
    const name = askName('Name for the new workspace / project:', '');
    if (name == null) return;
    if (!name) {
      setStatus('Workspace name cannot be empty', true);
      return;
    }
    try {
      const ws = await createWorkspace(name);
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
