/**
 * content.js – Firestore Downloader Content Script
 *
 * Hooks into the page's XMLHttpRequest and fetch APIs to detect requests made
 * to Firebase Storage and the Firestore REST API.  Detected requests are
 * forwarded to the service worker via chrome.runtime.sendMessage so they can
 * be recorded even when webRequest alone cannot capture all request details.
 */

"use strict";

(function () {
  const TRACKED_HOSTS = ["firebasestorage.googleapis.com", "firestore.googleapis.com"];

  /**
   * Return true if the given URL string targets a Firebase/Firestore host.
   * @param {string} url
   * @returns {boolean}
   */
  function isTrackedUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return TRACKED_HOSTS.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Notify the service worker about an intercepted URL.
   * @param {string} url
   */
  function notifyBackground(url) {
    try {
      chrome.runtime.sendMessage({
        action: "firestoreRequestDetected",
        url,
        tabId: undefined, // background fills this in
      });
    } catch {
      // Extension context may have been invalidated; silently ignore.
    }
  }

  // ─── Hook XMLHttpRequest ────────────────────────────────────────────────────

  const OriginalXHR = window.XMLHttpRequest;

  class HookedXHR extends OriginalXHR {
    open(method, url, ...rest) {
      this._trackedUrl = String(url);
      return super.open(method, url, ...rest);
    }

    send(...args) {
      if (this._trackedUrl && isTrackedUrl(this._trackedUrl)) {
        this.addEventListener("load", () => {
          if (this.status >= 200 && this.status < 300) {
            notifyBackground(this._trackedUrl);
          }
        });
      }
      return super.send(...args);
    }
  }

  window.XMLHttpRequest = HookedXHR;

  // ─── Hook fetch ─────────────────────────────────────────────────────────────

  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const promise = originalFetch.call(this, input, init);

    if (isTrackedUrl(url)) {
      promise.then((response) => {
        if (response.ok) {
          notifyBackground(url);
        }
      }).catch(() => {});
    }

    return promise;
  };
})();
