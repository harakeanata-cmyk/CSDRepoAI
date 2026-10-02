import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearSubmissionDraft,
  analyzeSubmissionFileOnce,
  loadSubmissionDraft,
  resetSubmissionDraftMemory,
  saveSubmissionDraft,
} from "./submissionDraftStore.js";

const records = new Map();
const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

function requestFor(run) {
  const request = {};
  setTimeout(() => {
    try {
      request.result = run();
      request.onsuccess?.();
    } catch (error) {
      request.error = error;
      request.onerror?.();
    }
  }, 0);
  return request;
}

const indexedDBMock = {
  open() {
    const request = {};
    const names = { contains: (name) => name === "drafts" };
    const database = {
      objectStoreNames: names,
      createObjectStore() {},
      close() {},
      transaction() {
        const transaction = {};
        transaction.objectStore = () => ({
          get: (key) => requestFor(() => structuredClone(records.get(key))),
          put: (record) => {
            records.set(record.userId, structuredClone(record));
            setTimeout(() => transaction.oncomplete?.(), 0);
          },
          delete: (key) => {
            records.delete(key);
            setTimeout(() => transaction.oncomplete?.(), 0);
          },
        });
        transaction.abort = () => setTimeout(() => transaction.onabort?.(), 0);
        return transaction;
      },
    };
    setTimeout(() => {
      request.result = database;
      request.onsuccess?.();
    }, 0);
    return request;
  },
};

beforeEach(() => {
  records.clear();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDBMock });
});

afterEach(() => {
  if (originalIndexedDB) Object.defineProperty(globalThis, "indexedDB", originalIndexedDB);
  else delete globalThis.indexedDB;
});

test("persists and restores actual File bytes and the submission draft after a reload", async () => {
  const selectedFile = new File(["private file bytes"], "paper.pdf", { type: "application/pdf", lastModified: 1234 });
  const manuscriptText = "PRIVATE EXTRACTED MANUSCRIPT BODY";
  await saveSubmissionDraft("student-a", {
    form: { title: "Study title", abstract: "Study abstract", keywords: "research" },
    files: { manuscript: selectedFile },
    detachedFiles: {},
    manuscriptText,
    documentChecks: { manuscript: { type: "Full Research Manuscript", confidence: 0.94, status: "done" } },
  }, 1000);

  resetSubmissionDraftMemory("student-a");
  const restored = await loadSubmissionDraft("student-a");
  assert.equal(restored.form.title, "Study title");
  assert.equal(restored.files.manuscript.name, "paper.pdf");
  assert.equal(restored.files.manuscript.type, "application/pdf");
  assert.equal(await restored.files.manuscript.text(), "private file bytes");
  assert.equal(restored.manuscriptText, manuscriptText);
  assert.equal(restored.documentChecks.manuscript.confidence, 0.94);
  assert.equal(restored.restoredAfterReload, true);
});

test("stores each upload slot's actual file independently", async () => {
  const slotFiles = {
    manuscript: new File(["manuscript"], "main.pdf", { type: "application/pdf" }),
    sourceCode: new File(["source"], "source.zip", { type: "application/zip" }),
    ieee: new File(["ieee"], "ieee.pdf", { type: "application/pdf" }),
    acm: new File(["acm"], "acm.pdf", { type: "application/pdf" }),
    apa: new File(["apa"], "apa.pdf", { type: "application/pdf" }),
  };
  await saveSubmissionDraft("student-attachments", { form: {}, files: slotFiles }, 2000);
  resetSubmissionDraftMemory("student-attachments");
  const restored = await loadSubmissionDraft("student-attachments");
  assert.deepEqual(Object.fromEntries(Object.entries(restored.files).map(([slot, file]) => [slot, file?.name])), {
    manuscript: "main.pdf", sourceCode: "source.zip", ieee: "ieee.pdf", acm: "acm.pdf", apa: "apa.pdf",
  });
  assert.equal(await restored.files.sourceCode.text(), "source");
});

test("drafts are isolated by authenticated user ID", async () => {
  await saveSubmissionDraft("student-a", { form: { title: "Private title" }, files: {} }, 3000);
  assert.equal(await loadSubmissionDraft("student-b"), null);
  assert.equal((await loadSubmissionDraft("student-a")).form.title, "Private title");
});

test("replacement and removal are persisted without reviving the previous file", async () => {
  const firstSave = await saveSubmissionDraft("student-file", {
    form: {}, files: { manuscript: new File(["old"], "old.pdf") },
  }, 4000);
  const secondSave = await saveSubmissionDraft("student-file", {
    form: {}, files: { manuscript: new File(["new"], "new.pdf") },
  }, 4001, firstSave.revision);
  assert.equal(secondSave.saved, true);
  resetSubmissionDraftMemory("student-file");
  assert.equal((await loadSubmissionDraft("student-file")).files.manuscript.name, "new.pdf");

  const removalSave = await saveSubmissionDraft("student-file", { form: {}, files: { manuscript: null } }, 4002, secondSave.revision);
  assert.equal(removalSave.saved, true);
  resetSubmissionDraftMemory("student-file");
  assert.equal((await loadSubmissionDraft("student-file")).files.manuscript, null);
});

test("a stale tab revision cannot overwrite a newer draft", async () => {
  const firstTab = await saveSubmissionDraft("student-tabs", { form: { title: "First" }, files: {} }, 5000);
  const secondTab = await saveSubmissionDraft("student-tabs", { form: { title: "Stale edit" }, files: {} }, 5001, null);
  assert.equal(secondTab.conflict, true);
  resetSubmissionDraftMemory("student-tabs");
  assert.equal((await loadSubmissionDraft("student-tabs")).form.title, "First");
  assert.ok(firstTab.revision);
});

test("does not silently expire an old unfinished draft", async () => {
  await saveSubmissionDraft("student-old", { form: { title: "Still mine" }, files: {} }, 1);
  resetSubmissionDraftMemory("student-old");
  assert.equal((await loadSubmissionDraft("student-old")).form.title, "Still mine");
});

test("clears the local draft on explicit discard or successful submission", async () => {
  await saveSubmissionDraft("student-clear", { form: { title: "Draft" }, files: {} });
  await clearSubmissionDraft("student-clear");
  assert.equal(await loadSubmissionDraft("student-clear"), null);
});

test("shares one in-flight or completed analysis for the same live File object", async () => {
  const selectedFile = new File(["bytes"], "paper.pdf", { type: "application/pdf" });
  let calls = 0;
  const analyzer = async () => { calls += 1; return { type: "Full Research Manuscript" }; };
  const [first, second] = await Promise.all([
    analyzeSubmissionFileOnce(selectedFile, analyzer),
    analyzeSubmissionFileOnce(selectedFile, analyzer),
  ]);
  const third = await analyzeSubmissionFileOnce(selectedFile, analyzer);
  assert.equal(first, second);
  assert.equal(third, first);
  assert.equal(calls, 1);
});
