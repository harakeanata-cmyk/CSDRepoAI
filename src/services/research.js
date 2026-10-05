import { supabase } from "../lib/supabaseClient";
import { toGenkitEndpoint } from "../lib/genkitUrl.js";
import { notifyResearchDataChanged } from "../lib/researchEvents";
import { checkResearchDuplicate } from "./search";
import { createUniqueStorageToken } from "../lib/storagePath.js";
import { openResearchPreviewInNewTab } from "./paperPreview";
import { normalizeResearchFileUrls } from "../lib/researchFilePreview";
import { validateResearchUploadFiles } from "../lib/researchUploadValidation";
import { classifyResearchDocument, getDocumentTypeMismatchError } from "../lib/researchDocumentType";
import { readFileArrayBuffer, sha256Hex } from "../lib/readFileArrayBuffer.js";

function buildStoragePath(userId, file) {
  const originalName = file?.name || "upload";
  const lastDot = originalName.lastIndexOf(".");
  const extension = lastDot >= 0 ? originalName.slice(lastDot) : "";
  const baseName = lastDot >= 0 ? originalName.slice(0, lastDot) : originalName;

  const sanitizedBase = baseName
    .normalize("NFKD")
    .replace(/[^\u0000-\u007F]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();

  const sanitizedExtension = extension
    .normalize("NFKD")
    .replace(/[^\u0000-\u007F]/g, "")
    .replace(/[^a-zA-Z0-9.]+/g, "");

  const sanitizedName = `${sanitizedBase || "file"}${sanitizedExtension || ""}`.slice(0, 180) || `upload${sanitizedExtension || ""}`;

  return `${userId}/${createUniqueStorageToken()}_${sanitizedName}`;
}

function normalizeResearchText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeResearchKeywords(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeResearchText)
    .filter(Boolean)
    .sort();
}

function assertDocumentTypesMatch(documentTexts = {}) {
  for (const slot of ["manuscript", "ieee", "acm", "apa"]) {
    const documentText = String(documentTexts[slot] || "");
    if (!documentText.trim()) continue;
    const mismatchError = getDocumentTypeMismatchError(classifyResearchDocument(documentText), slot);
    if (mismatchError) throw new Error(mismatchError);
  }
}

async function getManuscriptSha256(file) {
  if (!file) return null;
  return sha256Hex(await readFileArrayBuffer(file));
}

async function getStoredManuscriptSha256(fileUrl) {
  const urls = getResearchFileUrls(fileUrl);
  if (!urls.length) return null;
  const hashes = [];
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not read the existing manuscript to check for duplicate files.");
    hashes.push(await getManuscriptSha256(await response.blob()));
  }
  if (hashes.length === 1) return hashes[0];
  return sha256Hex(new TextEncoder().encode(hashes.join("\n")));
}

async function assertManuscriptHashIsUnique(manuscriptSha256, excludePaperId = null) {
  if (!manuscriptSha256) return null;
  let query = supabase
    .from("research_papers")
    .select("id")
    .eq("manuscript_sha256", manuscriptSha256)
    .eq("is_active", true)
    .not("status", "in", "(rejected,student_editing,withdrawn)");
  if (excludePaperId) query = query.neq("id", excludePaperId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      throw new Error("The database needs the manuscript duplicate protection migration. Apply supabase/migrations/20260926000300_enforce_manuscript_file_uniqueness.sql in Supabase SQL Editor.");
    }
    throw error;
  }
  if (data) {
    throw new Error("This manuscript file has already been submitted. If it is your submission, open My Submissions and choose Clear submission before trying again. Contact your adviser if the existing record belongs to someone else.");
  }

  return manuscriptSha256;
}

async function assertManuscriptFileIsUnique(file, excludePaperId = null) {
  return assertManuscriptHashIsUnique(await getManuscriptSha256(file), excludePaperId);
}

