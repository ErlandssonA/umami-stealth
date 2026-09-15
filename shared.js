const UMAMI_DISABLED_KEY = "umami.disabled";
const UMAMI_CLOUD_HOST = "cloud.umami.is";
const MAX_ANALYTICS_HOSTS = 40;
const EXPORT_VERSION = 1;

const DEFAULT_DEV_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "*.local",
  "*.localhost",
  "*.test",
  "*.example",
  "*.invalid",
  "*.vercel.app",
  "*.netlify.app",
  "*.pages.dev",
  "*.web.app",
  "*.ngrok.io",
  "*.ngrok-free.app",
  "*.trycloudflare.com",
  "::1",
];

const SYNC_SETTING_KEYS = [
  "enabled",
  "mode",
  "analyticsHosts",
  "trackOnHosts",
  "excludeDevSites",
  "devPatterns",
];

const LOCAL_SETTING_KEYS = ["detectedHosts", "blockedTotal", "syncError"];

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "owner",
  analyticsHosts: [],
  trackOnHosts: {},
  excludeDevSites: true,
  devPatterns: DEFAULT_DEV_PATTERNS,
  detectedHosts: {},
  blockedTotal: 0,
  syncError: "",
};

function uniqueHosts(values) {
  const seen = new Set();
  const hosts = [];
  for (const value of values || []) {
    const host = normalizeHost(value);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
    if (hosts.length >= MAX_ANALYTICS_HOSTS) break;
  }
  return hosts;
}

function sanitizePatterns(values) {
  const seen = new Set();
  const patterns = [];
  for (const value of values || []) {
    const pattern = String(value || "")
      .trim()
      .toLowerCase();
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    patterns.push(pattern);
  }
  return patterns;
}

function mergeSettings(stored) {
  const analyticsHosts = uniqueHosts(
    Array.isArray(stored?.analyticsHosts)
      ? stored.analyticsHosts
      : stored?.analyticsHost
        ? [stored.analyticsHost]
        : [],
  );
  const mode = stored?.mode === "privacy" ? "privacy" : "owner";
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabled: stored?.enabled !== false,
    mode,
    analyticsHosts,
    trackOnHosts: stored?.trackOnHosts || {},
    excludeDevSites: stored?.excludeDevSites !== false,
    devPatterns: stored?.devPatterns?.length ? sanitizePatterns(stored.devPatterns) : [...DEFAULT_DEV_PATTERNS],
    detectedHosts: stored?.detectedHosts || {},
    blockedTotal: Number(stored?.blockedTotal) || 0,
    syncError: stored?.syncError || "",
  };
}

function pickDefined(values, keys) {
  const out = {};
  for (const key of keys) {
    if (values && values[key] !== undefined) out[key] = values[key];
  }
  return out;
}

async function getSettings() {
  const local = await chrome.storage.local.get([...SYNC_SETTING_KEYS, ...LOCAL_SETTING_KEYS, "analyticsHost"]);
  let sync = {};
  try {
    sync = await chrome.storage.sync.get(SYNC_SETTING_KEYS);
  } catch {
    sync = {};
  }
  return mergeSettings({ ...local, ...pickDefined(sync, SYNC_SETTING_KEYS) });
}

async function writeSettings(partial) {
  const syncPartial = pickDefined(partial, SYNC_SETTING_KEYS);
  const localPartial = pickDefined(partial, LOCAL_SETTING_KEYS);

  if (Object.keys(localPartial).length > 0) {
    await chrome.storage.local.set(localPartial);
  }

  if (Object.keys(syncPartial).length === 0) return;

  try {
    await chrome.storage.sync.set(syncPartial);
    await chrome.storage.local.set({ syncError: "" });
  } catch (error) {
    await chrome.storage.local.set({
      ...syncPartial,
      syncError: String(error?.message || error),
    });
  }
}

function shouldExcludeVisits(settings, hostname, options = {}) {
  if (!settings.enabled) return false;
  if (!hostname) return false;
  if (isForcedExcludeHost(settings, hostname)) return true;
  if (settings.trackOnHosts[hostname]) return false;
  if (settings.mode === "privacy") return true;
  return Boolean(options.detected || settings.detectedHosts[hostname]);
}

