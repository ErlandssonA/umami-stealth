const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const hostList = document.getElementById("host-list");
const hostCount = document.getElementById("host-count");
const emptyHosts = document.getElementById("empty-hosts");
const hostInput = document.getElementById("host-input");
const addHostBtn = document.getElementById("add-host-btn");
const cloudBtn = document.getElementById("cloud-btn");
const devToggle = document.getElementById("dev-toggle");
const devPatterns = document.getElementById("dev-patterns");
const saveDevBtn = document.getElementById("save-dev-btn");
const resetDevBtn = document.getElementById("reset-dev-btn");
const syncPill = document.getElementById("sync-pill");
const syncHint = document.getElementById("sync-hint");
const extensionId = document.getElementById("extension-id");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
const resetBlockedBtn = document.getElementById("reset-blocked-btn");
const backupStatus = document.getElementById("backup-status");

let settings = mergeSettings({});

init().catch((error) => {
  backupStatus.textContent = `Could not load settings: ${error.message}`;
});

modeInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({ type: "SET_MODE", mode: input.value });
    await refresh();
  });
});

addHostBtn.addEventListener("click", addHost);
hostInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addHost();
  }
});

cloudBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "ADD_CLOUD_HOST" });
  await refresh();
});

saveDevBtn.addEventListener("click", saveDevPatterns);
devToggle.addEventListener("change", saveDevPatterns);
resetDevBtn.addEventListener("click", async () => {
  devPatterns.value = DEFAULT_DEV_PATTERNS.join("\n");
  await saveDevPatterns();
});

exportBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "EXPORT_SETTINGS" });
  const blob = new Blob([JSON.stringify(response.payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "umami-stealth-settings.json";
  link.click();
  URL.revokeObjectURL(url);
  backupStatus.textContent = "Settings exported.";
});

importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    await chrome.runtime.sendMessage({ type: "IMPORT_SETTINGS", payload: text });
    backupStatus.textContent = "Settings imported.";
    await refresh();
  } catch (error) {
    backupStatus.textContent = `Import failed: ${error.message}`;
  }
});

resetBlockedBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "RESET_BLOCKED" });
  backupStatus.textContent = "Blocked request count reset on this device.";
  await refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" && area !== "sync") return;
  refresh().catch(() => {});
});

async function init() {
  await refresh();
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  settings = mergeSettings(response?.settings);
  render(response?.stats);
}

async function addHost() {
  const host = hostInput.value.trim();
  if (!host) return;
  const response = await chrome.runtime.sendMessage({ type: "ADD_ANALYTICS_HOST", host });
  if (!response?.ok) {
    backupStatus.textContent = response?.error || "Could not add host.";
    return;
  }
  hostInput.value = "";
  await refresh();
}

async function saveDevPatterns() {
  await chrome.runtime.sendMessage({
    type: "SET_DEV_PATTERNS",
    excludeDevSites: devToggle.checked,
    devPatterns: devPatterns.value.split("\n"),
  });
  backupStatus.textContent = "Local and preview patterns saved.";
  await refresh();
}

function render(stats) {
  for (const input of modeInputs) {
    input.checked = input.value === settings.mode;
  }

  hostCount.textContent = String(settings.analyticsHosts.length);
  hostList.innerHTML = "";
  emptyHosts.hidden = settings.analyticsHosts.length > 0;
  for (const host of settings.analyticsHosts) {
    const item = document.createElement("li");
    const name = document.createElement("div");
    name.className = "name";
    const cloud = host === UMAMI_CLOUD_HOST ? "Umami Cloud" : "Self-hosted";
    name.innerHTML = `<p>${escapeHtml(host)}</p><p>${cloud}</p>`;
    const forget = document.createElement("button");
    forget.className = "forget";
    forget.type = "button";
    forget.title = "Remove host";
    forget.textContent = "×";
    forget.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "REMOVE_ANALYTICS_HOST", host });
      await refresh();
    });
    item.append(name, forget);
    hostList.append(item);
  }

  cloudBtn.disabled = settings.analyticsHosts.includes(UMAMI_CLOUD_HOST);
  cloudBtn.textContent = cloudBtn.disabled ? "Umami Cloud added" : "Add Umami Cloud";

  devToggle.checked = Boolean(settings.excludeDevSites);
  if (document.activeElement !== devPatterns) {
    devPatterns.value = settings.devPatterns.join("\n");
  }

  extensionId.textContent = stats?.extensionId || chrome.runtime.id;
  if (settings.syncError) {
    setSync("unavailable", "Sync write failed", `${settings.syncError} Settings are kept on this device instead.`);
    return;
  }
  setSync(
    "excluded",
    "Using browser sync",
    "Hosts, mode, and per-site tracking choices sync through Brave Sync (or Chrome/Edge sync). Blocked-request counts stay on this device.",
  );
}

function setSync(kind, label, hint) {
  syncPill.className = `pill ${kind}`;
  syncPill.textContent = label;
  syncHint.textContent = hint;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