/** Research Submission Module: student submits a new paper + files */
export async function submitResearch({
  title,
  abstract,
  authors,
  adviser,
  academicYear,
  semester,
  program,
  keywords,
  sdgTags,
  category,
  manuscriptFile,
  manuscriptText,
  documentTexts = {},
  manuscriptSource = "digital",
  sourceCodeFile,
  ieeeFile,
  acmFile,
  apaFile,
  userId,
}) {
  validateResearchUploadFiles({
    manuscript: manuscriptFile,
    sourceCode: sourceCodeFile,
    ieee: ieeeFile,
    acm: acmFile,
    apa: apaFile,
  });
  assertDocumentTypesMatch({ ...documentTexts, manuscript: manuscriptText || documentTexts.manuscript });

  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (!normalizedTitle) throw new Error("Research title is required.");
  const manuscriptSha256 = await assertManuscriptFileIsUnique(manuscriptFile);

  // Match title candidates even when imports contain repeated spaces or line
  // breaks, then block only when all three identifying fields are the same.
  const titlePattern = normalizedTitle
    .split(" ")
    .map((word) => word.replace(/[\\%_]/g, "\\$&"))
    .join("%");

  const { data: existingTitle, error: titleCheckError } = await supabase
    .from("research_papers")
    .select("id, title, abstract, keywords, status, is_active")
    .ilike("title", titlePattern)
    .limit(500);

  if (titleCheckError) throw titleCheckError;
  const normalizedAbstract = normalizeResearchText(abstract);
  const normalizedKeywords = normalizeResearchKeywords(keywords);
  const duplicatePaper = (existingTitle || []).find((paper) => {
    // Deactivated archive entries no longer block a fresh submission.
    if (paper.is_active === false) return false;
    // A rejected submission is no longer an active duplicate. Students must
    // be able to correct and upload that work again for review.
    if (normalizeResearchText(paper.status) === "rejected") return false;
    const sameTitle = normalizeResearchText(paper.title) === normalizeResearchText(normalizedTitle);
    const sameAbstract = normalizeResearchText(paper.abstract) === normalizedAbstract;
    const paperKeywords = normalizeResearchKeywords(paper.keywords);
    const sameKeywords = paperKeywords.length === normalizedKeywords.length
      && paperKeywords.every((keyword, index) => keyword === normalizedKeywords[index]);
    return sameTitle && sameAbstract && sameKeywords;
  });
  if (duplicatePaper) {
    if (ieeeFile && !manuscriptFile) {
      const { data: ownedPaper, error: ownedPaperError } = await supabase
        .from("research_papers")
        .select("id")
        .eq("id", duplicatePaper.id)
        .eq("submitted_by", userId)
        .maybeSingle();

      if (ownedPaperError) throw ownedPaperError;
      if (ownedPaper) {
        const ieeeUrl = await uploadResearchAttachment(userId, ieeeFile);
        const { data: attachedPaper, error: attachError } = await supabase
          .from("research_papers")
          .update({ ieee_paper_url: ieeeUrl })
          .eq("id", ownedPaper.id)
          .select()
          .single();

        if (attachError) throw attachError;

        await supabase.from("submission_logs").insert({
          paper_id: attachedPaper.id,
          action: "attachment_added",
          actor_id: userId,
          detail: { attachment: "ieee_paper_url" },
        });

        return attachedPaper;
      }
    }
    throw new Error("A research paper with the same title, abstract, and keywords already exists.");
  }

  const uploads = {};

  for (const [key, file] of Object.entries({
    file_url: manuscriptFile,
    source_code_url: sourceCodeFile,
    ieee_paper_url: ieeeFile,
    acm_paper_url: acmFile,
    apa_paper_url: apaFile,
  })) {
    if (!file) continue;
    const path = buildStoragePath(userId, file);
    const { error: uploadError } = await supabase.storage
      .from("research-files")
      .upload(path, file);
    if (uploadError) throw uploadError;
    const { data: pub } = supabase.storage.from("research-files").getPublicUrl(path);
    uploads[key] = pub.publicUrl;
  }

  const { data, error } = await supabase
    .from("research_papers")
    .insert({
      title: normalizedTitle,
      abstract,
      authors,
      adviser,
      academic_year: academicYear,
      semester,
      program,
      keywords,
      sdg_tags: sdgTags,
      source: manuscriptSource === "ocr_scanned" ? "ocr_scanned" : "digital",
      ocr_raw_text: manuscriptText || null,
      manuscript_sha256: manuscriptSha256,
      submitted_by: userId,
      status: "pending",
      ...uploads,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      if (error.constraint === "idx_research_active_manuscript_sha256") {
        throw new Error("This manuscript file has already been submitted. If it is your submission, open My Submissions and choose Clear submission before trying again. Contact your adviser if the existing record belongs to someone else.");
      }
      if (error.constraint === "idx_research_unique_normalized_title") {
        throw new Error("Another non-rejected paper already uses this title. Review the existing paper or choose a distinct title.");
      }
      throw error;
    }
    throw error;
  }

  notifyResearchDataChanged();

  await supabase.from("submission_logs").insert({
    paper_id: data.id,
    action: "submitted",
    actor_id: userId,
    detail: { category, metadata_source: "ai_assisted_document_analysis" },
  });

  await triggerEmbedding(data.id);

  return data;
}

