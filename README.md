# FirestoreDownloader

A **Chrome browser extension** that automatically detects when any website makes
a request to the **Firebase Storage** or **Firestore REST API**, captures the
request metadata, and lets you download those files directly from the extension
popup.

---

## Features

- 🔍 **Auto-detection** – intercepts requests to `firebasestorage.googleapis.com`
  (file downloads with `?alt=media`) and `firestore.googleapis.com` (document
  reads) via the `chrome.webRequest` API and a `content.js` XHR/fetch hook.
- 📋 **Capture history** – stores up to 200 recent requests with file name,
  type, URL and timestamp.
- ⬇ **One-click download** – downloads files to your local Downloads folder
  via `chrome.downloads`.
- 📋 **Copy URL** – copies the raw request URL to your clipboard.
- 🔔 **Notifications** – desktop notification each time a new file is captured.
- 🔢 **Badge counter** – the extension icon shows how many files are waiting to
  be downloaded.
- 🗂 **Filter** – switch between "All", "Storage files", and "Firestore docs".

---

## File Structure

```
FirestoreDownloader/
├── manifest.json      # Extension manifest (Manifest V3)
├── background.js      # Service worker – request interception & storage
├── content.js         # Content script – XHR/fetch hooking
├── popup.html         # Popup UI (HTML)
├── popup.css          # Popup styles
├── popup.js           # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Installation (Chrome / Edge)

1. Clone or download this repository.
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the `FirestoreDownloader` folder.
5. The extension icon appears in your toolbar. 🎉

---

## How It Works

### Detection

| Layer | Mechanism | Covered URLs |
|---|---|---|
| `background.js` | `chrome.webRequest.onCompleted` | All network requests from any tab |
| `content.js` | XHR/fetch intercept | Same-origin and cross-origin page requests |

**Firebase Storage** URLs are matched when they contain `/o/` **and** the query
parameter `alt=media` (which signals an actual file download, not a metadata
call).

**Firestore REST API** URLs are matched when they contain `/documents/`.

### Download

Clicking **⬇ Download** sends a message to the background service worker which
calls `chrome.downloads.download({ url, filename })`.  The file is saved to your
browser's default Downloads directory.

---

## Permissions Explained

| Permission | Reason |
|---|---|
| `webRequest` | Monitor outgoing network requests |
| `downloads` | Trigger file downloads |
| `storage` | Persist captured file list between popup opens |
| `notifications` | Desktop alert when a file is captured |
| `host_permissions` (Firebase hosts) | Required for `webRequest` to intercept those hosts |
