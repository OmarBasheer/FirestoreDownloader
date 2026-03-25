/**
 * background.js – Firestore Downloader Service Worker
 *
 * Monitors network requests to:
 *   - Firebase Storage  : https://firebasestorage.googleapis.com/v0/b/…/o/…?alt=media
 *   - Firestore REST API: https://firestore.googleapis.com/v1/projects/…
 *
 * Every intercepted request is stored in chrome.storage.local so the popup
 * can display and download them.
 */

"use strict";

const FIREBASE_STORAGE_ORIGIN = "firebasestorage.googleapis.com";
const FIRESTORE_ORIGIN = "firestore.googleapis.com";

/** Maximum number of captured file records retained in storage. */
const MAX_CAPTURED_FILES = 200;

/** Window (ms) within which a duplicate URL is suppressed. */
const DUPLICATE_WINDOW_MS = 5000;

/**
 * Decide whether a completed request is a candidate we care about.
 *
 * Firebase Storage file download  – URL contains "/o/" and "alt=media"
 * Firestore document read         – URL contains "/documents/"
 *
 * @param {string} url
 * @returns {{ isStorage: boolean, isFirestore: boolean } | null}
 */
function classifyUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === FIREBASE_STORAGE_ORIGIN) {
      // Only capture actual file downloads (alt=media), not metadata calls.
      if (parsed.pathname.includes("/o/") && parsed.searchParams.get("alt") === "media") {
        return { isStorage: true, isFirestore: false };
      }
    }

    if (parsed.hostname === FIRESTORE_ORIGIN) {
      if (parsed.pathname.includes("/documents/")) {
        return { isStorage: false, isFirestore: true };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Derive a human-readable file name from a Firebase Storage URL.
 * The path segment after "/o/" is percent-encoded; decode it and take the
 * last component as the file name.
 *
 * @param {string} url
 * @returns {string}
 */
function fileNameFromStorageUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/o/");
    if (segments.length < 2) return "file";
    const decoded = decodeURIComponent(segments[1]);
    const parts = decoded.split("/");
    return parts[parts.length - 1] || "file";
  } catch {
    return "file";
  }
}

/**
 * Derive a descriptive name for a Firestore document URL.
 * Uses the last two path components (collection/document) as the name.
 *
 * @param {string} url
 * @returns {string}
 */
function fileNameFromFirestoreUrl(url) {
  try {
    const parsed = new URL(url);
    const afterDocuments = parsed.pathname.split("/documents/")[1];
    if (!afterDocuments) return "document.json";
    const parts = afterDocuments.split("/").filter(Boolean);
    return parts.slice(-2).join("_") + ".json";
  } catch {
    return "document.json";
  }
}

/**
 * Build the metadata record stored for a captured request.
 *
 * @param {chrome.webRequest.WebResponseCacheDetails} details
 * @param {{ isStorage: boolean, isFirestore: boolean }} classification
 * @returns {object}
 */
function buildRecord(details, classification) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const name = classification.isStorage
    ? fileNameFromStorageUrl(details.url)
    : fileNameFromFirestoreUrl(details.url);

  return {
    id,
    url: details.url,
    name,
    type: classification.isStorage ? "storage" : "firestore",
    tabId: details.tabId,
    statusCode: details.statusCode,
    capturedAt: new Date().toISOString(),
    downloaded: false,
  };
}

/**
 * Persist a new record to chrome.storage.local and update the badge count.
 *
 * @param {object} record
 */
async function saveRecord(record) {
  const result = await chrome.storage.local.get({ capturedFiles: [] });
  const files = result.capturedFiles;

  // Avoid duplicates (same URL within a short window)
  const isDuplicate = files.some(
    (f) => f.url === record.url && Date.now() - new Date(f.capturedAt).getTime() < DUPLICATE_WINDOW_MS
  );
  if (isDuplicate) return;

  files.unshift(record);
  // Cap history at MAX_CAPTURED_FILES entries to keep storage manageable.
  const trimmed = files.slice(0, MAX_CAPTURED_FILES);
  await chrome.storage.local.set({ capturedFiles: trimmed });

  updateBadge(trimmed);
  showNotification(record);
}

/**
 * Update the extension action badge with the count of un-downloaded files.
 *
 * @param {object[]} files
 */
function updateBadge(files) {
  const undownloaded = files.filter((f) => !f.downloaded).length;
  chrome.action.setBadgeText({ text: undownloaded > 0 ? String(undownloaded) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#FF6B35" });
}

/**
 * Show a desktop notification for a newly captured file.
 *
 * @param {object} record
 */
function showNotification(record) {
  const label = record.type === "storage" ? "Storage file" : "Firestore document";
  chrome.notifications.create(record.id, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Firestore Downloader",
    message: `${label} captured: ${record.name}`,
  });
}

// ─── Web Request Listener ────────────────────────────────────────────────────

chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Only capture successful responses (2xx) that are not preflight/OPTIONS.
    if (details.method === "OPTIONS") return;
    if (details.statusCode < 200 || details.statusCode >= 300) return;

    const classification = classifyUrl(details.url);
    if (!classification) return;

    const record = buildRecord(details, classification);
    saveRecord(record).catch(console.error);
  },
  {
    urls: [
      "https://firebasestorage.googleapis.com/*",
      "https://firestore.googleapis.com/*",
    ],
  }
);

// ─── Message Handler (from popup) ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getFiles") {
    chrome.storage.local.get({ capturedFiles: [] }, (result) => {
      sendResponse({ files: result.capturedFiles });
    });
    return true; // keep channel open for async response
  }

  if (message.action === "downloadFile") {
    const { url, filename } = message;
    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  if (message.action === "markDownloaded") {
    chrome.storage.local.get({ capturedFiles: [] }, async (result) => {
      const files = result.capturedFiles.map((f) =>
        f.id === message.id ? { ...f, downloaded: true } : f
      );
      await chrome.storage.local.set({ capturedFiles: files });
      updateBadge(files);
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "clearFiles") {
    chrome.storage.local.set({ capturedFiles: [] }, () => {
      updateBadge([]);
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "firestoreRequestDetected") {
    // Forwarded from content.js for XHR/fetch-based requests not captured by
    // webRequest (e.g. cross-origin fetches in Manifest V3 service workers).
    const classification = classifyUrl(message.url);
    if (classification) {
      const record = buildRecord(
        { url: message.url, tabId: message.tabId, statusCode: 200, method: "GET" },
        classification
      );
      saveRecord(record).catch(console.error);
    }
    sendResponse({ success: true });
    return true;
  }
});

// ─── Startup: sync badge on install/reload ───────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ capturedFiles: [] }, (result) => {
    updateBadge(result.capturedFiles);
  });
});