export async function updateResearchSubmission({
  paper,
  title,
  abstract,
  authors,
  adviser,
  academicYear,
  semester,
  program,
  keywords,
  sdgTags,
  files = {},
  manuscriptText = "",
  documentTexts = {},
  userId,
}) {
  if (!paper || paper.status !== "student_editing") {
    throw new Error("Mark this submission for editing before saving changes.");
  }

  const normalizedTitle = String(title || "").trim().replace(/\s+/g, " ");
  if (!normalizedTitle) throw new Error("Research title is required.");
  validateResearchUploadFiles(files);
  assertDocumentTypesMatch({ ...documentTexts, manuscript: manuscriptText || documentTexts.manuscript });
  const manuscriptSha256 = files.manuscript
    ? await assertManuscriptFileIsUnique(files.manuscript, paper.id)
    : paper.manuscript_sha256 || await getStoredManuscriptSha256(paper.file_url);
  if (manuscriptSha256 && !files.manuscript) {
    await assertManuscriptHashIsUnique(manuscriptSha256, paper.id);
  }

  const updates = {
    abstract,
    authors,
    adviser,
    academic_year: academicYear,
    semester,
    program,
    keywords,
    sdg_tags: sdgTags,
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  // Do not rewrite an unchanged title. The legacy normalized-title unique
  // index can reject an otherwise valid correction when duplicate historical
  // records already exist, even though this edit is changing other fields.
  if (normalizeResearchText(paper.title) !== normalizeResearchText(normalizedTitle)) {
    updates.title = normalizedTitle;
  }
  if (manuscriptSha256) updates.manuscript_sha256 = manuscriptSha256;
  const fileColumns = {
    manuscript: "file_url",
    sourceCode: "source_code_url",
    ieee: "ieee_paper_url",
    acm: "acm_paper_url",
    apa: "apa_paper_url",
  };
  const uploadedUrls = [];
  let updatedPaper;

  if (files.manuscript) updates.ocr_raw_text = manuscriptText || null;
  if (manuscriptSha256 && manuscriptSha256 !== paper.manuscript_sha256) {
    updates.manuscript_sha256 = manuscriptSha256;
  }

  try {
    for (const [key, file] of Object.entries(files)) {
      if (!file || !fileColumns[key]) continue;
      const url = await uploadResearchAttachment(userId, file);
      uploadedUrls.push(url);
      updates[fileColumns[key]] = url;
    }

    const { data, error } = await supabase
      .from("research_papers")
      .update(updates)
      .eq("id", paper.id)
      .eq("submitted_by", userId)
      .eq("status", "student_editing")
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("This submission is no longer marked for editing. Refresh and try again.");
    updatedPaper = data;
  } catch (error) {
    await removeResearchStorageFiles(uploadedUrls);
    if (error.code === "23505" && error.constraint === "idx_research_active_manuscript_sha256") {
      throw new Error("This manuscript file has already been submitted. Edit the existing rejected paper instead of uploading another copy.");
    }
    if (error.code === "23505" && error.constraint === "idx_research_unique_normalized_title") {
      throw new Error("Another non-rejected paper already uses this title. Keep this paper's current title or choose a distinct title.");
    }
    throw error;
  }

  notifyResearchDataChanged();

  const replacedUrls = Object.entries(files)
    .filter(([key, file]) => file && fileColumns[key])
    .map(([key]) => paper[fileColumns[key]])
    .filter(Boolean);
  await removeResearchStorageFiles(replacedUrls);
  await triggerEmbedding(updatedPaper.id);

  return updatedPaper;
}

async function uploadResearchAttachment(userId, file) {
  const path = buildStoragePath(userId, file);
  const { error: uploadError } = await supabase.storage
    .from("research-files")
    .upload(path, file);
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from("research-files").getPublicUrl(path);
  return pub.publicUrl;
}

async function removeResearchStorageFiles(urls) {
  const storagePaths = urls
    .flatMap(getResearchFileUrls)
    .map(getResearchStoragePath)
    .filter(Boolean);
  if (!storagePaths.length) return;

  const { error } = await supabase.storage.from("research-files").remove(storagePaths);
  if (error) console.warn("Could not clean up replaced research files:", error);
}

/** Fire-and-forget: asks the Genkit server to embed a paper for semantic
 *  search. Never blocks or fails the submission flow — if the Genkit
 *  server isn't configured/running, keyword search still works fine,
 *  and `npm run reindex` in genkit-server can backfill it later. */
function getEmbeddingEndpoint() {
  return toGenkitEndpoint(
    import.meta.env.VITE_GENKIT_EMBED_URL || import.meta.env.VITE_GENKIT_SEARCH_URL,
    "embed",
  );
}

async function triggerEmbedding(paperId) {
  const embedUrl = getEmbeddingEndpoint();
  if (!embedUrl) {
    console.warn("Genkit embedding URL is not configured; the paper will need reindexing.");
    return false;
  }

  try {
    const response = await fetch(embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId }),
    });
    if (!response.ok) throw new Error(`Embedding request failed with status ${response.status}`);
    return true;
  } catch (error) {
    console.warn("Genkit embedding request failed (non-fatal):", error);
    return false;
  }
}

