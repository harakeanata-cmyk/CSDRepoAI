import { jsPDF } from "jspdf";
import { supabase } from "../lib/supabaseClient.js";
import { toGenkitEndpoint } from "../lib/genkitUrl.js";
import { extractDocumentFields, extractDocxTextWithFormatting, extractMetadataWithAI } from "./metadataSuggestions.js";
import { stripPageMarkers } from "./ocrTextUtils.js";
import { checkResearchDuplicate } from "./search.js";
import { createUniqueStorageToken } from "../lib/storagePath.js";
import { comparePaperFormats, formatSectionLabels } from "../lib/paperFormat.js";
import { validateOcrResearchRecord } from "../lib/ocrValidation.js";
import { readFileArrayBuffer } from "../lib/readFileArrayBuffer.js";

/**
 * OCR Digitization Module
 *
 * Runs PaddleOCR in a browser worker (no OCR server needed) to scan
 * images of hardbound research documents and extract text. `onProgress`
 * receives a 0-1 value you can wire into a progress bar.
 */
let paddleOcrPromise;
let pdfJsPromise;
let localOcrQueue = Promise.resolve();

async function withOcrRuntimeLock(task, signal) {
  const run = () => {
    if (signal?.aborted) throw new DOMException("OCR was cancelled.", "AbortError");
    return task();
  };

  // OCR runs in separate workers in separate tabs, but those workers still
  // compete for the same browser's WASM/GPU resources. Serialize inference
  // across same-origin tabs to avoid ONNX Runtime's "Session mismatch" error.
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(
      "csdrepoai-paddleocr-runtime",
      { mode: "exclusive", ...(signal ? { signal } : {}) },
      run,
    );
  }

  // Older browsers at least serialize jobs within this page context.
  const previous = localOcrQueue.catch(() => {});
  let release;
  localOcrQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

function getPaddleOcr() {
  if (!paddleOcrPromise) {
    paddleOcrPromise = import("@paddleocr/paddleocr-js")
      .then(async ({ PaddleOCR }) => {
        const options = {
          // Tiny v6 models are designed for on-device inference and avoid
          // the long session-initialization timeout seen with v5 on phones.
          textDetectionModelName: "PP-OCRv6_tiny_det",
          textRecognitionModelName: "PP-OCRv6_tiny_rec",
          // OCR is invoked once per page, so a large recognition batch only
          // reserves extra session memory. Keep it at one for phone browsers.
          textDetectionBatchSize: 1,
          textRecognitionBatchSize: 1,
          ortOptions: {
            // WebGPU session allocation can exceed the memory budget on mobile
            // GPUs. WASM is predictable across phones and desktop browsers.
            backend: "wasm",
            wasmPaths: new URL(`${import.meta.env.BASE_URL}ort-wasm/`, window.location.origin).href,
            numThreads: 1,
            simd: true,
          },
        };

        try {
          return await PaddleOCR.create({ ...options, worker: true });
        } catch (workerError) {
          // Retry on the main thread only when the browser rejected worker
          // startup. Model/session timeouts are not helped by repeating them
          // on the main thread and can freeze a phone's UI.
          const workerStartupFailed = /worker|postmessage|transfer|module script|securityerror/i
            .test(String(workerError?.message || workerError));
          if (!workerStartupFailed) throw workerError;

          try {
            return await PaddleOCR.create({ ...options, worker: false });
          } catch (fallbackError) {
            throw new Error(fallbackError?.message || workerError?.message || "model initialization failed");
          }
        }
      })
      .catch((error) => {
        paddleOcrPromise = null;
        const message = error.message || "model initialization failed";
        if (/bad_alloc|out of memory|memory allocation/i.test(message)) {
          throw new Error("PaddleOCR could not start because this device ran out of memory. Close other tabs or apps, reload the page, and try again with a smaller image.");
        }
        throw new Error(`PaddleOCR could not start: ${message}. Check your connection and reload the page to try again.`);
      });
  }
  return paddleOcrPromise;
}

function getRecognizedText(result) {
  const lines = (result?.items || [])
    .map((item) => String(item.text || "").trim())
    .filter(Boolean);
  return cleanOcrText(lines.join("\n"));
}

