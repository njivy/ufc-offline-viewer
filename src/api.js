const API_BASE = 'https://api.digital.wbdg.org';
const LIVE_BASE = 'https://digital.wbdg.org';
const CACHED_DIRECTORY_URL = './catalog/preliminary-directory.json';

export function liveVersionUrl(versionId) {
  return `${LIVE_BASE}/versions/${encodeURIComponent(versionId)}`;
}

export function liveRelatedMaterialUrl(wbdgUrl) {
  return wbdgUrl || null;
}

function unwrapData(json) {
  if (json && typeof json === 'object' && 'data' in json) return json.data;
  return json;
}

function normalizeDirectoryItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  return items
    .map((i) => ({
      criterionId: i.criterionId || null,
      designation: i.designation || i.displayTitle?.split(/\s+/).slice(0, 2).join(' ') || '—',
      title: i.title || i.displayTitle || '',
      series: i.series || null,
      subSeries: i.subSeries || null,
      versionId: i.versionId || i.currentVersionId || i.id || null,
      versionNumber: i.versionNumber || null,
      datePublished: i.datePublished || i.updatedAt || null,
      isCurrent: i.isCurrent != null ? !!i.isCurrent : true,
    }))
    .filter((i) => i.versionId)
    .sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
}

function corsFailure(err, url) {
  const msg = err?.message || String(err);
  const corsLikely =
    /Failed to fetch|NetworkError|CORS|cross-origin|Load failed/i.test(msg) || err?.name === 'TypeError';
  return {
    ok: false,
    corsLikely,
    message: corsLikely
      ? `CORS blocked fetch to api.digital.wbdg.org from this origin. The public API only allowlists https://digital.wbdg.org. Use Import (Mode A): download the JSON/ZIP export elsewhere and import it here. See IMPORT.md.`
      : `Request failed: ${msg}`,
    url,
    error: msg,
  };
}

/**
 * Mode B: try fetch content; on CORS/network failure return guidance.
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
    return corsFailure(err, url);
  }
}

/**
 * Prefer GET /v1/snapshots/resolve?asOf=YYYY-MM-DD for a pinned as-of directory.
 */
export async function fetchSnapshotDirectory(asOf) {
  const url = `${API_BASE}/v1/snapshots/resolve?asOf=${encodeURIComponent(asOf)}`;
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
        message: `snapshots/resolve returned HTTP ${res.status}.`,
        url,
        asOf,
      };
    }
    const json = await res.json();
    const items = normalizeDirectoryItems(unwrapData(json));
    return {
      ok: true,
      source: 'live-snapshots',
      asOf,
      items,
      url,
      stale: false,
      label: `Live snapshot directory (asOf ${asOf})`,
    };
  } catch (err) {
    return { ...corsFailure(err, url), asOf };
  }
}

/**
 * Fallback catalog: current published CES list (no asOf pin).
 */
export async function fetchPublishedCatalog() {
  const url = `${API_BASE}/v1/ces/published?limit=500&page=1`;
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
        message: `ces/published returned HTTP ${res.status}.`,
        url,
      };
    }
    const json = await res.json();
    const items = normalizeDirectoryItems(unwrapData(json));
    return {
      ok: true,
      source: 'live-ces',
      asOf: null,
      items,
      url,
      stale: false,
      label: 'Live published catalog (current versions)',
    };
  } catch (err) {
    return corsFailure(err, url);
  }
}

/**
 * Same-origin static catalog shipped with the app (may be stale).
 */
export async function loadCachedDirectory() {
  const url = CACHED_DIRECTORY_URL;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return {
        ok: false,
        message: `Cached directory missing (HTTP ${res.status}).`,
        url,
      };
    }
    const json = await res.json();
    const items = normalizeDirectoryItems(json.items || unwrapData(json));
    return {
      ok: true,
      source: 'cached',
      asOf: json.asOf || null,
      items,
      url,
      stale: true,
      fetchedAt: json.fetchedAt || null,
      label: `Cached public directory — may be stale${json.asOf ? ` (asOf ${json.asOf})` : ''}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Could not load cached directory: ${err?.message || err}`,
      url,
    };
  }
}

/**
 * Try live asOf resolve, then published catalog, then cached JSON.
 */
export async function loadPreliminaryDirectory(asOf) {
  if (asOf) {
    const snap = await fetchSnapshotDirectory(asOf);
    if (snap.ok) return snap;
    const pub = await fetchPublishedCatalog();
    if (pub.ok) {
      return {
        ...pub,
        asOfFallback: true,
        liveError: snap,
        label: `${pub.label} (asOf resolve failed; showing current catalog)`,
      };
    }
    const cached = await loadCachedDirectory();
    if (cached.ok) {
      return {
        ...cached,
        liveError: snap.corsLikely ? snap : pub,
      };
    }
    return {
      ok: false,
      corsLikely: !!(snap.corsLikely || pub.corsLikely),
      message:
        snap.message ||
        pub.message ||
        'Could not load directory. CORS likely blocks api.digital.wbdg.org outside digital.wbdg.org. Mode A import still works.',
      liveError: snap,
    };
  }

  const pub = await fetchPublishedCatalog();
  if (pub.ok) return pub;
  const cached = await loadCachedDirectory();
  if (cached.ok) {
    return { ...cached, liveError: pub };
  }
  return {
    ok: false,
    corsLikely: !!pub.corsLikely,
    message:
      pub.message ||
      'Could not load directory. Use Import (Mode A).',
  };
}

export { API_BASE, LIVE_BASE, CACHED_DIRECTORY_URL };
