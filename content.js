/**
 * content.js – Firestore Downloader Content Script (MAIN world)
 *
 * Runs in the page's main JavaScript execution context so it can intercept
 * XMLHttpRequest and fetch before the page uses them.
 *
 * NOTE: chrome.runtime is NOT available in the MAIN world.  Detected URLs are
 * forwarded to content-bridge.js (which runs in the ISOLATED world and has
 * access to chrome.runtime) via window.postMessage.
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
   * Forward a detected URL to the ISOLATED-world bridge script via postMessage.
   * The bridge (content-bridge.js) then relays it to the service worker.
   * @param {string} url
   */
  function notifyBackground(url) {
    window.postMessage({ _firestoreDownloader: true, url }, "*");
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
