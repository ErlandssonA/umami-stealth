const enabledToggle = document.getElementById("enabled-toggle");
const trackToggle = document.getElementById("track-toggle");
const trackRow = document.getElementById("track-row");
const trackCopy = document.getElementById("track-copy");
const statusPill = document.getElementById("status-pill");
const siteHostname = document.getElementById("site-hostname");
const trackerMeta = document.getElementById("tracker-meta");
const websiteId = document.getElementById("website-id");
const scriptSrc = document.getElementById("script-src");
const pageHint = document.getElementById("page-hint");
const reloadBtn = document.getElementById("reload-btn");
const siteList = document.getElementById("site-list");
const siteCount = document.getElementById("site-count");
const emptySites = document.getElementById("empty-sites");
const analyticsHostLabel = document.getElementById("analytics-host-label");
const blockedCount = document.getElementById("blocked-count");
const blockedCopy = document.getElementById("blocked-copy");
const settingsBtn = document.getElementById("settings-btn");
const app = document.querySelector(".app");

let settings = mergeSettings({});
let stats = { blockedTotal: 0, blockedOnTab: 0 };
let activeTab = null;
let pageStatus = null;
let needsReload = false;

init().catch((error) => {
  pageHint.textContent = `Could not load the extension UI: ${error.message}`;
});

enabledToggle.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: enabledToggle.checked });
  needsReload = true;
  await refresh();
});

trackToggle.addEventListener("change", async () => {
  if (!pageStatus?.hostname) return;
  await chrome.runtime.sendMessage({
    type: "SET_TRACK_HOST",
    hostname: pageStatus.hostname,
    track: trackToggle.checked,
  });
  needsReload = true;
  await refresh();
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" && area !== "sync") return;
  refresh().catch(() => {});
});

