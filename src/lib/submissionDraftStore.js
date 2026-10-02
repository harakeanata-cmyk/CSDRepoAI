const STORAGE_PREFIX = "csdrepoai_submission_draft_v1_";
export const SUBMISSION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FILE_SLOTS = ["manuscript", "sourceCode", "ieee", "acm", "apa"];
const inMemoryDrafts = new Map();
const analysisByFile = new WeakMap();

function storageKey(userId) {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

function emptyFiles() {
  return Object.fromEntries(FILE_SLOTS.map((slot) => [slot, null]));
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
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

function isExpired(draft, now) {
  return !Number.isFinite(draft?.updatedAt) || now - draft.updatedAt > SUBMISSION_DRAFT_TTL_MS;
}

function toRestoredChecks(checks = {}) {
  return Object.fromEntries(Object.entries(checks).map(([slot, check]) => [
    slot,
    check?.status === "analyzing"
      ? { ...check, type: "Unknown / Cannot Determine", confidence: 0.45, status: "restored" }
      : check,
  ]));
}

/** Retains File references only in this tab's live JS context. */
export function saveSubmissionDraft(userId, draft, now = Date.now()) {
  if (!userId || !draft) return;
  const previous = inMemoryDrafts.get(userId);
  const detachedFiles = { ...(draft.detachedFiles || {}) };
  const files = { ...emptyFiles(), ...(draft.files || {}) };
  const fileMetadataBySlot = Object.fromEntries(FILE_SLOTS.map((slot) => [
    slot,
    fileMetadata(files[slot]) || detachedFiles[slot] || null,
  ]));
  const createdAt = previous?.createdAt || now;
  const snapshot = {
    ...draft,
    files,
    detachedFiles: fileMetadataBySlot,
    createdAt,
    updatedAt: now,
    status: draft.status === "error" ? "error" : "idle",
  };
  inMemoryDrafts.set(userId, snapshot);

  const storage = getSessionStorage();
  if (!storage) return;
  const serialized = {
    version: 1,
    userId,
    createdAt,
    updatedAt: now,
    form: draft.form,
    sdgTags: draft.sdgTags,
    fileMetadata: fileMetadataBySlot,
    documentAnalysis: draft.documentAnalysis,
    documentChecks: draft.documentChecks,
    fileErrors: draft.fileErrors,
    typeConfirmations: draft.typeConfirmations,
    suggestions: getSuggestionMetadata(draft.suggestions),
    errorMsg: draft.errorMsg || "",
    status: draft.status === "error" ? "error" : "idle",
  };
  try {
    storage.setItem(storageKey(userId), JSON.stringify(serialized));
  } catch {
    // In-memory route persistence remains available if browser storage is full or disabled.
  }
}

/** Returns the live draft for this tab, or metadata-only state after a reload. */
export function loadSubmissionDraft(userId, now = Date.now()) {
  if (!userId) return null;
  const cached = inMemoryDrafts.get(userId);
  if (cached) {
    if (!isExpired(cached, now)) return cached;
    clearSubmissionDraft(userId);
    return null;
  }

  const storage = getSessionStorage();
  if (!storage) return null;
  let saved;
  try {
    saved = JSON.parse(storage.getItem(storageKey(userId)) || "null");
  } catch {
    try { storage.removeItem(storageKey(userId)); } catch { /* Browser storage may be disabled. */ }
    return null;
  }
  if (!saved || saved.version !== 1 || saved.userId !== userId || isExpired(saved, now)) {
    if (saved) {
      try { storage.removeItem(storageKey(userId)); } catch { /* Browser storage may be disabled. */ }
    }
    return null;
  }

  const detachedFiles = saved.fileMetadata || {};
  const restored = {
    form: saved.form || {},
    sdgTags: Array.isArray(saved.sdgTags) ? saved.sdgTags : [],
    files: emptyFiles(),
    detachedFiles,
    manuscriptText: "",
    documentAnalysis: saved.documentAnalysis?.status === "analyzing"
      ? { status: "error", message: "Analysis was interrupted by a page reload. Please reselect the file to continue." }
      : saved.documentAnalysis || { status: "idle", message: "" },
    documentChecks: toRestoredChecks(saved.documentChecks),
    fileErrors: saved.fileErrors || {},
    typeConfirmations: saved.typeConfirmations || {},
    suggestions: saved.suggestions || null,
    errorMsg: saved.errorMsg || "",
    status: saved.status === "error" ? "error" : "idle",
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    restoredAfterReload: true,
  };
  inMemoryDrafts.set(userId, restored);
  return restored;
}

export function clearSubmissionDraft(userId) {
  if (!userId) return;
  inMemoryDrafts.delete(userId);
  const storage = getSessionStorage();
  try {
    storage?.removeItem(storageKey(userId));
  } catch {
    // Clearing live memory still guarantees this component cannot restore it.
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

// Exported for tests that emulate a full page reload in a fresh module context.
export function resetSubmissionDraftMemory(userId) {
  inMemoryDrafts.delete(userId);
}
