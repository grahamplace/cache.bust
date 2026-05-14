const DEFAULT_CONFIG = {
  enabled: false,
  seconds: 15,
  paramName: "_cb",
  addNoCacheHeaders: true
};

let currentTab = null;
let currentStorageKey = null;

function isSupportedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getPageKeyFromUrl(rawUrl) {
  const url = new URL(rawUrl);

  // Ignore query/hash so settings survive cache-bust navigations.
  url.search = "";
  url.hash = "";

  return `cacheBustAutoRefresh:v1:${url.origin}${url.pathname}`;
}

function getDisplayUrl(rawUrl) {
  const url = new URL(rawUrl);

  url.search = "";
  url.hash = "";

  return url.toString();
}

function normalizeParamName(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) return "_cb";

  return trimmed.replace(/[^a-zA-Z0-9_.~-]/g, "_");
}

function normalizeSeconds(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return DEFAULT_CONFIG.seconds;

  return Math.max(1, Math.floor(parsed));
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

function setStatus(message, kind) {
  const status = document.getElementById("status");

  status.textContent = message || "";
  status.className = "status-line";

  if (kind) {
    status.classList.add(kind);
  }
}

function setActiveIndicator(enabled) {
  const dot = document.getElementById("statusDot");
  const mode = document.getElementById("modeLabel");

  dot.classList.toggle("active", Boolean(enabled));
  mode.classList.toggle("active", Boolean(enabled));
  mode.textContent = enabled ? "ACTIVE" : "IDLE";
}

async function sendRuntimeMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function readConfigFromForm() {
  return {
    enabled: document.getElementById("enabled").checked,
    seconds: normalizeSeconds(document.getElementById("seconds").value),
    paramName: normalizeParamName(document.getElementById("paramName").value),
    addNoCacheHeaders: document.getElementById("addNoCacheHeaders").checked
  };
}

function writeConfigToForm(config) {
  document.getElementById("enabled").checked = Boolean(config.enabled);
  document.getElementById("seconds").value = normalizeSeconds(config.seconds);
  document.getElementById("paramName").value = normalizeParamName(config.paramName);
  document.getElementById("addNoCacheHeaders").checked = Boolean(config.addNoCacheHeaders);
}

async function loadConfig() {
  currentTab = await getCurrentTab();

  if (!currentTab || !currentTab.url || !isSupportedUrl(currentTab.url)) {
    const urlEl = document.getElementById("url");
    urlEl.textContent = "only http:// and https:// pages are supported";
    urlEl.classList.add("unsupported");

    document.getElementById("save").disabled = true;
    document.getElementById("turnOff").disabled = true;
    document.getElementById("hardReload").disabled = true;
    document.getElementById("enabled").disabled = true;
    document.getElementById("seconds").disabled = true;
    document.getElementById("paramName").disabled = true;
    document.getElementById("addNoCacheHeaders").disabled = true;

    return;
  }

  currentStorageKey = getPageKeyFromUrl(currentTab.url);

  document.getElementById("url").textContent = getDisplayUrl(currentTab.url);

  const result = await chrome.storage.local.get(currentStorageKey);
  const config = {
    ...DEFAULT_CONFIG,
    ...(result[currentStorageKey] || {})
  };

  writeConfigToForm(config);
  setActiveIndicator(config.enabled);
}

async function saveConfig() {
  if (!currentTab || !currentStorageKey) return;

  const config = readConfigFromForm();

  await chrome.storage.local.set({
    [currentStorageKey]: config
  });

  if (config.enabled && config.addNoCacheHeaders) {
    await sendRuntimeMessage({
      type: "PREPARE_NO_CACHE_HEADERS",
      tabId: currentTab.id
    });
  }

  if (!config.enabled || !config.addNoCacheHeaders) {
    await sendRuntimeMessage({
      type: "DISABLE_NO_CACHE_HEADERS",
      tabId: currentTab.id
    });
  }

  if (config.enabled) {
    await sendRuntimeMessage({
      type: "SET_BADGE_ENABLED",
      tabId: currentTab.id
    });
  } else {
    await sendRuntimeMessage({
      type: "CLEAR_BADGE",
      tabId: currentTab.id
    });
  }

  setActiveIndicator(config.enabled);
  setStatus(config.enabled ? "engaged" : "saved", "success");

  setTimeout(() => {
    window.close();
  }, 450);
}

async function turnOff() {
  if (!currentTab || !currentStorageKey) return;

  const config = {
    ...readConfigFromForm(),
    enabled: false
  };

  await chrome.storage.local.set({
    [currentStorageKey]: config
  });

  writeConfigToForm(config);

  await sendRuntimeMessage({
    type: "DISABLE_NO_CACHE_HEADERS",
    tabId: currentTab.id
  });

  await sendRuntimeMessage({
    type: "CLEAR_BADGE",
    tabId: currentTab.id
  });

  setActiveIndicator(false);
  setStatus("disengaged", "success");
}

async function hardReloadNow() {
  if (!currentTab) return;

  const config = readConfigFromForm();

  const response = await sendRuntimeMessage({
    type: "HARD_RELOAD_TAB",
    tabId: currentTab.id,
    addNoCacheHeaders: config.addNoCacheHeaders
  });

  if (!response || !response.ok) {
    setStatus(response?.error || "Hard reload failed.", "error");
    return;
  }

  setStatus("hard reload dispatched", "success");
}

document.addEventListener("DOMContentLoaded", () => {
  loadConfig().catch((error) => {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), "error");
  });

  document.getElementById("save").addEventListener("click", () => {
    saveConfig().catch((error) => {
      console.error(error);
      setStatus(error instanceof Error ? error.message : String(error), "error");
    });
  });

  document.getElementById("turnOff").addEventListener("click", () => {
    turnOff().catch((error) => {
      console.error(error);
      setStatus(error instanceof Error ? error.message : String(error), "error");
    });
  });

  document.getElementById("hardReload").addEventListener("click", () => {
    hardReloadNow().catch((error) => {
      console.error(error);
      setStatus(error instanceof Error ? error.message : String(error), "error");
    });
  });
});
