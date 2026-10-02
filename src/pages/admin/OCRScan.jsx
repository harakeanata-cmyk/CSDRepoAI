import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Camera,
  UploadCloud,
  ScanLine,
  X,
  Check,
  FileText,
  BookOpenCheck,
  PenLine,
  Users,
  GraduationCap,
  Quote,
  Tags,
  CalendarDays,
  ArrowRight,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Plus,
} from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, Field } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { digitizeAndArchive, scanDocuments, extractMetadata, expandUploadedFiles, reviewPaperFormat } from "../../services/ocr";
import { suggestKeywordsWithAI, suggestMetadata } from "../../services/metadataSuggestions";
import { getAcademicYears } from "../../services/academicYears";
import { useUnloadWarning } from "../../lib/useUnloadWarning";
import { SDG_LIST } from "../../lib/sdgList";
import { validateOcrResearchRecord } from "../../lib/ocrValidation";
import { PROGRAM_OPTIONS } from "../../lib/programs";

const STEPS = [
  { key: "upload", label: "Upload" },
  { key: "scan", label: "Scan" },
  { key: "review", label: "Review" },
  { key: "done", label: "Archived" },
];

function stepIndexFor(step) {
  if (step === "idle") return 0;
  if (step === "scanning") return 1;
  if (step === "scanned" || step === "saving") return 2;
  if (step === "done") return 3;
  return 0;
}

