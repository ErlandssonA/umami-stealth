(() => {
  let settings = mergeSettings({});
  let detected = null;
  let scanTimer = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target.nodeName === "SCRIPT") {
        if (inspectNode(mutation.target)) return;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeName === "SCRIPT" && inspectNode(node)) {
          return;
        }
        if (node.querySelectorAll) {
          for (const script of node.querySelectorAll("script")) {
            if (inspectNode(script)) return;
          }
        }
      }
    }
  });

  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-website-id", "data-host-url"],
  });

  boot();
  document.addEventListener("DOMContentLoaded", scanPage, { once: true });
  window.addEventListener("load", () => {
    scanPage();
    scanPerformance();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" && area !== "sync") return;
    getSettings().then((next) => {
      settings = next;
      applyCurrentPolicy();
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_STATUS") {
      getSettings().then((next) => {
        settings = next;
        applyCurrentPolicy();
        sendResponse(getPageStatus());
      });
      return true;
    }
    if (message?.type === "APPLY_POLICY") {
      getSettings().then((next) => {
        settings = next;
        applyCurrentPolicy();
        sendResponse(getPageStatus());
      });
      return true;
    }
    if (message?.type === "RESCAN") {
      getSettings().then((next) => {
        settings = next;
        scanPage();
        scanPerformance();
        applyCurrentPolicy();
        sendResponse(getPageStatus());
      });
      return true;
    }
    return undefined;
  });

  async function boot() {
    settings = await getSettings();
    if (settings.detectedHosts[location.hostname]) {
      detected = {
        websiteId: settings.detectedHosts[location.hostname].websiteId || "",
        scriptSrc: settings.detectedHosts[location.hostname].scriptSrc || "",
        hostUrl: settings.detectedHosts[location.hostname].hostUrl || "",
        analyticsHost: settings.detectedHosts[location.hostname].analyticsHost || "",
      };
    }
    applyCurrentPolicy();
    scanPage();
  }

  function inspectNode(script) {
    const match = inspectUmamiScript(script, settings, location.href);
    if (!match) return false;
    rememberDetection(match);
    return true;
  }

  function rememberDetection(partial) {
    detected = {
      websiteId: partial.websiteId || detected?.websiteId || "",
      scriptSrc: partial.scriptSrc || detected?.scriptSrc || "",
      hostUrl: partial.hostUrl || detected?.hostUrl || "",
      analyticsHost: partial.analyticsHost || detected?.analyticsHost || "",
    };
    applyCurrentPolicy();
    reportDetection();
  }

  function scanPage() {
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      if (inspectNode(script)) return;
    }
  }

  function scanPerformance() {
    if (detected || typeof performance === "undefined") return;
    try {
      for (const entry of performance.getEntriesByType("resource")) {
        if (urlPointsToAnyAnalytics(entry.name, settings.analyticsHosts, location.href)) {
          rememberDetection({
            analyticsHost:
              settings.analyticsHosts.find((host) => urlPointsToAnalytics(entry.name, host, location.href)) ||
              hostnameFromUrl(entry.name, location.href),
            scriptSrc: entry.name,
          });
          return;
        }
        if (settings.analyticsHosts.length > 0 && settings.mode === "owner") continue;
        if (!looksLikeUmamiEndpoint(entry.name, location.href)) continue;
        rememberDetection({
          analyticsHost: hostnameFromUrl(entry.name, location.href),
          scriptSrc: entry.name,
        });
        return;
      }
    } catch {
      // Ignore restricted performance access.
    }
  }

  function applyCurrentPolicy() {
    applyUmamiDisabled(shouldExcludeVisits(settings, location.hostname, { detected: Boolean(detected) }));
  }

  function reportDetection() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      chrome.runtime
        .sendMessage({
          type: "REPORT_DETECTION",
          hostname: location.hostname,
          websiteId: detected?.websiteId || "",
          scriptSrc: detected?.scriptSrc || "",
          hostUrl: detected?.hostUrl || "",
          analyticsHost: detected?.analyticsHost || "",
        })
        .catch(() => {});
    }, 50);
  }

  function getPageStatus() {
    const hostname = location.hostname;
    const exclude = shouldExcludeVisits(settings, hostname, { detected: Boolean(detected) });
    return {
      ok: true,
      hostname,
      href: location.href,
      detected: Boolean(detected || settings.detectedHosts[hostname]),
      websiteId: detected?.websiteId || settings.detectedHosts[hostname]?.websiteId || "",
      scriptSrc: detected?.scriptSrc || settings.detectedHosts[hostname]?.scriptSrc || "",
      hostUrl: detected?.hostUrl || settings.detectedHosts[hostname]?.hostUrl || "",
      exclude,
      trackEvents: Boolean(settings.trackOnHosts[hostname]),
      umamiDisabled: isUmamiCurrentlyDisabled(),
      analyticsHost: detected?.analyticsHost || "",
      isDevSite: isForcedExcludeHost(settings, hostname),
    };
  }
})();
