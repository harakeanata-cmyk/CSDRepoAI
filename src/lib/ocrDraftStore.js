const DATABASE_NAME = "csdrepoai_ocr_drafts";
const STORE_NAME = "drafts";
const DATABASE_VERSION = 1;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open OCR draft storage."));
  });
}

export async function loadOcrDraft(userId) {
  if (!userId) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(userId);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not load OCR draft."));
    });
  } finally {
    database.close();
  }
}

export async function saveOcrDraft(userId, draft) {
  if (!userId) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ ...draft, userId, updatedAt: Date.now() });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save OCR draft."));
      transaction.onabort = () => reject(transaction.error || new Error("OCR draft save was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function clearOcrDraft(userId) {
  if (!userId) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(userId);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear OCR draft."));
      transaction.onabort = () => reject(transaction.error || new Error("Could not clear OCR draft."));
    });
  } finally {
    database.close();
  }
}