let approvedEmbeddingBackfill = null;

/** Embeds approved archive records that predate automatic indexing or whose
 *  earlier embedding request failed. Safe to call whenever the archive opens. */
export function ensureApprovedResearchEmbeddings() {
  if (approvedEmbeddingBackfill) return approvedEmbeddingBackfill;

  approvedEmbeddingBackfill = (async () => {
    if (!getEmbeddingEndpoint()) {
      console.warn("Genkit embedding URL is not configured; approved archive papers cannot be embedded yet.");
      return { embedded: 0, failed: 0 };
    }

    const [unembeddedResult, unhashedResult] = await Promise.all([
      supabase
        .from("research_papers")
        .select("id")
        .eq("status", "approved")
        .is("embedding", null)
        .limit(1000),
      supabase
        .from("research_papers")
        .select("id")
        .eq("status", "approved")
        .is("manuscript_sha256", null)
        .not("file_url", "is", null)
        .limit(1000),
    ]);

    if (unembeddedResult.error || unhashedResult.error) {
      const error = unembeddedResult.error || unhashedResult.error;
      if (error.code === "42703" || error.code === "PGRST204") {
        throw new Error("Apply supabase/migrations/20260926000300_enforce_manuscript_file_uniqueness.sql to enable file duplicate checks.");
      }
      throw error;
    }
    const papers = [...new Set([
      ...(unembeddedResult.data || []).map((paper) => paper.id),
      ...(unhashedResult.data || []).map((paper) => paper.id),
    ])];
    let embedded = 0;
    let failed = 0;

    for (let index = 0; index < papers.length; index += 3) {
      const results = await Promise.all(papers.slice(index, index + 3).map(triggerEmbedding));
      embedded += results.filter(Boolean).length;
      failed += results.filter((result) => !result).length;
    }

    return { embedded, failed };
  })().finally(() => {
    approvedEmbeddingBackfill = null;
  });

  return approvedEmbeddingBackfill;
}

