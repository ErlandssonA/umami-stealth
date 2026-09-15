importScripts("shared.js");

const blockedByTab = new Map();
let persistBlockedTimer = 0;
let pendingBlocked = 0;

const BADGE = {
  exclude: {
    color: "#3ecf8e",
    title: "Umami Stealth: your visits and events are not being sent",
  },
  track: {
    text: "ON",
    color: "#e8b84a",
    title: "Umami Stealth: this site can record your events",
  },
  idle: {
    text: "",
    color: "#6b7280",
    title: "Umami Stealth",
  },
};

chrome.runtime.onInstalled.addListener(async () => {
  await migrateSettings();
  await updateNetworkRules();
  await refreshActiveBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateNetworkRules();
  await refreshActiveBadge();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync" && area !== "local") return;
  if (
    changes.enabled ||
    changes.mode ||
    changes.analyticsHosts ||
    changes.analyticsHost ||
    changes.trackOnHosts ||
    changes.excludeDevSites ||
    changes.devPatterns
  ) {
    await updateNetworkRules();
  }
  await refreshActiveBadge();
});

chrome.tabs.onActivated.addListener(() => {
  refreshActiveBadge();
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete" || info.url) {
    refreshBadgeForTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  blockedByTab.delete(tabId);
});

if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info?.request?.tabId;
    if (tabId >= 0) {
      blockedByTab.set(tabId, (blockedByTab.get(tabId) || 0) + 1);
      refreshBadgeForTab(tabId);
    }
    bumpBlockedTotal();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function migrateSettings() {
  const settings = await getSettings();
  await writeSettings({
    enabled: settings.enabled,
    mode: settings.mode,
    analyticsHosts: settings.analyticsHosts,
    trackOnHosts: settings.trackOnHosts,
    excludeDevSites: settings.excludeDevSites,
    devPatterns: settings.devPatterns,
  });
  await chrome.storage.local.remove("analyticsHost");
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings(), stats: await getStats() };
    case "GET_STATS":
      return { ok: true, stats: await getStats() };
    case "SET_ENABLED":
      await writeSettings({ enabled: Boolean(message.enabled) });
      return { ok: true, settings: await getSettings() };
    case "SET_MODE": {
      const mode = message.mode === "privacy" ? "privacy" : "owner";
      await writeSettings({ mode });
      return { ok: true, settings: await getSettings() };
    }
    case "ADD_ANALYTICS_HOST": {
      const settings = await getSettings();
      const host = normalizeHost(message.host);
      if (!host) return { ok: false, error: "Enter an analytics host" };
      const analyticsHosts = uniqueHosts([...settings.analyticsHosts, host]);
      await writeSettings({ analyticsHosts });
      return { ok: true, settings: await getSettings() };
    }
    case "REMOVE_ANALYTICS_HOST": {
      const host = normalizeHost(message.host);
      const settings = await getSettings();
      await writeSettings({
        analyticsHosts: settings.analyticsHosts.filter((item) => item !== host),
      });
      return { ok: true, settings: await getSettings() };
    }
    case "ADD_CLOUD_HOST": {
      const settings = await getSettings();
      await writeSettings({
        analyticsHosts: uniqueHosts([...settings.analyticsHosts, UMAMI_CLOUD_HOST]),
      });
      return { ok: true, settings: await getSettings() };
    }
    case "SET_DEV_PATTERNS": {
      await writeSettings({
        excludeDevSites: message.excludeDevSites !== false,
        devPatterns: sanitizePatterns(message.devPatterns),
      });
      return { ok: true, settings: await getSettings() };
    }
    case "SET_TRACK_HOST": {
      const hostname = normalizeHost(message.hostname);
      if (!hostname) return { ok: false, error: "Missing hostname" };
      const settings = await getSettings();
      const trackOnHosts = { ...settings.trackOnHosts };
      if (message.track) {
        trackOnHosts[hostname] = true;
      } else {
        delete trackOnHosts[hostname];
      }
      await writeSettings({ trackOnHosts });
      return { ok: true, settings: await getSettings() };
    }
    case "REPORT_DETECTION": {
      const hostname = message.hostname
        ? normalizeHost(message.hostname)
        : hostnameFromUrl(sender.tab?.url);
      if (!hostname) return { ok: false, error: "Missing hostname" };
      const settings = await getSettings();
      const previous = settings.detectedHosts[hostname] || {};
      const detectedHosts = {
        ...settings.detectedHosts,
        [hostname]: {
          websiteId: message.websiteId || previous.websiteId || "",
          scriptSrc: message.scriptSrc || previous.scriptSrc || "",
          hostUrl: message.hostUrl || previous.hostUrl || "",
          analyticsHost: normalizeHost(message.analyticsHost) || previous.analyticsHost || "",
          lastSeen: Date.now(),
        },
      };
      const next = { detectedHosts };
      const detectedAnalyticsHost = normalizeHost(message.analyticsHost);
      if (detectedAnalyticsHost && !settings.analyticsHosts.includes(detectedAnalyticsHost)) {
        if (settings.mode === "privacy" || settings.analyticsHosts.length === 0) {
          next.analyticsHosts = uniqueHosts([...settings.analyticsHosts, detectedAnalyticsHost]);
        }
      }
      await writeSettings(next);
      if (sender.tab?.id != null) {
        await refreshBadgeForTab(sender.tab.id);
      }
      return { ok: true };
    }
    case "CLEAR_HOST": {
      const hostname = normalizeHost(message.hostname);
      const settings = await getSettings();
      const detectedHosts = { ...settings.detectedHosts };
      const trackOnHosts = { ...settings.trackOnHosts };
      delete detectedHosts[hostname];
      delete trackOnHosts[hostname];
      await writeSettings({ detectedHosts, trackOnHosts });
      return { ok: true, settings: await getSettings() };
    }
    case "RESET_BLOCKED":
      blockedByTab.clear();
      pendingBlocked = 0;
      await writeSettings({ blockedTotal: 0 });
      await refreshActiveBadge();
      return { ok: true, settings: await getSettings(), stats: await getStats() };
    case "EXPORT_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, payload: exportPayload(settings) };
    }
    case "IMPORT_SETTINGS": {
      const imported = parseImportedSettings(message.payload);
      await writeSettings({
        enabled: imported.enabled,
        mode: imported.mode,
        analyticsHosts: imported.analyticsHosts,
        trackOnHosts: imported.trackOnHosts,
        excludeDevSites: imported.excludeDevSites,
        devPatterns: imported.devPatterns,
      });
      return { ok: true, settings: await getSettings() };
    }
    default:
      return { ok: false, error: "Unknown message" };
  }
}

