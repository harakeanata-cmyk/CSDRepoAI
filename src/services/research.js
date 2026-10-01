import { supabase } from "../lib/supabaseClient";
import { toGenkitEndpoint } from "../lib/genkitUrl.js";
import { notifyResearchDataChanged } from "../lib/researchEvents";
import { checkResearchDuplicate } from "./search";
import { createUniqueStorageToken } from "../lib/storagePath.js";
import { openResearchPreviewInNewTab } from "./paperPreview";
import { normalizeResearchFileUrls } from "../lib/researchFilePreview";

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

async function getManuscriptSha256(file) {
  if (!file) return null;
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify manuscript file duplicates. Use a current browser over HTTPS.");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashes.join("\n")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertManuscriptHashIsUnique(manuscriptSha256, excludePaperId = null) {
  if (!manuscriptSha256) return null;
  let query = supabase
    .from("research_papers")
    .select("id")
    .eq("manuscript_sha256", manuscriptSha256)
    .neq("status", "rejected");
  if (excludePaperId) query = query.neq("id", excludePaperId);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      throw new Error("The database needs the manuscript duplicate protection migration. Apply supabase/migrations/20260926000300_enforce_manuscript_file_uniqueness.sql in Supabase SQL Editor.");
    }
    throw error;
  }
  if (data) {
    throw new Error("This manuscript file has already been submitted. Edit the existing rejected paper instead of uploading another copy.");
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
  sourceCodeFile,
  ieeeFile,
  acmFile,
  apaFile,
  userId,
}) {
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
    .select("id, title, abstract, keywords, status")
    .ilike("title", titlePattern)
    .limit(500);

  if (titleCheckError) throw titleCheckError;
  const normalizedAbstract = normalizeResearchText(abstract);
  const normalizedKeywords = normalizeResearchKeywords(keywords);
  const duplicatePaper = (existingTitle || []).find((paper) => {
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
        throw new Error("This manuscript file has already been submitted. Edit the existing rejected paper instead of uploading another copy.");
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
  userId,
}) {
  if (!paper || paper.status !== "student_editing") {
    throw new Error("Mark this submission for editing before saving changes.");
  }

  const normalizedTitle = String(title || "").trim().replace(/\s+/g, " ");
  if (!normalizedTitle) throw new Error("Research title is required.");
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
  return data;
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

/** Research Archive Module: browse approved papers */
export async function getApprovedPapers({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("research_papers")
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Admin archive view: include the accounts that submitted and approved each paper. */
export async function getApprovedPapersWithAccounts({ limit = 50 } = {}) {
  const papers = await getApprovedPapers({ limit });
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

export async function deleteResearchPaper(paper) {
  const fileUrls = [paper.file_url, paper.source_code_url, paper.ieee_paper_url, paper.acm_paper_url, paper.apa_paper_url]
    .flatMap(getResearchFileUrls);
  const storagePaths = fileUrls
    .map((url) => getResearchStoragePath(url))
    .filter(Boolean);

  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from("research-files").remove(storagePaths);
    if (storageError) throw storageError;
  }

  const { data: deletedRows, error } = await supabase
    .from("research_papers")
    .delete()
    .eq("id", paper.id)
    .select("id");
  if (error) throw error;
  if (!deletedRows?.length) {
    throw new Error("The research record could not be deleted. Refresh the archive and try again.");
  }

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
    .from("submission_logs")
    .select("*, paper:paper_id(title), actor:actor_id(full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((entry) => ({
    ...entry,
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
