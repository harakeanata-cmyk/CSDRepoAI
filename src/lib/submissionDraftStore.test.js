import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearSubmissionDraft,
  analyzeSubmissionFileOnce,
  loadSubmissionDraft,
  resetSubmissionDraftMemory,
  saveSubmissionDraft,
  SUBMISSION_DRAFT_TTL_MS,
} from "./submissionDraftStore.js";

const storageValues = new Map();
const sessionStorageMock = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: (key) => storageValues.delete(key),
};
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

beforeEach(() => {
  storageValues.clear();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: sessionStorageMock });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else delete globalThis.sessionStorage;
});

test("keeps actual files in tab memory and stores only file metadata in sessionStorage", () => {
  const selectedFile = new File(["private file bytes"], "paper.pdf", { type: "application/pdf" });
  const draft = {
    form: { title: "Study title", abstract: "Study abstract", keywords: "research" },
    files: { manuscript: selectedFile },
    detachedFiles: {},
    manuscriptText: "PRIVATE EXTRACTED MANUSCRIPT BODY",
    documentChecks: { manuscript: { type: "Full Research Manuscript", confidence: 0.94, status: "done" } },
  };
  saveSubmissionDraft("student-a", draft, 1000);

  assert.equal(loadSubmissionDraft("student-a", 1001).files.manuscript, selectedFile);
  const stored = storageValues.get("csdrepoai_submission_draft_v1_student-a");
  assert.match(stored, /paper\.pdf/);
  assert.doesNotMatch(stored, /PRIVATE EXTRACTED MANUSCRIPT BODY|private file bytes/);
});

test("reload restores form and validation metadata but asks for the actual file again", () => {
  const selectedFile = new File(["bytes"], "paper.pdf", { type: "application/pdf" });
  saveSubmissionDraft("student-b", {
    form: { title: "Saved title" },
    files: { manuscript: selectedFile },
    detachedFiles: {},
    manuscriptText: "not persisted",
    documentChecks: { manuscript: { type: "Full Research Manuscript", confidence: 0.94, status: "done" } },
  }, 2000);

  resetSubmissionDraftMemory("student-b");
  const restored = loadSubmissionDraft("student-b", 2001);
  assert.equal(restored.form.title, "Saved title");
  assert.equal(restored.files.manuscript, null);
  assert.equal(restored.detachedFiles.manuscript.name, "paper.pdf");
  assert.equal(restored.documentChecks.manuscript.type, "Full Research Manuscript");
  assert.equal(restored.manuscriptText, "");
  assert.equal(restored.restoredAfterReload, true);
});

test("keeps multiple attachment slots associated with their own files", () => {
  const slotFiles = {
    manuscript: new File(["manuscript"], "main.pdf", { type: "application/pdf" }),
    sourceCode: new File(["source"], "source.zip", { type: "application/zip" }),
    ieee: new File(["ieee"], "ieee.pdf", { type: "application/pdf" }),
    acm: new File(["acm"], "acm.pdf", { type: "application/pdf" }),
    apa: new File(["apa"], "apa.pdf", { type: "application/pdf" }),
  };
  saveSubmissionDraft("student-attachments", { form: {}, files: slotFiles, detachedFiles: {} }, 3000);
  assert.deepEqual(loadSubmissionDraft("student-attachments", 3001).files, slotFiles);
});

test("drafts are isolated by user and expire after seven inactive days", () => {
  saveSubmissionDraft("student-c", { form: { title: "Private title" }, files: {}, detachedFiles: {} }, 5000);
  assert.equal(loadSubmissionDraft("student-d", 5001), null);
  resetSubmissionDraftMemory("student-c");
  assert.equal(loadSubmissionDraft("student-c", 5000 + SUBMISSION_DRAFT_TTL_MS + 1), null);
  assert.equal(storageValues.has("csdrepoai_submission_draft_v1_student-c"), false);
});

test("clearing the draft removes memory and session data", () => {
  saveSubmissionDraft("student-e", { form: { title: "Draft" }, files: {}, detachedFiles: {} }, 9000);
  clearSubmissionDraft("student-e");
  assert.equal(loadSubmissionDraft("student-e", 9001), null);
  assert.equal(storageValues.has("csdrepoai_submission_draft_v1_student-e"), false);
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