/** Research Submission Module: student's own submission history + status */
export async function getMySubmissions(userId) {
  const { data, error } = await supabase
    .from("research_papers")
    .select("*")
    .eq("submitted_by", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data?.length) return data || [];

  const paperIds = data.map((paper) => paper.id);
  const { data: activity, error: activityError } = await supabase
    .from("submission_logs")
    .select("id, paper_id, actor_id, action, detail, created_at")
    .in("paper_id", paperIds)
    .order("created_at", { ascending: false });
  if (activityError) throw activityError;

  const reviewActivity = (activity || []).filter((entry) => (
    ["student_withdrew", "student_restored"].includes(entry.action)
      ? true
      : entry.action === "status_changed" && ["approved", "rejected", "under_review"].includes(entry.detail?.status)
  ));
  const accountIds = [...new Set([
    ...data.map((paper) => paper.reviewed_by),
    ...reviewActivity.map((entry) => entry.actor_id),
  ].filter(Boolean))];
  const accountById = new Map();

  if (accountIds.length) {
    const { data: accounts, error: accountsError } = await supabase
      .from("profiles")
      .select("id, full_name, role, faculty_number")
      .in("id", accountIds);
    if (accountsError) throw accountsError;
    for (const account of accounts || []) accountById.set(account.id, account);
  }

  const activityByPaperId = new Map();
  for (const entry of reviewActivity) {
    const entries = activityByPaperId.get(entry.paper_id) || [];
    entries.push({
      id: entry.id,
      status: entry.action === "student_withdrew"
        ? "withdrawn"
        : entry.action === "student_restored"
          ? "restored"
          : entry.detail.status,
      created_at: entry.created_at,
      actor: accountById.get(entry.actor_id) || null,
    });
    activityByPaperId.set(entry.paper_id, entries);
  }

  return data.map((paper) => {
    const history = activityByPaperId.get(paper.id) || [];
    const currentReviewStatuses = ["approved", "rejected", "under_review"];
    const currentStatusLogged = history.some((entry) => entry.status === paper.status);
    if (currentReviewStatuses.includes(paper.status) && !currentStatusLogged) {
      history.unshift({
        id: `current-${paper.id}`,
        status: paper.status,
        created_at: paper.reviewed_at,
        actor: accountById.get(paper.reviewed_by) || null,
      });
    }

    return {
      ...paper,
      reviewActivity: history,
    };
  });
}

export async function beginResearchEditing({ paperId, userId }) {
  const { data, error } = await supabase
    .from("research_papers")
    .update({ status: "student_editing", updated_at: new Date().toISOString() })
    .eq("id", paperId)
    .eq("submitted_by", userId)
    .in("status", ["pending", "under_review", "rejected", "student_editing"])
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "23514" && error.message?.includes("research_papers_status_check")) {
      throw new Error("The database needs the student editing status migration. Apply supabase/migrations/20260926000100_allow_student_editing_status.sql in the Supabase SQL Editor, then try again.");
    }
    throw error;
  }
  if (!data) throw new Error("This submission is approved or is no longer available for editing.");
  notifyResearchDataChanged();
  return data;
}

