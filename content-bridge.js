/**
 * content-bridge.js – Firestore Downloader ISOLATED-world bridge
 *
 * Runs in the default (ISOLATED) world so it has access to chrome.runtime.
 * It listens for window.postMessage events posted by content.js (MAIN world)
 * and relays them to the service worker via chrome.runtime.sendMessage.
 *
 * Security: only URLs whose hostname matches a known Firebase/Firestore host
 * are forwarded, preventing a malicious page from injecting arbitrary records
 * by posting crafted messages with the _firestoreDownloader flag.
 */

"use strict";

const ALLOWED_HOSTS = ["firebasestorage.googleapis.com", "firestore.googleapis.com"];

window.addEventListener("message", (event) => {
  // Only accept messages originating from this same window.
  if (event.source !== window) return;
  if (!event.data || !event.data._firestoreDownloader) return;

  const url = event.data.url;
  if (typeof url !== "string" || !url) return;

  // Validate the URL hostname against the known Firebase/Firestore hosts so
  // that a page cannot inject arbitrary URLs into the extension's capture list.
  try {
    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) return;
  } catch {
    return;
  }

  try {
    chrome.runtime.sendMessage({
      action: "firestoreRequestDetected",
      url,
    });
  } catch {
    // Extension context may have been invalidated (e.g. extension was reloaded);
    // silently ignore so the page is not disrupted.
  }
});
