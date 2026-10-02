const DATABASE_NAME = "csdrepoai_submission_drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const FILE_SLOTS = ["manuscript", "sourceCode", "ieee", "acm", "apa"];
const inMemoryDrafts = new Map();
const analysisByFile = new WeakMap();
const clearVersions = new Map();

function emptyFiles() {
  return Object.fromEntries(FILE_SLOTS.map((slot) => [slot, null]));
}

function fileMetadata(file) {
  if (!file) return null;
  return {
    name: String(file.name || "").slice(0, 255),
    size: Number(file.size) || 0,
    type: String(file.type || "").slice(0, 120),
    lastModified: Number(file.lastModified) || 0,
  };
}

function getSuggestionMetadata(suggestions) {
  if (!suggestions) return null;
  return {
    category: suggestions.category || "",
    keywords: suggestions.keywords || "",
    sdgTags: Array.isArray(suggestions.sdgTags) ? suggestions.sdgTags : [],
    sdgNames: Array.isArray(suggestions.sdgNames) ? suggestions.sdgNames : [],
    abstract: suggestions.abstract || "",
  };
}

function openDraftDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local draft storage."));
    request.onblocked = () => reject(new Error("Local draft storage is blocked by another browser tab."));
  });
}

function compareRevision(left, right) {
  if ((left?.updatedAt || 0) !== (right?.updatedAt || 0)) return (left?.updatedAt || 0) - (right?.updatedAt || 0);
  return String(left?.writerId || "").localeCompare(String(right?.writerId || ""));
}

function makeWriterId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function draftSnapshot(userId, draft, now, previous) {
  const files = { ...emptyFiles(), ...(draft.files || {}) };
  const detachedFiles = { ...(draft.detachedFiles || {}) };
  const fileMetadataBySlot = Object.fromEntries(FILE_SLOTS.map((slot) => [
    slot,
    fileMetadata(files[slot]) || detachedFiles[slot] || null,
  ]));
  return {
    version: 1,
    userId,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    writerId: makeWriterId(),
    form: draft.form || {},
    sdgTags: Array.isArray(draft.sdgTags) ? draft.sdgTags : [],
    // IndexedDB structured-clones File/Blob data, unlike JSON storage.
    files,
    detachedFiles: fileMetadataBySlot,
    manuscriptText: draft.manuscriptText || "",
    documentAnalysis: draft.documentAnalysis || { status: "idle", message: "" },
    documentChecks: draft.documentChecks || {},
    fileErrors: draft.fileErrors || {},
    typeConfirmations: draft.typeConfirmations || {},
    suggestions: getSuggestionMetadata(draft.suggestions),
    errorMsg: draft.errorMsg || "",
    status: draft.status === "error" ? "error" : "idle",
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local draft storage request failed."));
  });
}

/** Saves a user-scoped draft, including actual File bytes, in IndexedDB. */
export async function saveSubmissionDraft(userId, draft, now = Date.now()) {
  if (!userId || !draft) return { userId, saved: false, persistent: false };
  const versionAtStart = clearVersions.get(userId) || 0;
  const previous = inMemoryDrafts.get(userId);
  const snapshot = draftSnapshot(userId, draft, now, previous);
  inMemoryDrafts.set(userId, snapshot);

  let database;
  try {
    database = await openDraftDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(userId));
    if (current?.createdAt) snapshot.createdAt = current.createdAt;
    if ((clearVersions.get(userId) || 0) !== versionAtStart) {
      transaction.abort();
      return { userId, saved: false, persistent: true };
    }
    if (current && compareRevision(current, snapshot) > 0) {
      transaction.abort();
      inMemoryDrafts.set(userId, current);
      return { userId, saved: false, persistent: true, superseded: true };
    }
    store.put(snapshot);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save the local draft."));
      transaction.onabort = () => reject(transaction.error || new Error("Local draft save was cancelled."));
    });
    return { userId, saved: true, persistent: true };
  } catch (error) {
    // Keep the File references in memory for this page session; the UI reports that
    // cross-refresh persistence failed instead of claiming the draft was saved.
    return { userId, saved: false, persistent: false, error };
  } finally {
    database?.close();
  }
}

/** Loads the actual files and form state for the currently authenticated user. */
export async function loadSubmissionDraft(userId) {
  if (!userId) return null;
  let database;
  try {
    database = await openDraftDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const saved = await requestResult(transaction.objectStore(STORE_NAME).get(userId));
    if (!saved || saved.version !== 1 || saved.userId !== userId) return null;
    const restored = {
      ...saved,
      files: { ...emptyFiles(), ...(saved.files || {}) },
      detachedFiles: saved.detachedFiles || {},
      documentAnalysis: saved.documentAnalysis?.status === "analyzing"
        ? { status: "error", message: "Analysis was interrupted. The saved file is restored; select it again only if analysis needs to be rerun." }
        : saved.documentAnalysis || { status: "idle", message: "" },
      documentChecks: Object.fromEntries(Object.entries(saved.documentChecks || {}).map(([slot, check]) => [
        slot,
        check?.status === "analyzing"
          ? { ...check, type: "Unknown / Cannot Determine", confidence: 0.45, status: "restored" }
          : check,
      ])),
      restoredAfterReload: true,
    };
    inMemoryDrafts.set(userId, restored);
    return restored;
  } finally {
    database?.close();
  }
}

/** Explicit discard/success removes only this student's draft. */
export async function clearSubmissionDraft(userId) {
  if (!userId) return;
  clearVersions.set(userId, (clearVersions.get(userId) || 0) + 1);
  inMemoryDrafts.delete(userId);
  let database;
  try {
    database = await openDraftDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(userId);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear the local draft."));
      transaction.onabort = () => reject(transaction.error || new Error("Could not clear the local draft."));
    });
  } catch {
    // This is best-effort if browser storage is unavailable; no remote data is touched.
  } finally {
    database?.close();
  }
}

export function analyzeSubmissionFileOnce(file, analyzer) {
  if (!file || typeof analyzer !== "function") return Promise.resolve(null);
  let analysis = analysisByFile.get(file);
  if (!analysis) {
    analysis = Promise.resolve().then(() => analyzer(file));
    analysisByFile.set(file, analysis);
  }
  return analysis;
}

/** Test helper for simulating a full reload with a new module context. */
export function resetSubmissionDraftMemory(userId) {
  inMemoryDrafts.delete(userId);
}