function getRecognitionConfidence(result) {
  const scores = (result?.items || []).map((item) => item.score).filter(Number.isFinite);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

export async function scanDocument(imageFileOrUrl, onProgress) {
  return withOcrRuntimeLock(async () => {
    const ocr = await getPaddleOcr();
    onProgress?.(0.05);
    const preparedImage = await prepareOcrImage(imageFileOrUrl);
    const [result] = await ocr.predict(preparedImage);
    onProgress?.(1);
    const confidence = getRecognitionConfidence(result) * 100;
    return { text: getRecognizedText(result), confidence };
  });
}

export async function expandUploadedFiles(files) {
  return normalizeFilesForArchive(files);
}

/** Compare detected chapter headings against the repository's archived papers. */
export async function reviewPaperFormat(documentText) {
  const { data, error } = await supabase
    .from("research_papers")
    .select("ocr_raw_text")
    .not("ocr_raw_text", "is", null)
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("Could not read archived papers for the OCR format comparison.", error.message);
    return {
      status: "unavailable",
      message: "Format comparison is unavailable right now. Please review the paper’s section order manually.",
      comparedPapers: 0,
    };
  }

  const comparison = comparePaperFormats(documentText, (data || []).map((paper) => paper.ocr_raw_text));
  const sections = formatSectionLabels(comparison.candidateSections);
  if (comparison.status === "insufficient") {
    return {
      ...comparison,
      message: comparison.candidateSections.length < 3
        ? `Only ${sections.length ? sections.join(", ") : "a few recognizable section headings"} were detected, so the format check is inconclusive. This does not prevent archiving.`
        : `The repository has only ${comparison.comparedPapers} usable papers for comparison, so the format check is inconclusive. This does not prevent archiving.`,
    };
  }

  if (comparison.status === "match") {
    return {
      ...comparison,
      message: `The detected section structure looks consistent with ${comparison.comparedPapers} archived papers. Please still check that OCR captured every heading correctly.`,
    };
  }

  const missingSections = formatSectionLabels(comparison.missingSections);
  const unusualSections = formatSectionLabels(comparison.unusualSections);
  const fallbackMessage = `The detected format differs from the archived papers. This scan is missing common section${missingSections.length === 1 ? "" : "s"}: ${missingSections.join(", ") || "none"}${unusualSections.length ? `, and includes less common section${unusualSections.length === 1 ? "" : "s"}: ${unusualSections.join(", ")}` : ""}. Review the scan because OCR may have missed headings.`;
  const endpoint = toGenkitEndpoint(
    import.meta.env.VITE_GENKIT_METADATA_URL || import.meta.env.VITE_GENKIT_SEARCH_URL,
    "format-review",
  );

  if (!endpoint) return { ...comparison, message: fallbackMessage, aiReviewed: false };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateSections: sections,
        commonSections: formatSectionLabels(comparison.commonSections),
        missingSections,
        unusualSections,
        comparedPapers: comparison.comparedPapers,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Format review request failed (${response.status})`);
    const result = await response.json();
    return { ...comparison, message: result.message || fallbackMessage, aiReviewed: Boolean(result.message) };
  } catch (reviewError) {
    console.warn("AI paper-format review unavailable; showing the local comparison.", reviewError.message);
    return { ...comparison, message: fallbackMessage, aiReviewed: false };
  }
}

async function getOcrTextFingerprint(ocrText) {
  const normalizedText = stripPageMarkers(String(ocrText || ""))
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalizedText) return null;
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify duplicate OCR text. Use a current browser over HTTPS.");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedText));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertOcrTextIsUnique(fingerprint) {
  if (!fingerprint) return;

  const { data, error } = await supabase
    .from("research_papers")
    .select("id")
    .eq("source", "ocr_scanned")
    .eq("manuscript_sha256", fingerprint)
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data) {
    throw new Error("This OCR text exactly matches a paper already in the repository. It was not saved again; check the existing archive record.");
  }
}

async function removeUploadedOcrFile(fileUrl) {
  const marker = "/storage/v1/object/public/research-files/";
  const markerIndex = String(fileUrl || "").indexOf(marker);
  if (markerIndex < 0) return;

  const path = decodeURIComponent(fileUrl.slice(markerIndex + marker.length));
  const { error } = await supabase.storage.from("research-files").remove([path]);
  if (error) console.warn("Could not remove the duplicate OCR upload.", error.message);
}

async function normalizeFilesForArchive(files) {
  const expanded = [];

  for (const file of files || []) {
    if (file?.type?.startsWith("image/")) {
      expanded.push(file);
      continue;
    }

    if (isPdfFile(file)) {
      const pdfPageFiles = await pdfFileToPageImageFiles(file);
      expanded.push(...pdfPageFiles);
      continue;
    }

    if (isDocxFile(file)) {
      expanded.push(file);
      continue;
    }

    throw new Error("Document digitization requires scanned image files, PDF, or DOCX uploads.");
  }

  return expanded;
}

export { stripPageMarkers } from "./ocrTextUtils.js";

export async function scanDocuments(imageFiles, onProgress, { signal } = {}) {
  return withOcrRuntimeLock(async () => {
    const pages = [];
    const totalPages = imageFiles.length;
    const needsImageOcr = imageFiles.some((file) => !isDocxFile(file));
    if (needsImageOcr) onProgress?.(0.02, 1, totalPages);
    const ocr = needsImageOcr ? await getPaddleOcr() : null;

    for (let index = 0; index < imageFiles.length; index += 1) {
      if (signal?.aborted) break;
      const file = imageFiles[index];
      if (isDocxFile(file)) {
        const { text, metadataText } = await extractDocxTextWithFormatting(file);
        pages.push({ pageNumber: index + 1, text, metadataText, confidence: null });
        onProgress?.(1, index + 1, totalPages);
        continue;
      }

      onProgress?.(0.05, index + 1, totalPages);
      const preparedImage = await prepareOcrImage(file);
      if (signal?.aborted) break;
      const [result] = await ocr.predict(preparedImage);
      pages.push({
        pageNumber: index + 1,
        text: getRecognizedText(result),
        confidence: getRecognitionConfidence(result),
      });
      onProgress?.(1, index + 1, totalPages);
    }

    const text = pages
      .map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`)
      .join("\n\n");

    return { text, pages, cancelled: Boolean(signal?.aborted) };
  }, signal);
}