export async function cancelResearchEditing({ paperId, userId }) {
  const { data, error } = await supabase
    .from("research_papers")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", paperId)
    .eq("submitted_by", userId)
    .eq("status", "student_editing")
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("This submission is no longer marked for editing.");
  notifyResearchDataChanged();
  return data;
}

/** Withdraw a student's own unapproved submission while preserving its history. */
export async function withdrawResearchSubmission({ paperId }) {
  const { error } = await supabase.rpc("withdraw_my_research_submission", {
    p_paper_id: paperId,
  });
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      throw new Error("Submission clearing is not enabled in the database yet. Apply the latest Supabase migration, then try again.");
    }
    throw error;
  }
  notifyResearchDataChanged();
}

/** Restore a student's own submission from the recycle bin. */
export async function restoreWithdrawnResearchSubmission({ paperId }) {
  const { data, error } = await supabase.rpc("restore_my_withdrawn_research_submission", {
    p_paper_id: paperId,
  });
  if (error) throw error;
  notifyResearchDataChanged();
  return data;
}

/** Permanently remove a withdrawn submission and its stored research files. */
export async function permanentlyDeleteWithdrawnResearchSubmission({ paper }) {
  const fileFields = ["file_url", "source_code_url", "ieee_paper_url", "acm_paper_url", "apa_paper_url"];
  const storagePaths = [...new Set(fileFields
    .flatMap((field) => getResearchFileUrls(paper?.[field]))
    .map(getResearchStoragePath)
    .filter(Boolean))];

  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage.from("research-files").remove(storagePaths);
    if (storageError) {
      throw new Error(`Could not remove the submission files, so the submission was kept in the recycle bin. ${storageError.message}`);
    }
  }

  const { error } = await supabase.rpc("permanently_delete_my_withdrawn_research_submission", {
    p_paper_id: paper.id,
  });
  if (error) throw error;
  notifyResearchDataChanged();
}

/** Research Archive Module: browse approved papers */
export async function getApprovedPapers({ limit = 50, includeDeactivated = false } = {}) {
  const buildRequest = (filterActive) => {
    let request = supabase
      .from("research_papers")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filterActive && !includeDeactivated) request = request.eq("is_active", true);
    return request;
  };
  let { data, error } = await buildRequest(true);
  if (error && !includeDeactivated && isMissingResearchActiveColumn(error)) {
    ({ data, error } = await buildRequest(false));
  }
  if (error) throw error;
  return data;
}

function isMissingResearchActiveColumn(error) {
  return error?.code === "42703" || error?.code === "PGRST204" || /is_active.*(column|schema cache)|column.*is_active/i.test(error?.message || "");
}

function researchActivationMigrationError(error) {
  if (isMissingResearchActiveColumn(error)) {
    return new Error("Apply supabase/migrations/20261002000300_preserve_research_papers.sql in Supabase before changing a research record's active status.");
  }
  return error;
}

