import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RESEARCH_UPLOAD_SIZE_BYTES,
  validateResearchUploadFile,
  validateResearchUploadFiles,
} from "./researchUploadValidation.js";

const file = (name, type = "", size = 1024) => ({ name, type, size });

test("accepts expected extensions and matching or unspecified browser MIME types", () => {
  assert.equal(validateResearchUploadFile(file("paper.PDF", "application/pdf"), "manuscript"), null);
  assert.equal(validateResearchUploadFile(file("paper.docx", "application/octet-stream"), "manuscript"), null);
  assert.equal(validateResearchUploadFile(file("source.zip", "application/zip"), "sourceCode"), null);
});

test("rejects unsupported extensions and conflicting concrete MIME types", () => {
  assert.match(validateResearchUploadFile(file("run.exe"), "manuscript"), /Invalid manuscript file/);
  assert.match(validateResearchUploadFile(file("paper.pdf", "text/plain"), "ieee"), /Invalid file/);
  assert.match(validateResearchUploadFile(file("paper.docx"), "ieee"), /Invalid file/);
  assert.match(validateResearchUploadFile(file("paper.pdf"), "sourceCode"), /Invalid file/);
});

test("enforces the centralized 50 MB maximum before service uploads", () => {
  assert.match(validateResearchUploadFile(file("paper.pdf", "application/pdf", MAX_RESEARCH_UPLOAD_SIZE_BYTES + 1), "manuscript"), /50 MB/);
  assert.equal(validateResearchUploadFile(file("paper.pdf", "application/pdf", MAX_RESEARCH_UPLOAD_SIZE_BYTES), "manuscript"), null);
});

test("validates all populated slots before submission service work", () => {
  assert.throws(() => validateResearchUploadFiles({ manuscript: file("paper.pdf"), sourceCode: file("wrong.pdf") }), /Invalid file/);
});