function cleanOcrText(rawText) {
  const normalized = rawText
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\t+/g, " ")
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return applyCommonOcrCorrections(normalized)
    .replace(/\b([A-Za-z]{3,})\s+\1\b/gi, "$1")
    .replace(/([A-Za-z])\s{2,}([A-Za-z])/g, "$1 $2")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])([A-Za-z])/g, "$1 $2")
    .trim();
}

function applyCommonOcrCorrections(text) {
  const replacements = [
    [/\bteh\b/gi, "the"],
    [/\bthte\b/gi, "the"],
    [/\bthier\b/gi, "their"],
    [/\brecieve\b/gi, "receive"],
    [/\bseperate\b/gi, "separate"],
    [/\boccured\b/gi, "occurred"],
    [/\bimporant\b/gi, "important"],
    [/\bstudetn\b/gi, "student"],
    [/\bstudnet\b/gi, "student"],
    [/\bdeparment\b/gi, "department"],
    [/\bdepatrment\b/gi, "department"],
    [/\breserach\b/gi, "research"],
    [/\breserch\b/gi, "research"],
    [/\bpractial\b/gi, "practical"],
    [/\bintial\b/gi, "initial"],
    [/\bdocuemnt\b/gi, "document"],
    [/\bdocment\b/gi, "document"],
    [/\baccross\b/gi, "across"],
    [/\bintroductionn\b/gi, "introduction"],
    [/\bmethodolgy\b/gi, "methodology"],
    [/\banalysys\b/gi, "analysis"],
    [/\bimplmentation\b/gi, "implementation"],
    [/\btechonology\b/gi, "technology"],
    [/\bconclsuion\b/gi, "conclusion"],
    [/\bperfromance\b/gi, "performance"],
    [/\bproccess\b/gi, "process"],
    [/\bcommitee\b/gi, "committee"],
    [/\bpalce\b/gi, "place"],
    [/\bpg\s*(\d+)\b/gi, "Page $1"],
  ];

  return replacements.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

function isDocxFile(file) {
  return file?.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || /\.docx$/i.test(file?.name || "");
}

async function pdfFileToPageImageFiles(file) {
  const { getDocument } = await getPdfJs();
  const pdfData = await readFileArrayBuffer(file);
  const pdf = await getDocument({ data: pdfData }).promise;
  const pageFiles = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare a canvas for the PDF page.");
    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error(`Could not convert PDF page ${pageNumber} into an OCR image.`);

    const baseName = file.name.replace(/\.pdf$/i, "");
    pageFiles.push(
      new File([blob], `${baseName}-page-${pageNumber}.jpg`, {
        type: "image/jpeg",
      })
    );
    Object.assign(pageFiles[pageFiles.length - 1], {
      sourcePdf: file,
      sourcePdfPageNumber: pageNumber,
      sourcePdfPageCount: pdf.numPages,
    });
  }

  return pageFiles;
}