/** Admin archive view: include the accounts that submitted and approved each paper. */
export async function getApprovedPapersWithAccounts({ limit = 1000, includeDeactivated = false } = {}) {
  const papers = await getApprovedPapers({ limit, includeDeactivated });
  if (!papers.length) return papers;

  const accountIds = [...new Set(papers.flatMap((paper) => [paper.submitted_by, paper.reviewed_by]).filter(Boolean))];
  const { data: accounts, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, student_number, faculty_number")
    .in("id", accountIds);

  if (error) throw error;

  const accountById = new Map((accounts || []).map((account) => [account.id, account]));
  return papers.map((paper) => ({
    ...paper,
    submitterAccount: accountById.get(paper.submitted_by) || null,
    approverAccount: accountById.get(paper.reviewed_by) || null,
  }));
}

export async function deactivateResearchPaper(paper) {
  const { data, error } = await supabase
    .from("research_papers")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", paper.id)
    .eq("is_active", true)
    .select("id");
  if (error) throw researchActivationMigrationError(error);
  if (!data?.length) {
    throw new Error("The research record could not be deactivated. Refresh the archive and try again.");
  }
  notifyResearchDataChanged();
}

export async function reactivateResearchPaper(paper) {
  const { data, error } = await supabase.from("research_papers")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", paper.id)
    .eq("is_active", false)
    .select("id");
  if (error) throw researchActivationMigrationError(error);
  if (!data?.length) throw new Error("The research record could not be reactivated. Refresh the archive and try again.");
  notifyResearchDataChanged();
}

export function getResearchFileUrls(fileUrl) {
  return normalizeResearchFileUrls(fileUrl);
}

function getResearchStoragePath(url) {
  const marker = "/storage/v1/object/public/research-files/";
  const markerIndex = url.indexOf(marker);
  return markerIndex >= 0 ? decodeURIComponent(url.slice(markerIndex + marker.length)) : null;
}

export async function openResearchFile(paper, field = "file_url", label = "manuscript") {
  const urls = getResearchFileUrls(paper?.[field]);
  if (!urls.length) throw new Error(`No ${label} file is available to preview.`);
  await openResearchPreviewInNewTab({ urls, title: paper.title, label, paperId: paper.id });
  if (paper.id) incrementViewCount(paper.id);
}

export function recordResearchDownload(paperId) {
  if (paperId) incrementDownloadCount(paperId);
}

/** Submission Review and Approval Module: pending queue for admin */
export async function getPendingSubmissions() {
  const { data, error } = await supabase
    .from("research_papers")
    .select("*, profiles:submitted_by(full_name, student_number)")
    .in("status", ["pending", "under_review", "student_editing"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getAuditTrail({ limit = 10 } = {}) {
  const { data, error } = await supabase
    .from("public_notifications")
    .select("id, paper_id, notification_type, actor_id, created_at, paper:paper_id!inner(title, status, is_active), actor:actor_id(full_name)")
    .eq("paper.status", "approved")
    .eq("paper.is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((entry) => ({
    ...entry,
    action: entry.notification_type,
    paperTitle: entry.paper?.title || "Unknown paper",
    actorName: entry.actor?.full_name || "System",
  }));
}

/** Research Analytics Module: best-effort view/download tracking.
 *  Never blocks the UI — if it fails, we just don't count that one. */
export async function incrementViewCount(paperId) {
  const { error } = await supabase.rpc("increment_view_count", { p_paper_id: paperId });
  if (error) console.error("Failed to record view:", error.message);
}

export async function incrementDownloadCount(paperId) {
  const { error } = await supabase.rpc("increment_download_count", { p_paper_id: paperId });
  if (error) console.error("Failed to record download:", error.message);
}
export async function reviewSubmission({ paperId, status, notes, reviewerId }) {
  if (status === "approved") {
    const { data: paper, error: paperError } = await supabase
      .from("research_papers")
      .select("abstract, keywords, ocr_raw_text")
      .eq("id", paperId)
      .maybeSingle();
    if (paperError) throw paperError;
    if (!paper) throw new Error("This research paper is no longer available for review.");

    await checkResearchDuplicate({
      title: paper.title,
      abstract: paper.abstract,
      keywords: paper.keywords || [],
      documentText: paper.ocr_raw_text || "",
      excludePaperId: paperId,
    });
  }

  const { data, error } = await supabase
    .from("research_papers")
    .update({
      status,
      review_notes: notes,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", paperId)
    .in("status", ["pending", "under_review"])
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This submission is currently being edited by its student or is no longer awaiting review.");

  notifyResearchDataChanged();

  await supabase.from("submission_logs").insert({
    paper_id: paperId,
    action: "status_changed",
    actor_id: reviewerId,
    detail: { status, notes },
  });

  if (status === "approved") await triggerEmbedding(paperId);

  return data;
}
