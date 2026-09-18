/**
 * Live-site link helpers + same-origin cached catalog.
 * No browser fetches to api.digital.wbdg.org (CORS will not be relaxed).
 */

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

export { LIVE_BASE, CACHED_DIRECTORY_URL };