export async function extractScannedPdfText(file, { onProgress } = {}) {
  const pageFiles = await pdfFileToPageImageFiles(file);
  const result = await scanDocuments(pageFiles, onProgress);
  return result.text;
}

function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, workerModule]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default || workerModule;
      return pdfjs;
    }).catch((error) => {
      pdfJsPromise = null;
      throw error;
    });
  }
  return pdfJsPromise;
}

async function prepareOcrImage(file) {
  if (!file?.type?.startsWith("image/")) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    // Camera photos can decode to tens of millions of pixels. Keep the input
    // smaller on phones to avoid exhausting memory in canvas and OCR buffers.
    const constrainedDevice = Number(navigator.deviceMemory || 8) <= 4
      || window.matchMedia?.("(max-width: 700px)").matches;
    const maxDimension = constrainedDevice ? 1800 : 2400;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.filter = "grayscale(1) contrast(1.45) brightness(1.08)";
    ctx.drawImage(bitmap, 0, 0, width, height);
    ctx.filter = "none";
    bitmap.close?.();

    const preparedBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    // Release the large decoded pixel buffer before OCR allocates its tensors.
    canvas.width = 0;
    canvas.height = 0;
    return preparedBlob || file;
  } catch {
    return file;
  }
}

/**
 * Downscales/recompresses a scanned page image before it's uploaded for
 * archival storage. OCR has already run on the original file by this
 * point (see scanDocuments) — the archive copy only needs to be legible
 * to a human reader, not full camera resolution, so this is a large,
 * safe win for upload time on phone-captured pages (often 3-8MB each).
 * Falls back to the original file if compression fails for any reason.
 */
async function compressPageImage(file, { maxDimension = 1800, quality = 0.82 } = {}) {
  if (!file.type?.startsWith("image/") || file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // compression didn't help, keep original

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file; // never let a compression hiccup block the archive
  }
}

async function imageFileToDataUrl(file) {
  const compressed = await compressPageImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, file: compressed });
    reader.onerror = () => reject(reader.error || new Error("Could not read scanned page."));
    reader.readAsDataURL(compressed);
  });
}

async function createResearchPdf(files, { onProgress } = {}) {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let index = 0; index < files.length; index += 1) {
    const { dataUrl, file } = await imageFileToDataUrl(files[index]);
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not prepare scanned page for PDF."));
      element.src = dataUrl;
    });
    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;

    if (index > 0) pdf.addPage();
    pdf.addImage(dataUrl, file.type === "image/png" ? "PNG" : "JPEG", x, y, width, height);
    onProgress?.({ phase: "preparing", completed: index + 1, total: files.length });
  }

  return pdf.output("blob");
}

