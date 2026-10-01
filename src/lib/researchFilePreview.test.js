import test from "node:test";
import assert from "node:assert/strict";
import { getResearchDownloadUrl, getResearchFileType, isResearchStorageUrl, normalizeResearchFileUrls } from "./researchFilePreview.js";

const storageUrl = "https://repo.supabase.co";

test("detects supported document and image formats from encoded paths and MIME types", () => {
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/a%20paper.PDF"), "pdf");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/manuscript%20%231.docx"), "docx");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/page.png"), "image");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/page.jpg"), "image");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/page.jpeg"), "image");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/page.webp"), "image");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/opaque-token", "application/pdf"), "pdf");
  assert.equal(getResearchFileType("https://repo.supabase.co/storage/v1/object/public/research-files/opaque-token", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
});

test("allows only public or signed research-files URLs from this Supabase project", () => {
  assert.equal(isResearchStorageUrl(`${storageUrl}/storage/v1/object/public/research-files/user/paper.pdf`, storageUrl), true);
  assert.equal(isResearchStorageUrl(`${storageUrl}/storage/v1/object/sign/research-files/user/paper.pdf?token=abc`, storageUrl), true);
  assert.equal(isResearchStorageUrl("https://attacker.example/paper.pdf", storageUrl), false);
  assert.equal(isResearchStorageUrl(`${storageUrl}/storage/v1/object/public/other-bucket/paper.pdf`, storageUrl), false);
  assert.equal(isResearchStorageUrl("not a URL", storageUrl), false);
});

test("preserves the original filename when creating a storage download URL", () => {
  const result = new URL(getResearchDownloadUrl(`${storageUrl}/storage/v1/object/public/research-files/A%20Paper%20%231.docx?token=abc`));
  assert.equal(result.searchParams.get("token"), "abc");
  assert.equal(result.searchParams.get("download"), "A Paper #1.docx");
});

test("normalizes legacy page URL arrays without changing their order and handles missing or malformed values", () => {
  const pages = ["page-1.png", "page-2.jpeg", "page-3.webp"];
  assert.deepEqual(normalizeResearchFileUrls(JSON.stringify(pages)), pages);
  assert.deepEqual(normalizeResearchFileUrls(pages), pages);
  assert.deepEqual(normalizeResearchFileUrls(null), []);
  assert.deepEqual(normalizeResearchFileUrls("broken-file-url"), ["broken-file-url"]);
});