async function getStats() {
  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    blockedTotal: settings.blockedTotal,
    blockedOnTab: tab?.id != null ? blockedByTab.get(tab.id) || 0 : 0,
    extensionId: chrome.runtime.id,
    syncError: settings.syncError,
  };
}

function bumpBlockedTotal() {
  pendingBlocked += 1;
  clearTimeout(persistBlockedTimer);
  persistBlockedTimer = setTimeout(async () => {
    const add = pendingBlocked;
    pendingBlocked = 0;
    if (!add) return;
    const settings = await getSettings();
    await writeSettings({ blockedTotal: settings.blockedTotal + add });
  }, 250);
}

async function updateNetworkRules() {
  const settings = await getSettings();
  const excludedInitiatorDomains = Object.entries(settings.trackOnHosts)
    .filter(([hostname, allowed]) => allowed && !isForcedExcludeHost(settings, hostname))
    .map(([hostname]) => hostname);

  const addRules = [];
  if (settings.enabled) {
    let id = 1;
    for (const host of settings.analyticsHosts) {
      addRules.push(makeBlockRule(id++, host, "/api/send", excludedInitiatorDomains));
      addRules.push(makeBlockRule(id++, host, "/api/collect", excludedInitiatorDomains));
    }
  }

  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules,
    });
  } catch (error) {
    console.error("Umami Stealth: failed to update network rules", error);
  }
}

function makeBlockRule(id, host, path, excludedInitiatorDomains) {
  const condition = {
    urlFilter: `||${host}${path}`,
    resourceTypes: ["xmlhttprequest", "ping", "other"],
  };
  if (excludedInitiatorDomains.length > 0) {
    condition.excludedInitiatorDomains = excludedInitiatorDomains;
  }
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition,
  };
}

async function refreshActiveBadge() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) {
    await refreshBadgeForTab(tab.id);
  }
}

async function refreshBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const hostname = hostnameFromUrl(tab.url);
    const settings = await getSettings();
    const detected = Boolean(hostname && settings.detectedHosts[hostname]);
    const exclude = shouldExcludeVisits(settings, hostname, { detected });

    if (!settings.enabled || (!detected && !isForcedExcludeHost(settings, hostname))) {
      await applyBadge(tabId, BADGE.idle);
      return;
    }

    if (!exclude) {
      await applyBadge(tabId, BADGE.track);
      return;
    }

    const blocked = blockedByTab.get(tabId) || 0;
    await applyBadge(tabId, {
      ...BADGE.exclude,
      text: blocked > 0 ? formatBlockedBadge(blocked) : "OFF",
      title:
        blocked > 0
          ? `Umami Stealth: blocked ${blocked} request${blocked === 1 ? "" : "s"} on this page`
          : BADGE.exclude.title,
    });
  } catch {
    // Tab may already be closed.
  }
}

function formatBlockedBadge(count) {
  if (count > 99) return "99+";
  return String(count);
}

async function applyBadge(tabId, badge) {
  await chrome.action.setBadgeText({ tabId, text: badge.text });
  await chrome.action.setTitle({ tabId, title: badge.title });
  if (badge.text) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ tabId, color: "#0b1f1a" });
    }
  }
}