reloadBtn.addEventListener("click", async () => {
  if (activeTab?.id != null) {
    await chrome.tabs.reload(activeTab.id);
    needsReload = false;
    window.close();
  }
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  await refresh();
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  settings = mergeSettings(response?.settings);
  stats = response?.stats || stats;
  pageStatus = await getPageStatus();

  renderGlobal();
  renderCurrentPage();
  renderSiteList();
}

async function getPageStatus() {
  if (!activeTab?.id || !isHttpUrl(activeTab.url)) {
    return {
      ok: false,
      hostname: hostnameFromUrl(activeTab?.url),
      unavailable: true,
    };
  }

  try {
    return await chrome.tabs.sendMessage(activeTab.id, { type: "GET_PAGE_STATUS" });
  } catch {
    return {
      ok: false,
      hostname: hostnameFromUrl(activeTab.url),
      unavailable: true,
    };
  }
}

function renderGlobal() {
  enabledToggle.checked = Boolean(settings.enabled);
  app.classList.toggle("disabled", !settings.enabled);
  const modeLabel = settings.mode === "privacy" ? "Privacy" : "Owner";
  analyticsHostLabel.textContent = `${modeLabel} · ${formatHostSummary(settings)}`;
  blockedCount.textContent = formatCount(stats.blockedTotal || 0);
  blockedCopy.textContent =
    stats.blockedOnTab > 0
      ? `${stats.blockedOnTab} on this page`
      : "Pageviews and send requests hidden from this browser";
  emptySites.textContent = settings.analyticsHosts.length
    ? `No Umami sites found yet. Visit a site that loads ${settings.analyticsHosts.join(", ")}.`
    : "No Umami sites found yet. Open a website that uses Umami, or add a host in Settings.";
  reloadBtn.hidden = !needsReload || !activeTab?.id || !isHttpUrl(activeTab.url);
}

function renderCurrentPage() {
  const hostname = pageStatus?.hostname || hostnameFromUrl(activeTab?.url) || "This page";
  siteHostname.textContent = hostname;
  const forced = Boolean(pageStatus?.isDevSite);

  if (pageStatus?.unavailable) {
    setPill("unavailable", "Unavailable");
    trackerMeta.hidden = true;
    trackRow.hidden = true;
    pageHint.textContent = "Open a normal website to check for Umami and control tracking.";
    return;
  }

  const detected = Boolean(pageStatus?.detected);
  const excluding = Boolean(settings.enabled && (detected || forced) && pageStatus?.exclude);
  const tracking = Boolean(settings.enabled && detected && !pageStatus?.exclude && !forced);

  trackRow.hidden = !detected && !forced;
  trackToggle.checked = Boolean(pageStatus?.trackEvents) && !forced;
  trackToggle.disabled = !settings.enabled || forced;
  trackCopy.textContent = forced
    ? "This looks like a local or preview site, so it stays excluded."
    : "Allow pageviews and custom events from this browser on this site.";
  trackerMeta.hidden = !detected;

  websiteId.textContent = pageStatus?.websiteId || "Not exposed on the script tag";
  const trackerHost = pageStatus?.analyticsHost || settings.analyticsHosts[0] || "";
  scriptSrc.textContent =
    pageStatus?.scriptSrc || pageStatus?.hostUrl || (trackerHost ? `Talks to ${trackerHost}` : "Umami tracker detected");

  if (!settings.enabled) {
    setPill("idle", "Extension off");
    pageHint.textContent = "The extension is off. Umami can collect pageviews and events from this browser.";
    return;
  }

  if (forced) {
    setPill("excluded", "Dev excluded");
    pageHint.textContent = "Local and preview sites are always excluded from Umami.";
    return;
  }

  if (!detected) {
    setPill("idle", "Not found");
    pageHint.textContent = settings.analyticsHosts.length
      ? `No Umami tracker for ${settings.analyticsHosts.join(", ")} was found on this page.`
      : "No Umami tracker was found on this page. Visit a site that embeds Umami, or add a host in Settings.";
    return;
  }

  if (excluding) {
    setPill("excluded", "Stealth on");
    pageHint.textContent =
      "Your pageviews and custom events are hidden. Umami reads localStorage.umami.disabled and /api/send is blocked.";
    return;
  }

  if (tracking) {
    setPill("tracking", "Tracking you");
    pageHint.textContent = "This site is allowed to record your events from this browser.";
  }
}

function renderSiteList() {
  const entries = Object.entries(settings.detectedHosts).sort(
    (a, b) => (b[1]?.lastSeen || 0) - (a[1]?.lastSeen || 0),
  );
  siteCount.textContent = String(entries.length);
  siteList.innerHTML = "";
  emptySites.hidden = entries.length > 0;

  for (const [hostname, info] of entries) {
    const item = document.createElement("li");
    const forced = isForcedExcludeHost(settings, hostname);
    const tracking = Boolean(settings.trackOnHosts[hostname]) && !forced;
    const name = document.createElement("div");
    name.className = "name";
    const detail = forced
      ? "Always excluded · dev/preview"
      : info?.websiteId
        ? `${tracking ? "Tracking my events" : "Hidden from Umami"} · ${info.websiteId}`
        : tracking
          ? "Tracking my events"
          : "Hidden from Umami";
    name.innerHTML = `<p>${escapeHtml(hostname)}</p><p>${escapeHtml(detail)}</p>`;

    const toggle = document.createElement("label");
    toggle.className = "switch compact";
    toggle.title = forced ? "Dev sites stay excluded" : "Track my events on this site";
    toggle.innerHTML = `<input type="checkbox" ${tracking ? "checked" : ""} ${
      settings.enabled && !forced ? "" : "disabled"
    } /><span class="slider"></span>`;
    toggle.querySelector("input").addEventListener("change", async (event) => {
      await chrome.runtime.sendMessage({
        type: "SET_TRACK_HOST",
        hostname,
        track: event.target.checked,
      });
      if (hostname === pageStatus?.hostname) needsReload = true;
      await refresh();
    });

    const forget = document.createElement("button");
    forget.className = "forget";
    forget.type = "button";
    forget.title = "Forget this site";
    forget.setAttribute("aria-label", `Forget ${hostname}`);
    forget.textContent = "×";
    forget.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CLEAR_HOST", hostname });
      if (hostname === pageStatus?.hostname) needsReload = true;
      await refresh();
    });

    item.append(name, toggle, forget);
    siteList.append(item);
  }
}

function setPill(kind, label) {
  statusPill.className = `pill ${kind}`;
  statusPill.textContent = label;
}

function formatCount(value) {
  const count = Number(value) || 0;
  if (count > 999) return "999+";
  return String(count);
}

function isHttpUrl(url) {
  return /^https?:/i.test(url || "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
