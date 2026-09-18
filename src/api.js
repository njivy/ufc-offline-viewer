const API_BASE = 'https://api.digital.wbdg.org';
const LIVE_BASE = 'https://digital.wbdg.org';

export function liveVersionUrl(versionId) {
  return `${LIVE_BASE}/versions/${versionId}`;
}

/**
 * Mode B stub: try fetch content; on CORS/network failure return guidance.
 * Never uses a proxy.
 */
export async function trySyncFromApi(versionId) {
  const url = `${API_BASE}/v1/versions/${encodeURIComponent(versionId)}/content`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      mode: 'cors',
    });
    if (!res.ok) {
      return {
        ok: false,
        corsLikely: false,
        message: `API returned HTTP ${res.status}. Use Import instead (Mode A).`,
        url,
      };
    }
    const json = await res.json();
    return { ok: true, data: json, url };
  } catch (err) {
    const msg = err?.message || String(err);
    const corsLikely =
      /Failed to fetch|NetworkError|CORS|cross-origin|Load failed/i.test(msg) ||
      err?.name === 'TypeError';
    return {
      ok: false,
      corsLikely,
      message: corsLikely
        ? `CORS blocked fetch to api.digital.wbdg.org from this origin. The public API only allowlists https://digital.wbdg.org. Use Import (Mode A): download the JSON/ZIP export elsewhere and import it here. See IMPORT.md.`
        : `Sync failed: ${msg}. Use Import (Mode A) instead.`,
      url,
      error: msg,
    };
  }
}

export { API_BASE, LIVE_BASE };