function isForcedExcludeHost(settings, hostname) {
  if (!settings.excludeDevSites) return false;
  return matchesDevPattern(hostname, settings.devPatterns);
}

function matchesDevPattern(hostname, patterns) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  return (patterns || []).some((pattern) => hostMatchesPattern(host, pattern));
}

function hostMatchesPattern(hostname, pattern) {
  const value = String(pattern || "")
    .trim()
    .toLowerCase();
  if (!value) return false;
  if (value.startsWith("*.")) {
    const suffix = value.slice(1);
    return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
  }
  return hostname === value;
}

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function hostnameFromUrl(url, baseHref) {
  if (!url) return "";
  try {
    return normalizeHost(new URL(url, baseHref || "https://placeholder.invalid").hostname);
  } catch {
    return "";
  }
}

function urlPointsToAnalytics(url, analyticsHost, baseHref) {
  if (!url) return false;
  const host = normalizeHost(analyticsHost);
  if (!host) return false;
  try {
    const parsed = new URL(url, baseHref || "https://placeholder.invalid");
    return parsed.hostname === host || parsed.hostname.endsWith(`.${host}`);
  } catch {
    return String(url).toLowerCase().includes(host);
  }
}

function urlPointsToAnyAnalytics(url, analyticsHosts, baseHref) {
  return (analyticsHosts || []).some((host) => urlPointsToAnalytics(url, host, baseHref));
}

function looksLikeUmamiEndpoint(url, baseHref) {
  try {
    const parsed = new URL(url, baseHref || "https://placeholder.invalid");
    return parsed.pathname === "/api/send" || parsed.pathname === "/api/collect";
  } catch {
    return false;
  }
}

function inspectUmamiScript(script, settings, baseHref) {
  const src = script.getAttribute("src") || "";
  const hostUrl = script.getAttribute("data-host-url") || "";
  const websiteId = (script.getAttribute("data-website-id") || "").trim();
  const derivedHost = hostnameFromUrl(hostUrl, baseHref) || hostnameFromUrl(src, baseHref);
  const hosts = settings.analyticsHosts || [];
  const matchesConfiguredHost = urlPointsToAnyAnalytics(src, hosts, baseHref) || urlPointsToAnyAnalytics(hostUrl, hosts, baseHref);
  const openDetection = settings.mode === "privacy" || hosts.length === 0;

  if (hosts.length > 0 && matchesConfiguredHost) {
    return {
      websiteId,
      scriptSrc: src,
      hostUrl,
      analyticsHost: derivedHost || hosts.find((host) => urlPointsToAnalytics(src, host, baseHref) || urlPointsToAnalytics(hostUrl, host, baseHref)) || "",
    };
  }

  if (!openDetection || !websiteId) return null;

  return {
    websiteId,
    scriptSrc: src,
    hostUrl,
    analyticsHost: derivedHost,
  };
}

function applyUmamiDisabled(exclude) {
  try {
    if (exclude) {
      window.localStorage.setItem(UMAMI_DISABLED_KEY, "1");
    } else {
      window.localStorage.removeItem(UMAMI_DISABLED_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

function isUmamiCurrentlyDisabled() {
  try {
    return Boolean(window.localStorage.getItem(UMAMI_DISABLED_KEY));
  } catch {
    return false;
  }
}

function formatHostSummary(settings) {
  const hosts = settings.analyticsHosts || [];
  if (hosts.length === 0) return "No host configured";
  if (hosts.length === 1) return hosts[0];
  return `${hosts[0]} +${hosts.length - 1}`;
}

function exportPayload(settings) {
  return {
    version: EXPORT_VERSION,
    enabled: settings.enabled,
    mode: settings.mode,
    analyticsHosts: settings.analyticsHosts,
    trackOnHosts: settings.trackOnHosts,
    excludeDevSites: settings.excludeDevSites,
    devPatterns: settings.devPatterns,
  };
}

function parseImportedSettings(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || typeof data !== "object") throw new Error("Invalid settings file");
  return mergeSettings(data);
}