async function uploadResearchPdf(files, { onProgress } = {}) {
  const pdfBlob = await createResearchPdf(files, { onProgress });
  const path = `ocr-scans/${createUniqueStorageToken()}_research.pdf`;
  onProgress?.({ phase: "uploading", completed: files.length, total: files.length, bytes: pdfBlob.size });
  const { error } = await supabase.storage.from("research-files").upload(path, pdfBlob, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from("research-files").getPublicUrl(path);
  return pub.publicUrl;
}

async function uploadResearchDocument(file, { onProgress } = {}) {
  const path = `ocr-scans/${createUniqueStorageToken()}_${file.name.replace(/[^a-z0-9._-]/gi, "_")}`;
  onProgress?.({ phase: "uploading", completed: 0, total: 1, bytes: file.size });
  const { error } = await supabase.storage.from("research-files").upload(path, file, {
    contentType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from("research-files").getPublicUrl(path);
  return pub.publicUrl;
}

/**
 * OCR Digitization Module: heuristic metadata extraction.
 *
 * Hardbound CSD research documents follow a fairly predictable title-page
 * layout, so this pulls out title, authors, adviser, panel members,
 * abstract, and keywords from the raw OCR text using pattern matching.
 * It's a starting point, not a guarantee — the admin reviews and corrects
 * the fields before archiving (see OCRScan.jsx).
 */
export async function extractMetadata(rawText) {
  const parserText = stripPageMarkers(rawText);
  const cleanedText = parserText.replace(/__DOCX_(?:BOLD|ITALIC)__/g, "");
  const fallback = extractDocumentFields(parserText);
  const cover = extractOcrCoverMetadata(rawText);
  const aiMetadata = await extractMetadataWithAI(cleanedText);
  const aiStatus = aiMetadata?.unavailable
    ? "not_configured"
    : aiMetadata?.failed
      ? "failed"
      : hasUsableAiMetadata(aiMetadata)
        ? "ok"
        : "failed";

  const fallbackKeywords = String(fallback.keywords || "").trim();
  const aiKeywords = Array.isArray(aiMetadata?.keywords)
    ? aiMetadata.keywords.filter(Boolean).join(", ")
    : String(aiMetadata?.keywords || "").trim();
  const keywords = fallbackKeywords || aiKeywords;

  const fallbackTitle = isUsableMetadataTitle(cover.title) ? cover.title
    : isUsableMetadataTitle(fallback.title) ? fallback.title : "";
  const aiTitle = isUsableMetadataTitle(aiMetadata?.title) ? String(aiMetadata.title).trim() : "";
  const title = chooseMostCompleteOcrTitle(fallbackTitle, aiTitle);

  // A short final title line (for example, "Vision Transformer") can look
  // like a name to the generic metadata parser. Drop candidates that are
  // already present in the title before choosing between local and AI names.
  const fallbackAuthors = filterTitleOverlapAuthors(fallback.authors, title);
  const aiAuthors = filterTitleOverlapAuthors(aiMetadata?.authors, title);
  const coverAuthors = filterTitleOverlapAuthors(cover.authors, title);
  const preferredAuthors = coverAuthors.length ? coverAuthors : fallbackAuthors;
  const authors = (preferredAuthors.length >= aiAuthors.length ? preferredAuthors : aiAuthors).join(", ");

  const fallbackAbstract = String(fallback.abstract || "").trim();
  const aiAbstract = String(aiMetadata?.abstract || "").trim();
  const abstract = fallbackAbstract.length >= 80 ? fallbackAbstract : aiAbstract || fallbackAbstract;
  const approvalPanelMembers = extractOcrApprovalPanelMembers(rawText);
  const fallbackPanelMembers = [
    ...approvalPanelMembers,
    ...(Array.isArray(fallback.panelMembers) ? fallback.panelMembers : []),
    ...cover.panelMembers,
  ];
  const aiPanelMembers = Array.isArray(aiMetadata?.panelMembers) ? aiMetadata.panelMembers : [];
  const excludedPanelMembers = new Set([fallback.adviser, cover.adviser, aiMetadata?.adviser, ...fallbackAuthors, ...cover.authors, ...aiAuthors]
    .map(normalizeOcrPersonName)
    .filter(Boolean));
  const combinedPanelMembers = [];
  const seenPanelMembers = new Set();
  // Prefer names tied to a panel caption by local parsing. AI can fill gaps
  // only when its spelling is supported by the scanned text, which prevents
  // a plausible-looking but invented third panel member from being archived.
  for (const member of [...fallbackPanelMembers, ...aiPanelMembers]) {
    const cleanedMember = String(member || "").replace(/\s+/g, " ").trim();
    const normalizedMember = normalizeOcrPersonName(cleanedMember);
    if (aiPanelMembers.includes(member) && !isOcrNameSupported(cleanedMember, cleanedText)) continue;
    if (!cleanedMember || !normalizedMember || excludedPanelMembers.has(normalizedMember) || seenPanelMembers.has(normalizedMember)) continue;
    seenPanelMembers.add(normalizedMember);
    combinedPanelMembers.push(cleanedMember);
  }
  const panelMembers = combinedPanelMembers.slice(0, 3).join(", ");

  return {
    title,
    authors,
    adviser: String(cover.adviser || fallback.adviser || aiMetadata?.adviser || "").trim(),
    panelMembers,
    abstract,
    keywords,
    aiStatus,
  };
}

function chooseMostCompleteOcrTitle(localTitle, aiTitle) {
  if (!localTitle) return aiTitle;
  if (!aiTitle) return localTitle;

  const localWords = String(localTitle).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const aiWords = String(aiTitle).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (aiWords.length <= localWords.length || aiWords.length > 24) return localTitle;

  // Prefer the AI reconstruction when it extends the local title fragment;
  // otherwise keep the title-page parser's higher-confidence result.
  let matched = 0;
  let cursor = 0;
  for (const word of localWords) {
    const foundAt = aiWords.indexOf(word, cursor);
    if (foundAt >= 0) {
      matched += 1;
      cursor = foundAt + 1;
    }
  }
  return matched / Math.max(localWords.length, 1) >= 0.7 ? aiTitle : localTitle;
}

function isOcrNameSupported(name, documentText) {
  const nameWords = normalizeOcrPersonName(name).split(/\s+/).filter((word) => word.length > 1);
  const documentWords = new Set(normalizeOcrPersonName(documentText).split(/\s+/).filter(Boolean));
  return nameWords.length >= 2 && nameWords.filter((word) => documentWords.has(word)).length >= 2;
}

function extractOcrApprovalPanelMembers(rawText) {
  const pages = String(rawText || "").split(/-{2,}\s*Page\s+\d+\s*-{2,}/i);
  const approvalPage = pages.slice(1).find((page) => /approval\s*sheet|panel\s*(?:chair|members?|ists?|of\s+examiners)/i.test(page));
  if (!approvalPage) return [];
  return extractDocumentFields(approvalPage).panelMembers || [];
}

// Some older thesis covers place the institution letterhead before the title,
// list authors under "Presented by", and print adviser/panel roles below each
// reviewer's name. Keep this recognition in the OCR archive flow so its layout
// heuristics do not change metadata suggestions for digital submissions.
function extractOcrCoverMetadata(rawText) {
  const pageOneText = String(rawText || "").split(/-{2,}\s*Page\s+2\s*-{2,}/i)[0];
  const lines = pageOneText
    .split(/\r?\n/)
    .map((line) => line.replace(/__DOCX_(?:BOLD|ITALIC)__/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isOcrCoverNoiseLine(line));
  const titleLines = [];
  let startedTitle = false;

  for (const line of lines) {
    if (/^(?:in partial fulfillment|presented to|presented by|a thesis presented|a thesis submitted|abstract)\b/i.test(line)) {
      if (startedTitle) break;
      continue;
    }
    if (/^(?:JMJ Marist Brothers|Notre Dame of Marbel University|City of Koronadal\b|College of Engineering\b)/i.test(line)) continue;
    if (isOcrCoverTitleLine(line)) {
      titleLines.push(line);
      startedTitle = true;
      continue;
    }
    if (startedTitle) {
      if (isOcrCoverPersonLine(line)) break;
      if (/^(?:bachelor|master|degree|requirements?)\b/i.test(line)) break;
      if (isOcrCoverTitleContinuation(line)) titleLines.push(line);
      else break;
    }
  }

  const title = titleLines.join(" ").replace(/\s+/g, " ").trim();
  const authors = [];
  const presentedByIndex = lines.findIndex((line) => /^presented\s+by\s*:?/i.test(line));
  if (presentedByIndex >= 0) {
    const inlineAuthors = lines[presentedByIndex].replace(/^presented\s+by\s*:?\s*/i, "");
    authors.push(...extractCoverPeople(inlineAuthors));
    for (let index = presentedByIndex + 1; index < lines.length && authors.length < 6; index += 1) {
      const line = lines[index];
      if (/^(?:march|april|may|june|july|august|september|october|november|december|january|february)\b/i.test(line)) break;
      const people = extractCoverPeople(line);
      if (!people.length) {
        if (authors.length) break;
        continue;
      }
      authors.push(...people);
    }
  }

  let adviser = "";
  for (let index = 0; index < lines.length; index += 1) {
    const roleMatch = lines[index].match(/\b(?:thesis\s+)?advis[eo]r\b/i);
    if (!roleMatch) continue;
    const inlineName = lines[index].slice(0, roleMatch.index).replace(/[,:;\s-]+$/, "").trim();
    adviser = extractCoverPeople(inlineName)[0] || extractCoverPeople(lines[index - 1] || "")[0] || "";
    if (adviser) break;
  }

  const panelMembers = [];
  const panelRole = /\b(?:panel\s*(?:member|chair(?:person|man|woman)?|of\s+examiners)|(?:chair|member)\s+of\s+(?:the\s+)?panel)\b/ig;
  for (let index = 0; index < lines.length && panelMembers.length < 3; index += 1) {
    const line = lines[index];
    panelRole.lastIndex = 0;
    const roles = [...line.matchAll(panelRole)];
    if (!roles.length) continue;

    const beforeRole = line.slice(0, roles[0].index).trim();
    let candidates = extractCoverPeople(beforeRole);
    if (!candidates.length) candidates = extractCoverPeople(lines[index - 1] || "");
    if (roles.length > 1 && candidates.length < roles.length) {
      const previous = lines[index - 1] || "";
      const credentialChunks = previous.split(/\b(?:MIT|MSIT|MEP-?ECE|MSCE|Ph\.?D\.?)\b/ig);
      candidates = credentialChunks.flatMap(extractCoverPeople);
    }
    panelMembers.push(...candidates);
  }

  const uniquePanelMembers = [...new Map(panelMembers
    .filter((name) => normalizeOcrPersonName(name) !== normalizeOcrPersonName(adviser)
      && !authors.some((author) => normalizeOcrPersonName(author) === normalizeOcrPersonName(name)))
    .map((name) => [normalizeOcrPersonName(name), name])).values()].slice(0, 3);

  return { title, authors: [...new Set(authors)].slice(0, 6), adviser, panelMembers: uniquePanelMembers };
}

function isOcrCoverTitleLine(line) {
  if (isOcrCoverNoiseLine(line) || isOcrCoverPersonLine(line)) return false;
  const letters = line.replace(/[^A-Za-z]/g, "");
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 4 && letters.length >= 18
    && !/\b(?:UNIVERSITY|COLLEGE|BROTHERS|KORONADAL|COTABATO|SOUTHCOTABATO|BACHELOR|MASTER|COMPUTER SCIENCE)\b/i.test(line);
}

function isOcrCoverTitleContinuation(line) {
  return !isOcrCoverNoiseLine(line)
    && !isOcrCoverPersonLine(line)
    && !/^(?:bachelor|master|degree|requirements?|presented|abstract|keywords?|may|june|july|august|september|october|november|december|january|february|march|april)\b/i.test(line)
    && !/\b(?:university|college|institute|computer science|accession|date acquired)\b/i.test(line)
    && line.length >= 8;
}

function isOcrCoverPersonLine(line) {
  // Names with a middle initial are common on these covers and distinguish
  // the author/adviser block from the title's short continuation lines.
  return /\b[A-Z]\.\s+[A-Z][A-Za-z'-]+\b/.test(line)
    && line.split(/\s+/).length <= 8;
}

function isOcrCoverNoiseLine(line) {
  return /\b(?:ndmu\s*[-–]?\s*ceac|(?:compl|compu)\w{1,}tary\s+copy|hard\s?bound|accession\s*(?:no\.?|number)|date\s+acquired|ndmu\s+library)\b/i.test(line);
}

function filterTitleOverlapAuthors(values, title) {
  const candidates = Array.isArray(values) ? values : [];
  const titleWords = new Set(String(title || "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  return candidates
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => {
      if (!value) return false;
      const words = value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
      return words.length >= 2 && !words.every((word) => titleWords.has(word));
    });
}

function extractCoverPeople(value) {
  const cleaned = String(value || "")
    .replace(/\b(?:presented\s+by|panel\s+(?:member|chair|chairperson)|adviser|advisor)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  // Degree suffixes often separate reviewer names printed on one line in
  // multi-column scans, for example "... Insular, Jr., MIT Hajah T. Sueno, MSIT".
  const chunks = cleaned.split(/\b(?:MIT|MSIT|MEP-?ECE|MSCE|Ph\.?D\.?)\b/ig).filter(Boolean);
  const candidates = chunks.length > 1 ? chunks : [cleaned];
  return candidates
    .map((candidate) => candidate.replace(/\b(?:Engr\.?|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\b/ig, " ").replace(/[,:;]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((candidate) => {
      const words = candidate.split(/\s+/).filter(Boolean);
      return words.length >= 2 && words.length <= 6
        && words.every((word) => /^[A-Z][A-Za-z.'-]*$/.test(word) || /^[A-Z]\.$/.test(word));
    });
}

function normalizeOcrPersonName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:engr|dr|mr|mrs|ms|mit|msit|mep-ece|msce)\b\.?/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function hasUsableAiMetadata(metadata) {
  return Boolean(metadata && (
    metadata.title
    || metadata.abstract
    || metadata.adviser
    || (Array.isArray(metadata.panelMembers) && metadata.panelMembers.length)
    || (Array.isArray(metadata.authors) && metadata.authors.length)
    || (Array.isArray(metadata.keywords) && metadata.keywords.length)
  ));
}

function isUsableMetadataTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  if (!title || title.length > 180 || title.split(/\s+/).length > 24) return false;
  if (/^har(?:d)?bound(?:\s+bayad)?$/i.test(title)) return false;
  if (/\b(?:university|college|institute|bachelor of|master of|in partial fulfillment|submitted to|presented to)\b/i.test(title)) return false;
  if (/^(string|title|document|manuscript|research paper|untitled|unknown|n\/a|null|undefined)$/i.test(title)) return false;
  if (/^\d+\s+(?:weeks?|days?|months?)\b/i.test(title)) return false;
  if (/\b(?:data collection plan|prior to data collection|this study will|the research team will)\b/i.test(title)) return false;
  return !/[.!?]$/.test(title);
}

function toTitleCase(str) {
  if (!str) return "";
  // Only reformat if it looks like a shouted all-caps title
  if (str !== str.toUpperCase()) return str;
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}


/**
 * Admin uploads a scanned page, runs OCR, then creates a research_papers
 * record of source='ocr_scanned' with the extracted text stored for
 * full-text search.
 */
export async function digitizeAndArchive({
  imageFile,
  imageFiles,
  ocrText,
  title,
  authors,
  academicYear,
  program,
  adviser,
  panelMembers,
  abstract,
  keywords,
  sdgTags = [],
  adminId,
  onProgress,
}) {
  const recordCheck = validateOcrResearchRecord({ ocrText, title, authors, adviser, panelMembers, abstract, keywords, sdgTags });
  if (!recordCheck.ok) throw new Error(recordCheck.message);

  const rawFiles = imageFiles?.length ? imageFiles : imageFile ? [imageFile] : [];
  const filesToUpload = await normalizeFilesForArchive(rawFiles);

  if (!filesToUpload.length) {
    throw new Error("Document digitization requires at least one scanned image or PDF file.");
  }

  onProgress?.({ phase: "checking", completed: 0, total: 1 });
  const manuscriptFingerprint = await getOcrTextFingerprint(ocrText);
  await assertOcrTextIsUnique(manuscriptFingerprint);
  await checkResearchDuplicate({
    title,
    abstract,
    keywords,
    documentText: ocrText,
  });

  const actorId = adminId;
  const firstPage = filesToUpload[0];
  const sourcePdf = firstPage?.sourcePdf;
  const isCompleteOriginalPdf = sourcePdf
    && filesToUpload.length === firstPage.sourcePdfPageCount
    && filesToUpload.every((file, index) => file.sourcePdf === sourcePdf && file.sourcePdfPageNumber === index + 1);
  const uploadedUrl = filesToUpload.length === 1 && isDocxFile(filesToUpload[0])
    ? await uploadResearchDocument(filesToUpload[0], { onProgress })
    : isCompleteOriginalPdf
      ? await uploadResearchDocument(sourcePdf, { onProgress })
      : await uploadResearchPdf(filesToUpload, { onProgress });

  onProgress?.({ phase: "saving", completed: 0, total: 1 });

  const { data, error } = await supabase
    .from("research_papers")
    .insert({
      title,
      authors,
      academic_year: academicYear,
      program,
      adviser,
      panel_members: panelMembers,
      abstract,
      keywords,
      sdg_tags: sdgTags,
      submitted_by: actorId,
      status: "approved",
      source: "ocr_scanned",
      ocr_raw_text: ocrText,
      manuscript_sha256: manuscriptFingerprint,
      file_url: uploadedUrl,
    })
    .select()
    .single();

  if (error) {
    await removeUploadedOcrFile(uploadedUrl);
    if (error.code === "23505" && error.constraint === "idx_research_active_manuscript_sha256") {
      throw new Error("This OCR text was archived at the same time in another session. Check the existing archive record; this copy was not saved.");
    }
    throw error;
  }

  onProgress?.({ phase: "saving", completed: 1, total: 1 });
  const embeddingUrl = toGenkitEndpoint(
    import.meta.env.VITE_GENKIT_EMBED_URL || import.meta.env.VITE_GENKIT_SEARCH_URL,
    "embed",
  );
  if (embeddingUrl) {
    void fetch(embeddingUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId: data.id }),
    }).then((response) => {
      if (!response.ok) throw new Error(`Embedding request failed with status ${response.status}`);
    }).catch((embeddingError) => {
      console.warn("Could not index the OCR archive record for semantic search.", embeddingError);
    });
  }

  // The archive record is already committed. Do not make the user's save wait
  // for a secondary audit-log request to finish.
  void supabase.from("submission_logs").insert({
    paper_id: data.id,
    action: "ocr_scanned",
    actor_id: actorId,
    detail: null,
  }).then(({ error: logError }) => {
    if (logError) console.warn("Could not write OCR archive audit log.", logError);
  });

  return data;
}