export default function OCRScan() {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [ocrText, setOcrText] = useState("");
  const [scannedPageTexts, setScannedPageTexts] = useState([]);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("idle"); // idle | scanning | scanned | saving | done
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [donePages, setDonePages] = useState(0);
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [canStopScan, setCanStopScan] = useState(false);
  const [meta, setMeta] = useState({ title: "", authors: "", academicYear: "", program: "", adviser: "", panelMembers: "", abstract: "", keywords: "" });
  const [sdgTags, setSdgTags] = useState([]);
  const [aiStatus, setAiStatus] = useState("idle");
  const [saveProgress, setSaveProgress] = useState({ completed: 0, total: 0 });
  const [saveEstimateSeconds, setSaveEstimateSeconds] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [academicYears, setAcademicYears] = useState([]);
  const [uploadError, setUploadError] = useState("");
  const [scanNotice, setScanNotice] = useState("");
  const [formatReview, setFormatReview] = useState({ status: "idle", message: "" });
  const [keywordSuggestions, setKeywordSuggestions] = useState([]);
  const [keywordSuggestionStatus, setKeywordSuggestionStatus] = useState("idle");
  const fileInputRef = useRef(null);
  const scanAbortControllerRef = useRef(null);
  const pageTimingRef = useRef({ page: null, startedAt: 0, durations: [] });
  const saveTimingRef = useRef({ lastPageAt: 0, pageDurations: [] });

  useUnloadWarning(files.length > 0 && step !== "done");

  useEffect(() => {
    getAcademicYears({ activeOnly: true })
      .then((items) => setAcademicYears(items.map((year) => year.label)))
      .catch(() => setAcademicYears([]));
  }, []);

  const activeIndex = stepIndexFor(step);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleAuthorsChange(e) {
    const { value } = e.target;
    const inputType = e.nativeEvent?.inputType || "";
    if (!inputType.startsWith("delete") && value.endsWith(",")) {
      setMeta((m) => ({ ...m, authors: value + " " }));
      return;
    }
    setMeta((m) => ({ ...m, authors: value }));
  }

async function loadFiles(list) {
  const selected = Array.from(list || []);
  if (!selected.length) return;

  setUploadError("");
  setScanNotice("");
  try {
    const expandedFiles = await expandUploadedFiles(selected);
    if (!expandedFiles.length) throw new Error("No readable pages were found in the selected file.");

    setFiles((prev) => [...prev, ...expandedFiles]);
    setPreviews((prev) => [...prev, ...expandedFiles.map((file) => URL.createObjectURL(file))]);
    setScannedPageTexts((prev) => [...prev, ...expandedFiles.map(() => null)]);
    setStep("idle");
    setTotalPages((prev) => prev + expandedFiles.length);
  } catch (error) {
    setUploadError(error.message || "Could not read that file. Please choose a PDF, DOCX, or image file.");
  }
}

function handleFile(e) {
  loadFiles(e.target.files);
  e.target.value = "";
}

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    loadFiles(e.dataTransfer.files);
  }

  function removeFile(index) {
    const nextFiles = files.filter((_, i) => i !== index);
    const nextPreviews = previews.filter((_, i) => i !== index);
    const nextScannedPageTexts = scannedPageTexts.filter((_, i) => i !== index);
    setScannedPageTexts(nextScannedPageTexts);
    setFiles(nextFiles);
    setPreviews(nextPreviews);
    setTotalPages(nextFiles.length);
    setDonePages(nextScannedPageTexts.filter((text) => text !== null && text !== undefined).length);
    if (nextFiles.length === 0) {
      setStep("idle");
      setOcrText("");
      setMeta({ title: "", authors: "", academicYear: "", program: "", adviser: "", panelMembers: "", abstract: "", keywords: "" });
      setSdgTags([]);
    }
    setPreviewIndex(null);
    setPreviewZoom(1);
  }

  function openPreview(index) {
    setPreviewIndex(index);
    setPreviewZoom(1);
  }

  function reorderPages(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;

    setFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });

    setScannedPageTexts((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });

    setPreviews((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });

    setPreviewIndex((current) => {
      if (current === null) return null;
      if (current === fromIndex) return toIndex;
      if (current > fromIndex && current <= toIndex) return current - 1;
      if (current < fromIndex && current >= toIndex) return current + 1;
      return current;
    });
  }

  function handleStopScan() {
    if (!scanAbortControllerRef.current || !canStopScan) return;
    scanAbortControllerRef.current.abort();
    setIsStopping(true);
  }

  async function handleScan() {
    if (!files.length) return;
    const pendingPages = files
      .map((file, index) => ({ file, index }))
      .filter(({ index }) => scannedPageTexts[index] == null);
    if (!pendingPages.length) {
      setStep("scanned");
      return;
    }

    const completedBeforeScan = scannedPageTexts.filter((text) => text !== null && text !== undefined).length;
    const hadPreviousText = Boolean(ocrText.trim());
    setStep("scanning");
    setUploadError("");
    setScanNotice("");
    setKeywordSuggestions([]);
    setKeywordSuggestionStatus("idle");
    setFormatReview({ status: "checking", message: "Comparing section headings with archived papers…" });
    setIsStopping(false);
    setCanStopScan(true);
    const controller = new AbortController();
    scanAbortControllerRef.current = controller;
    setProgress(0);
    setTotalPages(files.length);
    setDonePages(completedBeforeScan);
    setEstimatedSecondsRemaining(null);
    pageTimingRef.current = { page: null, startedAt: 0, durations: [] };
    setCurrentPage(pendingPages[0].index + 1);

    try {
      const { pages, cancelled } = await scanDocuments(pendingPages.map(({ file }) => file), (pageProgress, page) => {
        const originalPageIndex = pendingPages[page - 1].index;
        const timing = pageTimingRef.current;
        if (timing.page !== page) {
          timing.page = page;
          timing.startedAt = Date.now();
        }
        if (pageProgress >= 1) {
          const duration = Math.max(1, (Date.now() - timing.startedAt) / 1000);
          timing.durations.push(duration);
          const recentDurations = timing.durations.slice(-5).sort((a, b) => a - b);
          const typicalPageSeconds = recentDurations[Math.floor(recentDurations.length / 2)];
          const remainingPages = Math.max(0, pendingPages.length - page);
          setEstimatedSecondsRemaining(Math.ceil(typicalPageSeconds * remainingPages));
        }
        setCurrentPage(originalPageIndex + 1);
        setTotalPages(files.length);
        setProgress(pageProgress >= 1 ? 0 : pageProgress);
        setDonePages(completedBeforeScan + page - (pageProgress >= 1 ? 0 : 1));
      }, { signal: controller.signal });
      scanAbortControllerRef.current = null;
      setCanStopScan(false);
      setIsStopping(false);

      const nextPageTexts = [...scannedPageTexts];
      pages.forEach((page, index) => {
        nextPageTexts[pendingPages[index].index] = page.text;
      });
      setScannedPageTexts(nextPageTexts);
      const nextMetadataPageTexts = [...nextPageTexts];
      pages.forEach((page, index) => {
        nextMetadataPageTexts[pendingPages[index].index] = page.metadataText || page.text;
      });

      const recognizedText = pages
        .map((page, index) => `--- Page ${pendingPages[index].index + 1} ---\n${page.text}`)
        .join("\n\n");
      const recognizedMetadataText = pages
        .map((page, index) => `--- Page ${pendingPages[index].index + 1} ---\n${page.metadataText || page.text}`)
        .join("\n\n");
      const combinedText = hadPreviousText
        ? [ocrText.trim(), recognizedText].filter(Boolean).join("\n\n")
        : files
          .map((_, index) => nextPageTexts[index] == null ? "" : `--- Page ${index + 1} ---\n${nextPageTexts[index]}`)
          .filter(Boolean)
          .join("\n\n");
      const combinedMetadataText = hadPreviousText
        ? [ocrText.trim(), recognizedMetadataText].filter(Boolean).join("\n\n")
        : files
          .map((_, index) => nextMetadataPageTexts[index] == null ? "" : `--- Page ${index + 1} ---\n${nextMetadataPageTexts[index]}`)
          .filter(Boolean)
          .join("\n\n");
      setOcrText(combinedText);

      if (cancelled) {
        setStep("idle");
        setFormatReview({ status: "idle", message: "" });
        setScanNotice(`Scan stopped. ${completedBeforeScan + pages.length} of ${files.length} pages are recognized. Select Run OCR Scan to continue.`);
        return;
      }

      let extractedMetadata = null;
      if ((!hadPreviousText || !meta.title.trim()) && combinedText.trim()) {
        const extracted = await extractMetadata(combinedMetadataText);
        extractedMetadata = extracted;
        setMeta({
          title: extracted.title,
          authors: extracted.authors,
          academicYear: "",
          program: "",
          adviser: extracted.adviser,
          panelMembers: extracted.panelMembers,
          abstract: extracted.abstract,
          keywords: extracted.keywords,
        });
        setSdgTags(suggestMetadata({
          title: extracted.title,
          abstract: extracted.abstract,
          keywords: extracted.keywords,
        }).sdgTags);
        setAiStatus(extracted.aiStatus || "failed");
      } else {
        setSdgTags(suggestMetadata(meta).sdgTags);
      }

      const currentKeywords = extractedMetadata ? extractedMetadata.keywords : meta.keywords;
      if (!String(currentKeywords || "").trim() && combinedMetadataText.trim()) {
        setKeywordSuggestionStatus("loading");
        suggestKeywordsWithAI({
          title: extractedMetadata?.title || meta.title,
          abstract: extractedMetadata?.abstract || meta.abstract,
          text: combinedMetadataText,
        }).then(({ keywords, status }) => {
          setKeywordSuggestions(keywords);
          setKeywordSuggestionStatus(status);
        });
      }

      const formatResult = await reviewPaperFormat(combinedText);
      setFormatReview(formatResult);

      const blankPages = pages.filter((page) => !page.text.trim()).map((page) => page.pageNumber);
      const lowConfidencePages = pages
        .filter((page) => page.confidence !== null && page.confidence < 0.65 && page.text.trim())
        .map((page) => page.pageNumber);
      const scanWarnings = [];
      if (blankPages.length) scanWarnings.push(`No text was detected on page${blankPages.length > 1 ? "s" : ""} ${blankPages.join(", ")}.`);
      if (lowConfidencePages.length) scanWarnings.push(`OCR confidence was low on page${lowConfidencePages.join(", ")}.`);
      if (scanWarnings.length) {
        setScanNotice(`${scanWarnings.join(" ")} Check the page images and correct the extracted text before archiving.`);
      }

      setStep("scanned");
    } catch (error) {
      scanAbortControllerRef.current = null;
      setCanStopScan(false);
      setIsStopping(false);
      setStep("idle");
      setFormatReview({ status: "idle", message: "" });
      setUploadError(error.message || "OCR could not read the selected PDF, DOCX, or image document. Please try again.");
    }
  }

  async function handleArchive(e) {
    e.preventDefault();
    if (!ocrRecordCheck.ok) {
      setUploadError(ocrRecordCheck.message);
      return;
    }
    setStep("saving");
    setUploadError("");
    setSaveProgress({ completed: 0, total: files.length, phase: "preparing" });
    setSaveEstimateSeconds(null);
    saveTimingRef.current = { lastPageAt: Date.now(), pageDurations: [] };
    try {
      await digitizeAndArchive({
        imageFiles: files,
        ocrText,
        title: meta.title,
        authors: meta.authors.split(",").map((a) => a.trim()).filter(Boolean),
        academicYear: meta.academicYear,
        adviser: meta.adviser,
        panelMembers: meta.panelMembers.split(",").map((member) => member.trim()).filter(Boolean),
        abstract: meta.abstract,
        keywords: meta.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        program: meta.program,
        sdgTags,
        adminId: user.id,
        onProgress: ({ phase, completed = 0, total = files.length, bytes = 0 }) => {
          setSaveProgress({ completed, total, phase });
          if (phase === "preparing" && completed > 0) {
            const timing = saveTimingRef.current;
            timing.pageDurations.push(Math.max(1, (Date.now() - timing.lastPageAt) / 1000));
            timing.lastPageAt = Date.now();
            const recent = timing.pageDurations.slice(-5).sort((a, b) => a - b);
            const typicalPageSeconds = recent[Math.floor(recent.length / 2)];
            setSaveEstimateSeconds(Math.ceil(typicalPageSeconds * Math.max(0, total - completed)));
          } else if (phase === "uploading") {
            // Network speed varies, so show a rough estimate and keep the upload stage visible.
            setSaveEstimateSeconds(Math.max(3, Math.ceil(bytes / (512 * 1024))));
          } else if (phase === "saving") {
            setSaveEstimateSeconds(3);
          }
        },
      });
      setStep("done");
    } catch (error) {
      setStep("scanned");
      setUploadError(error.message || "The document could not be saved. Please try again.");
    }
  }

  function resetAll() {
    setFiles([]);
    setPreviews([]);
    setOcrText("");
    setScannedPageTexts([]);
    setScanNotice("");
    setProgress(0);
    setStep("idle");
    setCurrentPage(1);
    setTotalPages(0);
    setDonePages(0);
    setEstimatedSecondsRemaining(null);
    setSaveEstimateSeconds(null);
    setMeta({ title: "", authors: "", academicYear: "", program: "", adviser: "", panelMembers: "", abstract: "", keywords: "" });
    setSdgTags([]);
    setKeywordSuggestions([]);
    setKeywordSuggestionStatus("idle");
    setSaveProgress({ completed: 0, total: 0 });
  }

  function addKeywordSuggestion(suggestion) {
    setMeta((current) => {
      const terms = current.keywords.split(/[;,]+/).map((term) => term.trim()).filter(Boolean);
      if (!terms.some((term) => term.toLowerCase() === suggestion.toLowerCase())) terms.push(suggestion);
      return { ...current, keywords: terms.join(", ") };
    });
    setKeywordSuggestions((current) => current.filter((keyword) => keyword !== suggestion));
  }

  function toggleSdg(id) {
    setSdgTags((current) => current.includes(id)
      ? current.filter((tag) => tag !== id)
      : [...current, id]);
  }

  const stagePreview = previews[currentPage - 1] || previews[0];
  const overallProgressPercent = totalPages > 0
    ? Math.min(100, Math.max(0, Math.round(((donePages + progress) / totalPages) * 100)))
    : 0;
  const ocrRecordCheck = validateOcrResearchRecord({
    ocrText,
    title: meta.title,
    authors: meta.authors,
    adviser: meta.adviser,
    panelMembers: meta.panelMembers,
    abstract: meta.abstract,
    keywords: meta.keywords,
    sdgTags,
  });

  return (
    <Layout>
      <PageHeader
        eyebrow="OCR Digitization"
        title="Digitize a Research Document"
        description="Upload clear, well-lit images or PDF pages from a hardbound paper. OCR extracts the pages you provide, but can miss or misread text; review the scan and correct it before archiving."
      />

      {/* ---------- stepper ---------- */}
      <div className="ocr-stepper">
        {STEPS.map((s, i) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center" }}>
            <div className={`ocr-step ${i === activeIndex ? "is-active" : ""} ${i < activeIndex ? "is-done" : ""}`}>
              <div className="ocr-step-dot">{i < activeIndex ? <Check size={12} /> : i + 1}</div>
              <span className="ocr-step-label">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="ocr-step-connector" style={{ "--fill": i < activeIndex ? 1 : 0 }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          onChange={handleFile}
          style={{ display: "none" }}
        />

        {/* ---------- left: upload / scan stage ---------- */}
        <div className="card card-pad" style={{ flex: "1 1 360px" }}>
          {step !== "scanning" && previews.length === 0 && (
            <>
              <div
                className={`ocr-dropzone ${isDragging ? "is-dragging" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={openFilePicker}
              >
                <div className="ocr-dropzone-icon">
                  <UploadCloud size={20} />
                </div>
                <div className="ocr-dropzone-title">Drop scanned research pages here</div>
                <div className="ocr-dropzone-hint">
                  <Camera size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                  JPG, PNG, PDF, or other image files · choose pages from your computer
                </div>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-block"
                onClick={openFilePicker}
                style={{ marginTop: 12 }}
              >
                <UploadCloud size={14} /> Select files
              </button>
            </>
          )}

          {uploadError && (
            <p className="auth-error" role="alert" style={{ marginTop: 12 }}>
              {uploadError}
            </p>
          )}
          {scanNotice && (
            <p role="status" style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: "var(--info-100)", color: "var(--info-700)", fontSize: 12.5 }}>
              {scanNotice}
            </p>
          )}

          {previews.length > 0 && step !== "scanning" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ fontSize: 13.5 }}>
                  {previews.length} page{previews.length > 1 ? "s" : ""} selected
                </h3>
                <span style={{ fontSize: 11.5, color: "var(--ink-500)" }}>
                  Drag thumbnails to reorder pages. The first visible page is Page 1.
                </span>
               {(step === "idle" || step === "scanned") && (
              <button className="btn btn-ghost btn-sm" onClick={openFilePicker}>
                <UploadCloud size={13} /> Add more
              </button>
              )}
              </div>

              <div className="ocr-thumb-strip">
                {previews.map((src, index) => (
                  <div
                    key={`${src}-${index}`}
                    className={`ocr-thumb ${draggedIndex === index ? "is-dragging" : ""}`}
                    draggable={step === "idle" || step === "scanned"}
                    onDragStart={() => setDraggedIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggedIndex !== null) {
                        reorderPages(draggedIndex, index);
                        setDraggedIndex(null);
                      }
                    }}
                    onDragEnd={() => setDraggedIndex(null)}
                  >
                    <button type="button" className="ocr-thumb-preview" onClick={() => openPreview(index)} aria-label={`Preview page ${index + 1}`} title="Zoom to review this image">
                      <img src={src} alt={`page ${index + 1}`} />
                    </button>
                    <span className="ocr-thumb-page">Pg {index + 1}</span>
                    {(step === "idle" || step === "scanned") && (
              <button className="ocr-thumb-remove" onClick={() => removeFile(index)} aria-label="Remove page">
                <X size={11} />
              </button>
                  )}
                  </div>
                ))}
              </div>
            </>
          )}

          {files.length > 0 && step === "idle" && (
            <button onClick={handleScan} className="btn btn-brass btn-block" style={{ marginTop: 16 }}>
              <ScanLine size={14} /> Run OCR Scan
            </button>
          )}

          {/* ---------- animated scanning stage ---------- */}
          {step === "scanning" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <h3 style={{ fontSize: 13.5 }}>
                  {isStopping ? "Stopping after the current page…" : canStopScan ? "Scanning in progress" : "Preparing metadata..."}
                </h3>
                <button type="button" className="btn btn-danger btn-sm" onClick={handleStopScan} disabled={!canStopScan || isStopping}>
                  <X size={13} /> {isStopping ? "Stopping..." : "Stop scan"}
                </button>
              </div>

              <div className="ocr-scan-stage">
                {stagePreview && <img src={stagePreview} alt={`scanning page ${currentPage}`} />}
                <div className="ocr-scan-grid" />
                <div className="ocr-scan-laser" />
                <div className="ocr-scan-line" />
                <div className="ocr-scan-vignette" />
                <span className="ocr-scan-corner ocr-corner-tl" />
                <span className="ocr-scan-corner ocr-corner-tr" />
                <span className="ocr-scan-corner ocr-corner-bl" />
                <span className="ocr-scan-corner ocr-corner-br" />
                <div className="ocr-scan-badge">
                  <span className="ocr-scan-dot" />
                  Reading text
                </div>
                <span className="ocr-scan-pagelabel">Page {currentPage} of {totalPages}</span>
                <div
                  className="ocr-scan-percent"
                  role="status"
                  aria-label={`Overall scan progress: ${overallProgressPercent}%`}
                >
                  <svg className="ocr-scan-percent-ring" viewBox="0 0 32 32" aria-hidden="true">
                    <circle className="ocr-scan-percent-track" cx="16" cy="16" r="13" />
                    <circle
                      className="ocr-scan-percent-value"
                      cx="16"
                      cy="16"
                      r="13"
                      style={{ strokeDashoffset: `${81.68 * (1 - overallProgressPercent / 100)}` }}
                    />
                  </svg>
                  <span className="ocr-scan-percent-copy">
                    <strong>{overallProgressPercent}%</strong>
                    <span>overall</span>
                  </span>
                </div>
              </div>

              <div className="ocr-progress-track">
                <div className="ocr-progress-fill" style={{ width: `${overallProgressPercent}%` }} />
              </div>
              <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 7 }}>
                Overall progress · {donePages} of {totalPages} pages recognized
              </p>

              <p style={{ fontSize: 12, color: "var(--ink-600)", marginTop: 5 }} role="status" aria-live="polite">
                {estimatedSecondsRemaining === null
                  ? "Estimating time from page scan speed…"
                  : estimatedSecondsRemaining === 0
                    ? "Estimated scan time remaining: finishing up"
                    : `Estimated scan time remaining: about ${estimatedSecondsRemaining < 60
                      ? `${estimatedSecondsRemaining} sec`
                      : `${Math.ceil(estimatedSecondsRemaining / 60)} min`}`}
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>
                  Approximate estimate updates as each page finishes.
                </span>
              </p>

              {previews.length > 1 && (
                <div className="ocr-thumb-strip">
                  {previews.map((src, index) => {
                    const pageNum = index + 1;
                    const isDone = pageNum < currentPage || (pageNum === currentPage && progress >= 1);
                    const isCurrent = pageNum === currentPage && !isDone;
                    return (
                      <div key={`${src}-${index}`} className={`ocr-thumb ${isCurrent ? "is-current" : ""} ${isDone ? "is-done" : ""}`}>
                        <button type="button" className="ocr-thumb-preview" onClick={() => openPreview(index)} aria-label={`Preview page ${pageNum}`} title="Zoom to review this image">
                          <img src={src} alt={`page ${pageNum}`} />
                        </button>
                        {isDone && <span className="ocr-thumb-check"><Check size={10} /></span>}
                        <span className="ocr-thumb-page">Pg {pageNum}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------- right: extracted text ---------- */}
        <div className="card card-pad" style={{ flex: "1 1 360px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <FileText size={14} color="var(--ink-500)" />
            <h3 style={{ fontSize: 13.5 }}>Extracted Raw Text</h3>
          </div>
          {ocrText ? (
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={12}
              placeholder="Extracted text will appear here after scanning."
              className="input ocr-text-panel"
            />
          ) : (
            <div className="ocr-text-empty">
              <div className="ocr-text-empty-icon">
                <BookOpenCheck size={18} />
              </div>
              <div style={{ fontSize: 12.5 }}>
                {step === "scanning"
                  ? "Recognized text will stream in here as each page finishes."
                  : "Run the OCR scan to see recognized text here, editable before archiving."}
              </div>
            </div>
          )}
        </div>
      </div>

      {previewIndex !== null && previews[previewIndex] && (
        <div className="ocr-preview-modal" role="dialog" aria-modal="true" aria-label={`Preview page ${previewIndex + 1}`}>
          <div className="ocr-preview-toolbar">
            <span>Page {previewIndex + 1} of {previews.length}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Zoom out">
                <ZoomOut size={14} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewZoom(1)}>Reset</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.25))} aria-label="Zoom in">
                <ZoomIn size={14} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewIndex(null)} aria-label="Close preview">
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="ocr-preview-canvas" onClick={(event) => { if (event.target === event.currentTarget) setPreviewIndex(null); }}>
            <img src={previews[previewIndex]} alt={`Expanded page ${previewIndex + 1}`} style={{ transform: `scale(${previewZoom})` }} />
          </div>
        </div>
      )}

      {/* ---------- metadata review ---------- */}
      {(step === "scanned" || step === "saving") && (
        <form onSubmit={handleArchive} className="card card-pad" style={{ marginTop: 20, maxWidth: 680, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} color="var(--brass-600)" />
            <h3 style={{ fontSize: 13.5 }}>Auto-Suggested Metadata</h3>
            <span className="ocr-ai-tag"><Sparkles size={9} /> AI extracted</span>
          </div>
          {aiStatus !== "ok" && aiStatus !== "idle" && (
            <div className="metadata-analysis error" role="status">
              AI extraction unavailable — fields below were parsed with basic pattern matching and may need more manual correction than usual.
            </div>
          )}
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: -8 }}>
            Fields below were parsed from the title page. Please review and correct before archiving.
          </p>

          {!ocrRecordCheck.ok && (
            <div className="metadata-analysis error" role="alert" aria-live="polite">
              <strong>Cannot archive this scan yet</strong>
              <span>{ocrRecordCheck.message}</span>
              <small>Correct the extracted text and metadata, or upload a readable research paper.</small>
            </div>
          )}
          {ocrRecordCheck.ok && ocrRecordCheck.warning && (
            <div className="metadata-analysis" role="status" aria-live="polite">
              <strong>Review SDG alignment</strong>
              <span>{ocrRecordCheck.warning}</span>
            </div>
          )}

          {formatReview.status !== "idle" && (
            <div
              className={`metadata-analysis${formatReview.status === "checking" ? " analyzing" : formatReview.status === "different" ? " error" : ""}`}
              role="status"
              aria-live="polite"
            >
              <strong>
                {formatReview.status === "checking"
                  ? "Checking paper format…"
                  : formatReview.status === "different"
                    ? "Format differs from archived papers"
                    : formatReview.status === "match"
                      ? "Paper format check"
                      : formatReview.status === "insufficient"
                        ? "Format comparison needs more text"
                        : "Format comparison unavailable"}
              </strong>
              <span>{formatReview.message}</span>
              {formatReview.comparedPapers > 0 && <small>Compared with {formatReview.comparedPapers} archived papers.</small>}
            </div>
          )}

          <Field label={<span><PenLine size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Title</span>}>
            <input className="input" value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} required />
          </Field>

          <div className="ocr-field-grid">
            <Field label={<span><Users size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Authors (comma-separated)</span>}>
              <input className="input" value={meta.authors} onChange={handleAuthorsChange} required />
            </Field>
            <Field label={<span><GraduationCap size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Adviser</span>}>
              <input className="input" value={meta.adviser} onChange={(e) => setMeta((m) => ({ ...m, adviser: e.target.value }))} />
            </Field>
          </div>

          <Field label={<span><Users size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Panel Members, including the chair (3 total; comma-separated)</span>}>
            <input className="input" value={meta.panelMembers} onChange={(e) => setMeta((m) => ({ ...m, panelMembers: e.target.value }))} />
          </Field>

          <Field label={<span><Quote size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Abstract</span>}>
            <textarea className="input" rows={3} value={meta.abstract} onChange={(e) => setMeta((m) => ({ ...m, abstract: e.target.value }))} />
          </Field>

          <div className="ocr-field-grid">
            <Field label={<span><Tags size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Keywords (comma-separated)</span>}>
              <input className="input" value={meta.keywords} onChange={(e) => setMeta((m) => ({ ...m, keywords: e.target.value }))} />
            </Field>
            <Field label={<span><CalendarDays size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Academic year</span>}>
              <select className="input" value={meta.academicYear} onChange={(e) => setMeta((m) => ({ ...m, academicYear: e.target.value }))} required>
                <option value="">Select academic year</option>
                {academicYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={<span><GraduationCap size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Program</span>}>
            <select className="input" value={meta.program} onChange={(e) => setMeta((m) => ({ ...m, program: e.target.value }))} required>
              <option value="">Select program</option>
              {PROGRAM_OPTIONS.map((program) => (
                <option key={program.value} value={program.value}>{program.label}</option>
              ))}
            </select>
          </Field>

          <Field label={<span><Tags size={11} style={{ verticalAlign: -1, marginRight: 4 }} />SDG alignment (auto-detected; adjust as needed)</span>}>
            <div className="sdg-grid">
              {SDG_LIST.map((sdg) => (
                <button type="button" key={sdg.id} onClick={() => toggleSdg(sdg.id)} className={`sdg-chip${sdgTags.includes(sdg.id) ? " selected" : ""}`} aria-pressed={sdgTags.includes(sdg.id)}>
                  <span className="sdg-chip-num">{sdg.id}</span>
                  {sdg.title}
                </button>
              ))}
            </div>
          </Field>

          {!meta.keywords.trim() && keywordSuggestionStatus !== "idle" && (
            <div className={`metadata-analysis${keywordSuggestionStatus === "loading" ? " analyzing" : keywordSuggestionStatus === "unavailable" ? " error" : ""}`} role="status" aria-live="polite">
              <strong>AI keyword suggestions</strong>
              <span>
                {keywordSuggestionStatus === "loading"
                  ? "Finding terms relevant to this paper…"
                  : keywordSuggestionStatus === "unavailable"
                    ? "Suggestions are unavailable right now. You can enter keywords manually."
                    : keywordSuggestionStatus === "empty"
                      ? "No relevant suggestions were returned. You can enter keywords manually."
                      : "Review and add only the terms that fit this paper."}
              </span>
              {keywordSuggestions.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {keywordSuggestions.map((keyword) => (
                    <button key={keyword} type="button" className="btn btn-outline btn-sm" onClick={() => addKeywordSuggestion(keyword)}>
                      <Plus size={13} /> {keyword}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button type="submit" disabled={step === "saving" || !ocrRecordCheck.ok} className="btn btn-primary" style={{ marginTop: 4 }}>
            {step === "saving"
              ? saveProgress.phase === "checking"
                ? "Checking for similar topics..."
                : saveProgress.phase === "uploading"
                  ? "Uploading manuscript..."
                  : saveProgress.phase === "saving"
                    ? "Finishing archive..."
                    : `Preparing page ${saveProgress.completed} of ${saveProgress.total}...`
              : <>Save to Repository <ArrowRight size={14} /></>}
          </button>
          {step === "saving" && saveProgress.total > 0 && (
            <>
              <p role="status" aria-live="polite" style={{ color: "var(--ink-600)", fontSize: 12, margin: "0 0 8px" }}>
                {saveProgress.phase === "checking"
                  ? "Checking this topic against existing research…"
                  : saveProgress.phase === "uploading"
                    ? "Uploading the manuscript to the research archive…"
                    : saveProgress.phase === "saving"
                      ? "Finishing the archive record…"
                      : `Preparing page ${saveProgress.completed} of ${saveProgress.total} for the archive…`}
                <span style={{ display: "block", color: "var(--ink-500)", fontSize: 11, marginTop: 3 }}>
                  {saveEstimateSeconds === null
                    ? "Estimating save time…"
                    : `Estimated time remaining: about ${saveEstimateSeconds < 60 ? `${saveEstimateSeconds} sec` : `${Math.ceil(saveEstimateSeconds / 60)} min`}. This is approximate.`}
                </span>
              </p>
              {saveProgress.phase === "preparing" && <div className="ocr-progress-track" style={{ marginTop: -4 }}>
              <div
                className="ocr-progress-fill"
                style={{ width: `${Math.round((saveProgress.completed / saveProgress.total) * 100)}%` }}
              />
              </div>}
            </>
          )}
        </form>
      )}

      {/* ---------- success ---------- */}
      {step === "done" && (
        <div className="card card-pad" style={{ marginTop: 20, maxWidth: 680, display: "flex", alignItems: "center", gap: 14 }}>
          <div className="ocr-success-icon">
            <Check size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14.5, marginBottom: 3 }}>Document digitized and archived</h3>
            <p style={{ fontSize: 12.5, color: "var(--ink-500)" }}>
              "{meta.title || "Untitled document"}" is now searchable in the repository.
            </p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={resetAll}>
            <RotateCcw size={13} /> Scan another
          </button>
        </div>
      )}
    </Layout>
  );
}
