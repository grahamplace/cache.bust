const HEADER_RULE_BASE_ID = 900000;
const BADGE_BG = "#D4FF3F";
const BADGE_FG = "#0B0B0A";

const RESOURCE_TYPES_TO_REVALIDATE = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "xmlhttprequest",
  "media",
  "other"
];

function getHeaderRuleId(tabId) {
  return HEADER_RULE_BASE_ID + Number(tabId);
}

function getPageKeyFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  return `cacheBustAutoRefresh:v1:${url.origin}${url.pathname}`;
}

async function removeNoCacheHeadersForTab(tabId) {
  if (!Number.isInteger(Number(tabId))) return;

  const ruleId = getHeaderRuleId(tabId);

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId]
    });
  } catch (error) {
    console.warn("Failed to remove no-cache header rule", error);
  }
}

async function enableNoCacheHeadersForTab(tabId) {
  if (!Number.isInteger(Number(tabId))) {
    throw new Error("Missing valid tabId");
  }

  const numericTabId = Number(tabId);
  const ruleId = getHeaderRuleId(numericTabId);

  const rule = {
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Cache-Control",
          operation: "set",
          value: "no-cache, no-store, max-age=0"
        },
        {
          header: "Pragma",
          operation: "set",
          value: "no-cache"
        },
        {
          header: "Expires",
          operation: "set",
          value: "0"
        }
      ]
    },
    condition: {
      tabIds: [numericTabId],
      resourceTypes: RESOURCE_TYPES_TO_REVALIDATE
    }
  };

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [rule]
  });
}

async function setBadgeOn(tabId) {
  const numericTabId = Number(tabId);

  await chrome.action.setBadgeBackgroundColor({
    tabId: numericTabId,
    color: BADGE_BG
  });

  try {
    await chrome.action.setBadgeTextColor({
      tabId: numericTabId,
      color: BADGE_FG
    });
  } catch {
    // older Chrome may not support setBadgeTextColor
  }

  await chrome.action.setBadgeText({
    tabId: numericTabId,
    text: "ON"
  });
}

async function clearBadge(tabId) {
  try {
    await chrome.action.setBadgeText({
      tabId: Number(tabId),
      text: ""
    });
  } catch {
    // Tab may already be gone.
  }
}

async function hardReloadTab(tabId, addNoCacheHeaders) {
  if (!Number.isInteger(Number(tabId))) {
    throw new Error("Missing valid tabId");
  }

  const numericTabId = Number(tabId);

  if (addNoCacheHeaders) {
    await enableNoCacheHeadersForTab(numericTabId);
  }

  await chrome.tabs.reload(numericTabId, {
    bypassCache: true
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    if (!message || typeof message.type !== "string") {
      return { ok: false, error: "Invalid message" };
    }

    const tabIdFromSender = sender.tab && sender.tab.id;
    const tabId = message.tabId ?? tabIdFromSender;

    switch (message.type) {
      case "PREPARE_NO_CACHE_HEADERS": {
        await enableNoCacheHeadersForTab(tabId);
        return { ok: true };
      }

      case "DISABLE_NO_CACHE_HEADERS": {
        await removeNoCacheHeadersForTab(tabId);
        return { ok: true };
      }

      case "HARD_RELOAD_TAB": {
        await hardReloadTab(tabId, Boolean(message.addNoCacheHeaders));
        return { ok: true };
      }

      case "SET_BADGE_ENABLED": {
        await setBadgeOn(tabId);
        return { ok: true };
      }

      case "CLEAR_BADGE": {
        await clearBadge(tabId);
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown message type: ${message.type}` };
    }
  };

  run()
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error(error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeNoCacheHeadersForTab(tabId);
});

// If a tab navigates to a different storage-key target (different origin or
// pathname), tear down the DNR rule and badge so we don't keep injecting
// no-cache headers into a site the user didn't opt into.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  let nextKey = null;
  try {
    nextKey = getPageKeyFromUrl(changeInfo.url);
  } catch {
    // non-URL navigations (chrome://, about:, etc.)
    await removeNoCacheHeadersForTab(tabId);
    await clearBadge(tabId);
    return;
  }

  const stored = await chrome.storage.local.get(nextKey);
  const config = stored[nextKey];

  if (!config || !config.enabled) {
    await removeNoCacheHeadersForTab(tabId);
    await clearBadge(tabId);
  }
});
