# Umami Stealth

A browser extension that hides **your** visits and events from [Umami Analytics](https://umami.is).

It is for site owners and anyone else who does not want their own browser to show up in Umami stats. It works with Umami Cloud (`cloud.umami.is`) and any self-hosted Umami instance.

## How it works

When stealth is on, the extension:

1. Sets Umami’s official `localStorage.umami.disabled` flag on the site you are visiting.
2. Blocks `/api/send` and `/api/collect` requests from this browser to your Umami host(s).

Leave **Track my events** off to stay hidden. Turn it on for a site when you want this browser to be counted.

## Supported browsers

Load this folder as an unpacked Manifest V3 extension in:

| Browser | Works? | Extensions page |
| --- | --- | --- |
| Brave | Yes | `brave://extensions` |
| Google Chrome | Yes | `chrome://extensions` |
| Microsoft Edge | Yes | `edge://extensions` |
| Opera | Yes | `opera://extensions` |
| Vivaldi | Yes | `vivaldi://extensions` |
| Arc | Yes | `chrome://extensions` |
| Firefox 121+ | Yes, as a temporary add-on | `about:debugging#/runtime/this-firefox` |
| Safari | No | Different extension model |

Chromium browsers keep unpacked extensions after restart. Firefox only keeps a **temporary** add-on until the browser quits, unless you sign and install an `.xpi`.

## Install

### Chromium browsers (Brave, Chrome, Edge, Opera, Vivaldi, Arc)

1. Copy this folder onto your computer.
2. Open the extensions page for your browser (see the table above).
3. Turn on **Developer mode**. In Opera this is often a **Load unpacked** button without a separate toggle.
4. Click **Load unpacked**.
5. Select this folder (the one that contains `manifest.json`).
6. Pin **Umami Stealth** to the toolbar if you want quick access.
7. Allow it to run on all sites if the browser asks. It needs that to find Umami and block tracking requests.

After you change files, click **Reload** on the extensions page.

### Firefox 121 or newer

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` inside this folder.
4. Pin **Umami Stealth** from the Extensions menu if you want.

It will disappear when Firefox restarts.

## First-time setup

1. Open **Settings** from the popup, or right-click the icon and choose **Options**.
2. Stay on **Owner** if you only want to hide yourself from *your* Umami servers.
3. Click **Add Umami Cloud**, or add a self-hosted host like `analytics.example.com`. You can add more than one.
4. Open a website that embeds that tracker. The popup should say **Stealth on**.

If you leave the host list empty, visiting a site that embeds Umami will add that host automatically.

## Modes

- **Owner:** only detect and block the Umami hosts you configure. Use this when you run the analytics.
- **Privacy:** hide this browser from every Umami tracker it finds, including other people’s sites.

## Sync across devices (Brave Sync)

Settings use `chrome.storage.sync`, which Brave carries over **Brave Sync**. Chrome and Edge do the same with their own sync.

This is **not** the same as syncing the extension install. Unpacked extensions are not installed on other devices by Sync. Do this once per device:

1. Copy the same Umami Stealth folder to the other computer.
2. Load it unpacked. The ID is pinned in `manifest.json`, so Brave treats both as the same extension.
3. In Brave, open `brave://settings/braveSync/setup` and make sure **Settings** is enabled on the sync chain.
4. Optionally confirm `EXTENSION_SETTINGS` is running in `brave://sync-internals`.

Synced: mode, hosts, per-site “Track my events”, and dev/preview patterns.

Not synced: blocked-request counts, and the detected-site list (it fills in again when you visit).

If sync is delayed, use **Export JSON** / **Import JSON** in Settings.

## Usage

- **Master switch:** turn the extension off if you want this browser to be tracked everywhere.
- **This website:** shows whether Umami was found on the current page.
- **Track my events:** allow pageviews and custom events from this browser on that site.
- **Detected sites:** every site where Umami has been seen. Use the toggle per site, or × to forget it.
- **Hidden from Umami:** how many pageviews (and any blocked `/api/send` calls) this browser has hidden. The toolbar badge shows the count on the current tab, or `OFF` before anything is hidden, or `ON` when tracking is allowed.
- **Local and preview sites:** `localhost`, `*.local`, Vercel/Netlify/Cloudflare previews, and similar hosts stay excluded. Edit the list in Settings.
- **Reload page to apply:** click after changing settings so the current tab picks them up.

## Permissions

| Permission | Why |
| --- | --- |
| Access to all websites | Find Umami scripts and apply the exclude flag on each site |
| Storage | Remember hosts, mode, and per-site choices, and sync them |
| Tabs | Show the current site in the popup and badge |
| Block network requests | Stop `/api/send` from this browser when stealth is on |
| Matched-rule feedback | Count blocked requests on the badge (unpacked extensions) |

Nothing is sent to a third party. Settings stay in the browser, then in your Brave/Chrome/Edge sync account if that is enabled.

## Troubleshooting

- **Not found:** reload the page after installing, or add your Umami host in Settings.
- **Still seeing yourself in stats:** reload the site, confirm the host matches your tracker, and check that **Track my events** is off.
- **Settings not appearing on another device:** load this same folder unpacked there, then check that Settings is enabled in Brave Sync. Use export/import if needed.
- **Custom events still appear:** the network block covers `/api/send`. Reload once so the content script can set `umami.disabled` before the tracker runs.

## License

MIT. See [LICENSE](LICENSE).
