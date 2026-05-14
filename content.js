const DEFAULT_CONFIG = {
  enabled: false,
  seconds: 15,
  paramName: "_cb",
  addNoCacheHeaders: true
};

let refreshTimer = null;

function isSupportedPage() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function normalizeParamName(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) return "_cb";

  // Keep param names boring and URL-safe.
  return trimmed.replace(/[^a-zA-Z0-9_.~-]/g, "_");
}

function normalizeSeconds(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return DEFAULT_CONFIG.seconds;

  return Math.max(1, Math.floor(parsed));
}

function getPageKeyFromLocation() {
  const url = new URL(window.location.href);

  // Ignore query/hash so settings survive cache-bust navigations.
  url.search = "";
  url.hash = "";

  return `cacheBustAutoRefresh:v1:${url.origin}${url.pathname}`;
}

async function getConfig() {
  const key = getPageKeyFromLocation();
  const result = await chrome.storage.local.get(key);

  return {
    ...DEFAULT_CONFIG,
    ...(result[key] || {})
  };
}

function getCacheBustedUrl(paramName) {
  const url = new URL(window.location.href);
  const safeParamName = normalizeParamName(paramName);

  url.searchParams.set(safeParamName, Date.now().toString());

  return url.toString();
}

async function sendRuntimeMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn("Runtime message failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function prepareNoCacheHeadersIfRequested(config) {
  if (!config.addNoCacheHeaders) return;

  const response = await sendRuntimeMessage({
    type: "PREPARE_NO_CACHE_HEADERS"
  });

  if (!response || !response.ok) {
    console.warn("Could not prepare no-cache request headers", response);
  }
}

async function updateBadge(config) {
  if (config.enabled) {
    await sendRuntimeMessage({
      type: "SET_BADGE_ENABLED"
    });
  } else {
    await sendRuntimeMessage({
      type: "CLEAR_BADGE"
    });
  }
}

async function refreshNow(config) {
  await prepareNoCacheHeadersIfRequested(config);

  const nextUrl = getCacheBustedUrl(config.paramName);

  // This changes the top-level URL, which avoids reusing the exact same browser
  // cache key for the HTML document. It does not guarantee CDN freshness.
  window.location.replace(nextUrl);
}

async function scheduleRefresh() {
  if (!isSupportedPage()) return;

  clearTimeout(refreshTimer);

  const config = await getConfig();

  await updateBadge(config);

  if (!config.enabled) {
    return;
  }

  const seconds = normalizeSeconds(config.seconds);

  refreshTimer = setTimeout(() => {
    refreshNow(config).catch((error) => {
      console.error("Auto-refresh failed", error);
    });
  }, seconds * 1000);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  const pageKey = getPageKeyFromLocation();

  if (Object.prototype.hasOwnProperty.call(changes, pageKey)) {
    scheduleRefresh();
  }
});

scheduleRefresh();
