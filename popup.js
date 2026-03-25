/**
 * popup.js – Firestore Downloader Popup
 *
 * Renders the list of captured Firebase requests and handles download /
 * clear actions by messaging the background service worker.
 */

"use strict";

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const fileListEl  = document.getElementById("file-list");
const emptyStateEl = document.getElementById("empty-state");
const countEl      = document.getElementById("count");
const filterSelect = document.getElementById("filter-type");
const clearBtn     = document.getElementById("btn-clear");
const listenBtn    = document.getElementById("btn-listen");

// ─── State ────────────────────────────────────────────────────────────────────

let allFiles = [];
let isListening = true;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an ISO timestamp to a short human-readable string.
 * @param {string} iso
 * @returns {string}
 */
function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * Return the appropriate emoji icon for a record type.
 * @param {string} type - "storage" | "firestore"
 * @returns {string}
 */
function typeIcon(type) {
  return type === "storage" ? "📦" : "📄";
}

/**
 * Safely truncate a URL for display (keeps the meaningful parts visible).
 * @param {string} url
 * @returns {string}
 */
function displayUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 80) + (u.pathname.length > 80 ? "…" : "");
  } catch {
    return url.slice(0, 80);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Build the DOM node for a single file record.
 * @param {object} record
 * @returns {HTMLElement}
 */
function buildCard(record) {
  const card = document.createElement("div");
  card.className = "file-card" + (record.downloaded ? " file-card--downloaded" : "");
  card.dataset.id = record.id;

  const badgeClass = record.type === "storage"
    ? "file-card__badge--storage"
    : "file-card__badge--firestore";

  const badgeLabel = record.type === "storage" ? "Storage" : "Firestore";

  card.innerHTML = `
    <div class="file-card__header">
      <span class="file-card__icon">${typeIcon(record.type)}</span>
      <span class="file-card__name">${escapeHtml(record.name)}</span>
      <span class="file-card__badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
    </div>
    <div class="file-card__url" title="${escapeHtml(record.url)}">${escapeHtml(displayUrl(record.url))}</div>
    <div class="file-card__meta">
      <span class="file-card__time">${escapeHtml(formatTime(record.capturedAt))}</span>
      <div class="file-card__actions">
        <button class="btn btn--secondary btn--xs btn-copy" data-url="${escapeHtml(record.url)}" title="Copy URL">
          📋 Copy URL
        </button>
        <button class="btn btn--primary btn--xs btn-download"
          data-id="${escapeHtml(record.id)}"
          data-url="${escapeHtml(record.url)}"
          data-name="${escapeHtml(record.name)}"
          ${record.downloaded ? 'title="Already downloaded"' : 'title="Download file"'}>
          ${record.downloaded ? "✅ Downloaded" : "⬇ Download"}
        </button>
      </div>
    </div>
  `;

  return card;
}

/**
 * Escape a string for safe inclusion in HTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Re-render the file list using the current filter value.
 */
function render() {
  const filterValue = filterSelect.value;
  const filtered = filterValue === "all"
    ? allFiles
    : allFiles.filter((f) => f.type === filterValue);

  // Remove all existing cards (keep the empty-state element).
  Array.from(fileListEl.querySelectorAll(".file-card")).forEach((el) => el.remove());

  if (filtered.length === 0) {
    emptyStateEl.style.display = "block";
    countEl.textContent = "0 file(s) captured";
    return;
  }

  emptyStateEl.style.display = "none";
  countEl.textContent = `${filtered.length} file(s) captured`;

  const fragment = document.createDocumentFragment();
  filtered.forEach((record) => fragment.appendChild(buildCard(record)));
  fileListEl.appendChild(fragment);
}

// ─── Listening state ──────────────────────────────────────────────────────────

/**
 * Sync the listen button's appearance to the current isListening value.
 */
function updateListenButton() {
  if (isListening) {
    listenBtn.textContent = "⏹ Listening";
    listenBtn.className   = "btn btn--listen-active btn--sm";
    listenBtn.title       = "Stop listening for requests";
  } else {
    listenBtn.textContent = "▶ Start Listening";
    listenBtn.className   = "btn btn--listen-inactive btn--sm";
    listenBtn.title       = "Start listening for requests";
  }
}

function loadListeningState() {
  chrome.runtime.sendMessage({ action: "getListeningState" }, (response) => {
    if (chrome.runtime.lastError) return;
    isListening = response?.isListening ?? true;
    updateListenButton();
  });
}

listenBtn.addEventListener("click", () => {
  isListening = !isListening;
  listenBtn.disabled = true;
  chrome.runtime.sendMessage({ action: "setListening", value: isListening }, () => {
    listenBtn.disabled = false;
    updateListenButton();
  });
});

// ─── Load data from background ────────────────────────────────────────────────

function loadFiles() {
  chrome.runtime.sendMessage({ action: "getFiles" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Firestore Downloader popup:", chrome.runtime.lastError.message);
      return;
    }
    allFiles = (response && response.files) ? response.files : [];
    render();
  });
}

// ─── Event delegation ─────────────────────────────────────────────────────────

fileListEl.addEventListener("click", (e) => {
  // Download button
  const downloadBtn = e.target.closest(".btn-download");
  if (downloadBtn) {
    const { id, url, name } = downloadBtn.dataset;

    downloadBtn.disabled = true;
    downloadBtn.textContent = "⏳ Saving…";

    chrome.runtime.sendMessage({ action: "downloadFile", url, filename: name }, (res) => {
      if (chrome.runtime.lastError || (res && !res.success)) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = "⬇ Download";
        const errMsg = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "Unknown error";
        alert("Download failed: " + errMsg);
        return;
      }

      // Mark as downloaded in the background store.
      chrome.runtime.sendMessage({ action: "markDownloaded", id }, () => {
        // Update local state and re-render.
        allFiles = allFiles.map((f) =>
          f.id === id ? { ...f, downloaded: true } : f
        );
        render();
      });
    });
    return;
  }

  // Copy URL button
  const copyBtn = e.target.closest(".btn-copy");
  if (copyBtn) {
    const url = copyBtn.dataset.url;
    navigator.clipboard.writeText(url).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    }).catch(console.error);
  }
});

// ─── Clear all ────────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all captured files?")) return;
  chrome.runtime.sendMessage({ action: "clearFiles" }, () => {
    allFiles = [];
    render();
  });
});

// ─── Filter change ────────────────────────────────────────────────────────────

filterSelect.addEventListener("change", render);

// ─── Init ─────────────────────────────────────────────────────────────────────

loadListeningState();
loadFiles();
