import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  AlertTriangle,
  UploadCloud,
  CheckCircle2,
  FileText,
  Tag as TagIcon,
  Paperclip,
  ShieldCheck,
  X,
} from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, Field } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { submitResearch } from "../../services/research";
import ResearchFileActions from "../../components/ResearchFileActions";
import { checkResearchDuplicate, searchResearch } from "../../services/search";
import { analyzeResearchDocumentWithAI, sanitizeResearchTitle, suggestMetadata } from "../../services/metadataSuggestions";
import { SDG_LIST } from "../../lib/sdgList";
import { PROGRAM_OPTIONS } from "../../lib/programs";
import { wrapReceiptValue } from "../../lib/receiptFormatting";
import { getAcademicYears } from "../../services/academicYears";
import { useUnloadWarning } from "../../lib/useUnloadWarning";
import { validateResearchUploadFile, MAX_RESEARCH_UPLOAD_SIZE_LABEL } from "../../lib/researchUploadValidation";
import { classifyResearchDocument, getDocumentConfidenceLabel, getDocumentTypeMismatchError, getExpectedDocumentType, DOCUMENT_CONFIDENCE } from "../../lib/researchDocumentType";
import { analyzeSubmissionFileOnce, clearSubmissionDraft, loadSubmissionDraft, saveSubmissionDraft } from "../../lib/submissionDraftStore";

function buildDefaultForm(profile) {
  return {
    title: "",
    abstract: "",
    authors: "",
    adviser: "",
    academicYear: "",
    semester: "1st Semester",
    program: profile?.program || "",
    keywords: "",
  };
}

export default function Submit() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const draftLoadSequence = useRef(0);
  const draftSaveSequence = useRef(0);
  const draftSaveQueue = useRef(Promise.resolve());
  const draftRevision = useRef(null);
  const skipDraftSaveOnce = useRef(false);
  const [draftStateOwner, setDraftStateOwner] = useState(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState("loading");
  const [form, setForm] = useState(() => buildDefaultForm(profile));
  const [sdgTags, setSdgTags] = useState([]);
  const [files, setFiles] = useState({ manuscript: null, sourceCode: null, ieee: null, acm: null, apa: null });
  const [detachedFiles, setDetachedFiles] = useState({});
  const [manuscriptText, setManuscriptText] = useState("");
  const [documentTexts, setDocumentTexts] = useState({});
  const [manuscriptSource, setManuscriptSource] = useState("digital");
  const [status, setStatus] = useState("idle"); // idle | submitting | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const [related, setRelated] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [documentAnalysis, setDocumentAnalysis] = useState({ status: "idle", message: "" });
  const [documentChecks, setDocumentChecks] = useState({});
  const [fileErrors, setFileErrors] = useState({});
  const analysisIds = useRef({});
  const [submittedPaper, setSubmittedPaper] = useState(null);
  const [academicYears, setAcademicYears] = useState([]);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const defaultForm = buildDefaultForm(profile);
  const hasFormChanges = Object.entries(form).some(([field, value]) => (
    Boolean(value?.trim()) && value !== defaultForm[field]
  ));
  const hasUnsavedSubmission = status !== "done" && (
    hasFormChanges
    || Object.values(files).some(Boolean)
    || Object.values(detachedFiles).some(Boolean)
    || Object.values(fileErrors).some(Boolean)
    || sdgTags.length > 0
    || Boolean(manuscriptText.trim())
  );
  useUnloadWarning(hasUnsavedSubmission);

  useEffect(() => {
    const ownerId = user?.id || null;
    const sequence = ++draftLoadSequence.current;
    setDraftStateOwner(null);
    setDraftSaveStatus(ownerId ? "loading" : "idle");
    Object.keys(analysisIds.current).forEach(nextAnalysisId);
    if (!ownerId) return;

    loadSubmissionDraft(ownerId).then((draft) => {
      if (sequence !== draftLoadSequence.current) return;
      skipDraftSaveOnce.current = true;
      setForm({ ...buildDefaultForm(profile), ...(draft?.form || {}) });
      setSdgTags(draft?.sdgTags || []);
      setFiles(draft?.files || { manuscript: null, sourceCode: null, ieee: null, acm: null, apa: null });
      setDetachedFiles(draft?.detachedFiles || {});
      setManuscriptText(draft?.manuscriptText || "");
      // Older drafts may contain a manually selected record type. Restore the
      // type from the automatic analysis result instead.
      setManuscriptSource(draft?.documentAnalysis?.message?.startsWith("Scanned PDF detected.") ? "ocr_scanned" : "digital");
      setStatus(draft?.status || "idle");
      setErrorMsg(draft?.errorMsg || "");
      setSuggestions(draft?.suggestions || null);
      setDocumentAnalysis(draft?.documentAnalysis || { status: "idle", message: "" });
      setDocumentChecks(draft?.documentChecks || {});
      setFileErrors(draft?.fileErrors || {});
      setDraftSaveStatus(draft ? "restored" : "idle");
      draftRevision.current = draft ? `${draft.updatedAt}:${draft.writerId}` : null;
      setDraftStateOwner(ownerId);
    }).catch(() => {
      if (sequence !== draftLoadSequence.current) return;
      setDraftSaveStatus("unavailable");
      setDraftStateOwner(ownerId);
    });
    return () => {
      if (draftLoadSequence.current === sequence) draftLoadSequence.current += 1;
    };
  }, [user?.id, profile]);

  useEffect(() => {
    if (!user?.id || draftStateOwner !== user.id || status === "done" || !hasUnsavedSubmission) return;
    if (skipDraftSaveOnce.current) {
      skipDraftSaveOnce.current = false;
      return;
    }
    setDraftSaveStatus("saving");
    const saveSequence = ++draftSaveSequence.current;
    const snapshot = {
      form,
      sdgTags,
      files,
      detachedFiles,
      manuscriptText,
      manuscriptSource,
      status,
      errorMsg,
      suggestions,
      documentAnalysis,
      documentChecks,
      fileErrors,
    };
    // Persist each committed form state immediately. A debounce timer is cleared
    // when this route unmounts, which can lose an upload on a quick navigation.
    // Serialize writes so successive React updates use the latest revision.
    draftSaveQueue.current = draftSaveQueue.current.catch(() => {}).then(async () => {
      if (user?.id !== draftStateOwner) return;
      const result = await saveSubmissionDraft(user.id, snapshot, Date.now(), draftRevision.current);
      if (result.saved) draftRevision.current = result.revision;
      if (
        saveSequence !== draftSaveSequence.current
        || user?.id !== result?.userId
      ) return;
        setDraftSaveStatus(result.conflict ? "conflict" : result.persistent ? (result.saved ? "saved" : "restored") : "unavailable");
    });
  }, [
    user?.id, draftStateOwner, hasUnsavedSubmission, form, sdgTags, files, detachedFiles, manuscriptText, manuscriptSource,
    status, errorMsg, suggestions, documentAnalysis, documentChecks, fileErrors,
  ]);

  useEffect(() => {
    getAcademicYears({ activeOnly: true })
      .then((items) => setAcademicYears(items.map((year) => year.label)))
      .catch(() => setAcademicYears([]));
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      program: current.program || profile?.program || "",
    }));
  }, [profile]);

  // AI-Assisted Search Module: proactively surface similar existing studies
  // as the student types a title, so they can avoid duplicating a topic
  // that's already in the department archive.
  useEffect(() => {
    if (form.title.trim().length < 8) {
      setRelated([]);
      return;
    }
    const timeout = setTimeout(() => {
      searchResearch(form.title).then((results) => setRelated(results.slice(0, 3)));
    }, 500);
    return () => clearTimeout(timeout);
  }, [form.title]);

  useEffect(() => {
    if (form.title.trim().length < 8 && form.abstract.trim().length < 30) {
      setSuggestions(null);
      return;
    }
    setSuggestions(suggestMetadata(form));
  }, [form.title, form.abstract, form.keywords]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  // Keywords is a comma-separated field — auto-insert a space right after a
  // typed comma so the list reads "AI, machine learning" without the user
  // having to type the space themselves. Only kicks in while typing forward
  // (inputType !== delete*), so backspacing to edit/remove text still works
  // normally instead of the space fighting the user's deletion.
  function handleKeywordsChange(e) {
    const { value } = e.target;
    const inputType = e.nativeEvent?.inputType || "";
    if (!inputType.startsWith("delete") && value.endsWith(",")) {
      setForm((f) => ({ ...f, keywords: value + " " }));
      return;
    }
    setForm((f) => ({ ...f, keywords: value }));
  }

  function toggleSdg(id) {
    setSdgTags((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function applySuggestions() {
    if (!suggestions) return;
    const suggestedKeywords = Array.isArray(suggestions.keywords)
      ? suggestions.keywords
      : suggestions.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean);
    setForm((current) => ({
      ...current,
      keywords: current.keywords || suggestedKeywords.join(", "),
    }));
    setSdgTags((current) => [...new Set([...current, ...suggestions.sdgTags])]);
  }

  function nextAnalysisId(slot) {
    analysisIds.current[slot] = (analysisIds.current[slot] || 0) + 1;
    return analysisIds.current[slot];
  }

  async function analyzeUploadedDocument(slot, file, analysisId) {
    if (!file) {
      setDocumentChecks((current) => { const next = { ...current }; delete next[slot]; return next; });
      setDocumentTexts((current) => { const next = { ...current }; delete next[slot]; return next; });
      if (slot === "manuscript") {
        setManuscriptText("");
        setManuscriptSource("digital");
        setDocumentAnalysis({ status: "idle", message: "" });
      }
      return;
    }

    const expectedType = getExpectedDocumentType(slot);
    if (slot === "manuscript") setManuscriptSource("digital");
    if (slot === "sourceCode") {
      setDocumentChecks((current) => ({ ...current, [slot]: { status: "valid", expectedType } }));
      return;
    }
    setDocumentChecks((current) => ({ ...current, [slot]: { status: "analyzing", expectedType } }));
    if (slot === "manuscript") setDocumentAnalysis({ status: "analyzing", message: "Reading the manuscript and generating metadata..." });

    try {
      const analysis = await analyzeSubmissionFileOnce(file, analyzeResearchDocumentWithAI);
      if (analysisIds.current[slot] !== analysisId) return;
      const classification = classifyResearchDocument(analysis.extractedText || "");
      setDocumentChecks((current) => ({ ...current, [slot]: { ...classification, status: "done", expectedType } }));
      setDocumentTexts((current) => ({ ...current, [slot]: analysis.extractedText || "" }));
      if (slot !== "manuscript") return;

      setManuscriptText(analysis.extractedText || "");
      setManuscriptSource(analysis.manuscriptSource === "ocr_scanned" ? "ocr_scanned" : "digital");
      setForm((current) => ({
        ...current,
        title: sanitizeResearchTitle(analysis.title) || current.title,
        abstract: analysis.abstract || current.abstract,
        keywords: analysis.keywords || current.keywords,
        authors: Array.isArray(analysis.authors) ? analysis.authors.join(", ") : analysis.authors || current.authors,
        adviser: analysis.adviser || current.adviser,
      }));
      setSdgTags((current) => [...new Set([...current, ...analysis.sdgTags])]);
      setSuggestions(analysis);
      setDocumentAnalysis({
        status: "done",
        message: analysis.manuscriptSource === "ocr_scanned"
          ? `Scanned PDF detected. This submission will be filed as OCR Scanned.`
          : `AI-assisted metadata generated: ${analysis.category}.`,
      });
    } catch (error) {
      if (analysisIds.current[slot] !== analysisId) return;
      setDocumentChecks((current) => ({ ...current, [slot]: { type: "Unknown / Cannot Determine", confidence: 0.45, status: "done", expectedType } }));
      setDocumentTexts((current) => ({ ...current, [slot]: "" }));
      if (slot === "manuscript") {
        setManuscriptText("");
        setManuscriptSource("digital");
        setDocumentAnalysis({ status: "error", message: `Could not analyze this document automatically. You can enter the metadata manually. ${error.message}` });
      }
    }
  }

  useEffect(() => {
    Object.entries(files).forEach(([slot, file]) => {
      const analysisWasInterrupted = documentChecks[slot]?.status === "analyzing"
        || (slot === "manuscript" && documentAnalysis.status === "analyzing");
      if (file && slot !== "sourceCode" && analysisWasInterrupted) {
        analyzeUploadedDocument(slot, file, nextAnalysisId(slot));
      }
    });
  }, []);

  function handleFileChange(slot, file) {
    setFiles((current) => ({ ...current, [slot]: file }));
    setDetachedFiles((current) => { const next = { ...current }; delete next[slot]; return next; });
    setFileErrors((current) => ({ ...current, [slot]: "" }));
    analyzeUploadedDocument(slot, file, nextAnalysisId(slot));
  }

  function handleFileError(slot, message) {
    setFileErrors((current) => ({ ...current, [slot]: message }));
  }

  function handleClearForm() {
    if (status === "submitting") return;
    setClearConfirmOpen(true);
  }

  function confirmClearForm() {
    if (user?.id) void clearSubmissionDraft(user.id);
    draftSaveSequence.current += 1;
    draftRevision.current = null;
    Object.keys(files).forEach(nextAnalysisId);
    setForm(buildDefaultForm(profile));
    setSdgTags([]);
    setFiles({ manuscript: null, sourceCode: null, ieee: null, acm: null, apa: null });
    setDetachedFiles({});
    setManuscriptText("");
    setDocumentTexts({});
    setManuscriptSource("digital");
    setStatus("idle");
    setErrorMsg("");
    setRelated([]);
    setSuggestions(null);
    setDocumentAnalysis({ status: "idle", message: "" });
    setDocumentChecks({});
    setFileErrors({});
    setSubmittedPaper(null);
    setClearConfirmOpen(false);
  }

  function getSuggestedKeywords() {
    if (!suggestions?.keywords) return [];
    return Array.isArray(suggestions.keywords)
      ? suggestions.keywords
      : suggestions.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const uploadSlots = { manuscript: files.manuscript, sourceCode: files.sourceCode, ieee: files.ieee, acm: files.acm, apa: files.apa };
    for (const [slot, file] of Object.entries(uploadSlots)) {
      const fileError = validateResearchUploadFile(file, slot);
      if (fileError) {
        setStatus("error");
        setErrorMsg(fileError);
        return;
      }
      const check = documentChecks[slot];
      if (file && slot !== "sourceCode" && check?.status === "analyzing") {
        setStatus("error");
        setErrorMsg("Please wait for document analysis to finish before submitting.");
        return;
      }
      if (file && check?.type && check.type !== check.expectedType) {
        const mismatchError = getDocumentTypeMismatchError(check, slot);
        if (mismatchError) {
          setStatus("error");
          setErrorMsg(mismatchError);
          return;
        }
      }
    }
    setStatus("submitting");
    setErrorMsg("");
    try {
      await checkResearchDuplicate({
        title: form.title,
        abstract: suggestions?.abstract || form.abstract,
        keywords: form.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
        documentText: manuscriptText,
      });

      const result = await submitResearch({
        title: form.title,
        abstract: form.abstract,
        authors: form.authors.split(",").map((a) => a.trim()).filter(Boolean),
        adviser: form.adviser,
        academicYear: form.academicYear,
        semester: form.semester,
        program: form.program,
        keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        sdgTags,
        category: suggestions?.category || "Computer Studies",
        manuscriptFile: files.manuscript,
        manuscriptText,
        documentTexts,
        manuscriptSource,
        sourceCodeFile: files.sourceCode,
        ieeeFile: files.ieee,
        acmFile: files.acm,
        apaFile: files.apa,
        userId: user.id,
      });
      await clearSubmissionDraft(user.id);
      draftRevision.current = null;
      setDraftSaveStatus("idle");
      setSubmittedPaper(result);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message);
    }
  }

  function downloadReceipt() {
    if (!submittedPaper) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const now = new Date(submittedPaper.created_at || Date.now());

    doc.setFontSize(18);
    doc.text("Confirmation Receipt", 42, 48);

    doc.setFontSize(11);
    let y = 80;
    const lines = [
      ["Research title:", submittedPaper.title || form.title],
      ["Submitted by:", profile?.full_name || user?.full_name || "Student"],
      ["Program:", form.program || "—"],
      ["Academic year:", form.academicYear || "—"],
      ["Semester:", form.semester || "—"],
      ["Adviser:", form.adviser || "—"],
      ["Authors:", form.authors || "—"],
      ["Keywords:", form.keywords || "—"],
      ["Submitted on:", now.toLocaleString()],
      ["Status:", "Pending Review"],
    ];

    lines.forEach(([label, value]) => {
      const wrappedValue = wrapReceiptValue(value, 36);
      doc.setFont(undefined, "bold");
      doc.text(label, 42, y);
      doc.setFont(undefined, "normal");

      wrappedValue.forEach((line, index) => {
        doc.text(String(line), 150, y + index * 14, { maxWidth: 300 });
      });

      y += Math.max(18, wrappedValue.length * 14);
    });

    doc.setFont(undefined, "bold");
    doc.text("This receipt confirms that your research submission has been received.", 42, y + 20, { maxWidth: 470 });
    doc.save(`confirmation-receipt-${(submittedPaper.title || "submission").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`);
  }

  if (status === "done") {
    return (
      <Layout>
        <div style={{ maxWidth: 1040, margin: "0 auto" }}>
          <div
            className="card card-pad"
            style={{
              background: "var(--success-100)",
              border: "1px solid #cbe6d1",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "var(--success-600)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <CheckCircle2 size={20} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{ color: "var(--success-700)", fontSize: 17 }}>Submission received</h2>
              <p style={{ color: "var(--success-700)", marginTop: 6, fontSize: 13.5 }}>
                Your research has been submitted and is now pending review. A confirmation receipt is
                ready below for your records.
              </p>

              <div
                className="card"
                style={{
                  marginTop: 16,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 12.5, color: "var(--ink-700)", fontWeight: 700, marginBottom: 8 }}>
                  Confirmation receipt
                </div>

                <div style={{ display: "grid", gap: 6, fontSize: 12.5, color: "var(--ink-700)" }}>
                  <div><strong>Title:</strong> {submittedPaper?.title || form.title}</div>
                  <div><strong>Submitted on:</strong> {submittedPaper?.created_at ? new Date(submittedPaper.created_at).toLocaleString() : new Date().toLocaleString()}</div>
                  <div><strong>Status:</strong> Pending Review</div>
                </div>
              </div>

              {(submittedPaper?.file_url || submittedPaper?.source_code_url || submittedPaper?.ieee_paper_url || submittedPaper?.acm_paper_url || submittedPaper?.apa_paper_url) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
                  {submittedPaper?.file_url && (
                    <ResearchFileActions paper={submittedPaper} field="file_url" label="manuscript" />
                  )}
                  {submittedPaper?.source_code_url && (
                    <a href={submittedPaper.source_code_url} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      View source code
                    </a>
                  )}
                  {submittedPaper?.ieee_paper_url && (
                    <ResearchFileActions paper={submittedPaper} field="ieee_paper_url" label="IEEE short paper" />
                  )}
                  {submittedPaper?.acm_paper_url && (
                    <ResearchFileActions paper={submittedPaper} field="acm_paper_url" label="ACM style paper" />
                  )}
                  {submittedPaper?.apa_paper_url && (
                    <ResearchFileActions paper={submittedPaper} field="apa_paper_url" label="APA style paper" />
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
                <button type="button" className="btn btn-primary" onClick={downloadReceipt}>
                  Download receipt
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => navigate(profile?.role === "faculty" ? "/faculty" : "/student")}
                >
                  Return to dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Lightweight progress signal for the sidebar checklist — purely visual,
  // doesn't gate submission (required fields already handle validation).
  const stepsDone = {
    details: form.title.trim().length > 0 && form.abstract.trim().length > 0,
    classification: sdgTags.length > 0 && form.keywords.trim().length > 0,
    files: Boolean(files.manuscript),
  };
  const ieeeAttachmentOnly = Boolean(files.ieee && !files.manuscript);

  return (
    <Layout>
      <PageHeader
        eyebrow="Research Submission"
        title="Submit Research"
        description="Fill in your research details, tag applicable SDGs, and upload your files for review."
      />

      <div className="submit-layout">
        <form onSubmit={handleSubmit} className="card submit-form">
          <div className="form-section">
            <div className="form-section-head">
              <div className="form-section-icon">
                <FileText size={15} />
              </div>
              <div>
                <div className="form-section-title">Research details</div>
                <div className="form-section-hint">Title, authorship, and academic context</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Research title">
                <input className="input" value={form.title} onChange={update("title")} required />
              </Field>
              <Field label="Abstract">
                <textarea className="input" value={form.abstract} onChange={update("abstract")} required={!ieeeAttachmentOnly} rows={4} />
              </Field>
              <Field label="Authors (comma-separated)">
                <input className="input" value={form.authors} onChange={update("authors")} required={!ieeeAttachmentOnly} />
              </Field>
              <Field label="Adviser">
                <input className="input" value={form.adviser} onChange={update("adviser")} />
              </Field>

              <div className="form-grid-2">
                <Field label="Academic year">
                  <select className="input" value={form.academicYear} onChange={update("academicYear")} required={!ieeeAttachmentOnly}>
                    <option value="">Select academic year</option>
                    {academicYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Semester">
                  <select className="input" value={form.semester} onChange={update("semester")}>
                    <option>1st Semester</option>
                    <option>2nd Semester</option>
                    <option>Summer</option>
                  </select>
                </Field>
              </div>

              <Field label="Program">
                <select className="input" value={form.program} onChange={update("program")} required={!ieeeAttachmentOnly}>
                  <option value="">Select program</option>
                  {PROGRAM_OPTIONS.map((program) => (
                    <option key={program.value} value={program.value}>{program.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <div className="form-section-icon">
                <TagIcon size={15} />
              </div>
              <div>
                <div className="form-section-title">Classification</div>
                <div className="form-section-hint">Keywords and applicable SDGs</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {suggestions && (getSuggestedKeywords().length > 0 || suggestions.sdgTags.length > 0) && (
                <div className="metadata-suggestion">
                  <div>
                    <strong>Suggested classification</strong>
                    <span>{suggestions.category}</span>
                  </div>
                  <p>
                    {getSuggestedKeywords().length > 0 ? `Keywords: ${getSuggestedKeywords().join(", ")}` : "Review the suggested SDG tags below."}
                  </p>
                  {suggestions.sdgNames.length > 0 && <p>SDGs: {suggestions.sdgNames.join(", ")}</p>}
                  <button type="button" className="btn btn-outline btn-sm" onClick={applySuggestions}>Apply suggestions</button>
                </div>
              )}
              <Field label="Keywords (comma-separated)">
                <input className="input" value={form.keywords} onChange={handleKeywordsChange} />
              </Field>

              <Field label="SDG classification">
                <div className="sdg-grid">
                  {SDG_LIST.map((sdg) => (
                    <button
                      type="button"
                      key={sdg.id}
                      onClick={() => toggleSdg(sdg.id)}
                      className={`sdg-chip${sdgTags.includes(sdg.id) ? " selected" : ""}`}
                    >
                      <span className="sdg-chip-num">{sdg.id}</span>
                      {sdg.title}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <div className="form-section-icon">
                <Paperclip size={15} />
              </div>
              <div>
                <div className="form-section-title">Files &amp; attachments</div>
                <div className="form-section-hint">Manuscript is required; other files are optional · up to {MAX_RESEARCH_UPLOAD_SIZE_LABEL} per file. Scanned PDFs are automatically filed as OCR Scanned; other manuscripts are Digital Research.</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Manuscript (PDF or DOCX)">
                <Dropzone
                  accept=".pdf,.docx"
                  slot="manuscript"
                  file={files.manuscript}
                  previousFile={detachedFiles.manuscript}
                  onRemovePrevious={() => handleFileChange("manuscript", null)}
                  required={!files.ieee}
                  error={fileErrors.manuscript}
                  check={documentChecks.manuscript}
                  analysisMessage={documentAnalysis.message}
                  analysisStatus={documentAnalysis.status}
                  onError={(message) => handleFileError("manuscript", message)}
                  onChange={(file) => handleFileChange("manuscript", file)}
                  hint="Full research paper, PDF or DOCX. Leave this empty to attach an IEEE version to an existing title."
                />
              </Field>
              <Field label="Source code (zip)">
                <Dropzone
                  accept=".zip"
                  slot="sourceCode"
                  file={files.sourceCode}
                  previousFile={detachedFiles.sourceCode}
                  onRemovePrevious={() => handleFileChange("sourceCode", null)}
                  error={fileErrors.sourceCode}
                  check={documentChecks.sourceCode}
                  onError={(message) => handleFileError("sourceCode", message)}
                  onChange={(file) => handleFileChange("sourceCode", file)}
                  hint="Optional — zipped project files"
                />
              </Field>
              <Field label="IEEE short paper (PDF)">
                <Dropzone
                  accept=".pdf"
                  slot="ieee"
                  file={files.ieee}
                  previousFile={detachedFiles.ieee}
                  onRemovePrevious={() => handleFileChange("ieee", null)}
                  error={fileErrors.ieee}
                  check={documentChecks.ieee}
                  onError={(message) => handleFileError("ieee", message)}
                  onChange={(file) => handleFileChange("ieee", file)}
                  hint="Optional — upload with the same title to attach it to an existing research record"
                />
              </Field>
              <Field label="ACM style paper (PDF)">
                <Dropzone
                  accept=".pdf"
                  slot="acm"
                  file={files.acm}
                  previousFile={detachedFiles.acm}
                  onRemovePrevious={() => handleFileChange("acm", null)}
                  error={fileErrors.acm}
                  check={documentChecks.acm}
                  onError={(message) => handleFileError("acm", message)}
                  onChange={(file) => handleFileChange("acm", file)}
                  hint="Optional — ACM conference-format paper"
                />
              </Field>
              <Field label="APA style paper (PDF)">
                <Dropzone
                  accept=".pdf"
                  slot="apa"
                  file={files.apa}
                  previousFile={detachedFiles.apa}
                  onRemovePrevious={() => handleFileChange("apa", null)}
                  error={fileErrors.apa}
                  check={documentChecks.apa}
                  onError={(message) => handleFileError("apa", message)}
                  onChange={(file) => handleFileChange("apa", file)}
                  hint="Optional — APA academic paper"
                />
              </Field>
            </div>
          </div>

          <div className="form-section-foot">
            <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
              {draftSaveStatus !== "idle" && (
                <div role="status" style={{ marginBottom: 6 }}>
                  {draftSaveStatus === "loading" && "Loading saved draft…"}
                  {draftSaveStatus === "saving" && "Saving draft locally…"}
                  {draftSaveStatus === "saved" && "Draft saved on this device."}
                  {draftSaveStatus === "restored" && "Draft restored; selected files are ready."}
                  {draftSaveStatus === "conflict" && "A newer draft exists in another tab. Reload this page to continue from the latest saved draft."}
                  {draftSaveStatus === "unavailable" && "Local draft storage is unavailable. Keep this page open to retain selected files."}
                </div>
              )}
              {errorMsg ? (
                <div className="auth-error" role="alert" style={{ margin: 0 }}>
                  <div>{errorMsg}</div>
                  {errorMsg.includes("manuscript file has already been submitted") && (
                    <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => navigate("/student/submissions")}>
                      Open My Submissions
                    </button>
                  )}
                </div>
              ) : (
                "Your adviser and the review committee will be notified once submitted."
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-outline" onClick={handleClearForm} disabled={status === "submitting" || (!hasUnsavedSubmission && status === "idle")}>Clear Form</button>
              <button type="submit" disabled={status === "submitting" || documentAnalysis.status === "analyzing"} className="btn btn-primary">
                {status === "submitting" ? "Submitting..." : documentAnalysis.status === "analyzing" ? "Reading manuscript..." : "Submit Research"}
              </button>
            </div>
          </div>
        </form>

        {clearConfirmOpen && (
          <div
            className="logout-dialog-backdrop"
            role="presentation"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setClearConfirmOpen(false); }}
          >
            <div className="logout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-submission-title" aria-describedby="clear-submission-description">
              <div className="logout-dialog-icon"><AlertTriangle size={18} /></div>
              <div>
                <h2 id="clear-submission-title">Are you sure you want to clear this submission?</h2>
                <p id="clear-submission-description">This permanently clears the unsent form and its uploaded files from this device. It does not delete an existing research record.</p>
              </div>
              <div className="logout-dialog-actions">
                <button type="button" className="btn btn-outline" onClick={() => setClearConfirmOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-danger" onClick={confirmClearForm}>Yes, clear submission</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
          {related.length > 0 && (
            <div className="card card-pad" style={{ borderColor: "var(--warning-100)", background: "var(--warning-100)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={16} color="var(--warning-700)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <h3 style={{ fontSize: 13.5, color: "var(--warning-700)" }}>Similar studies already exist</h3>
                  <p style={{ fontSize: 12, color: "var(--warning-700)", marginTop: 4 }}>
                    Review these before continuing, to avoid duplicating a topic already covered in the department archive.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                {related.map((r) => (
                  <div key={r.id} style={{ background: "var(--surface)", borderRadius: 8, padding: 10 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 600 }}>{r.title}</p>
                    <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 2 }}>
                      {(r.authors || []).join(", ")} · {r.academic_year || "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card submit-aside-panel">
            <div className="submit-aside-title">Submission checklist</div>
            <div className="submit-aside-sub">Track your progress as you fill out the form.</div>
            <div className="checklist">
              <div className={`checklist-item${stepsDone.details ? " done" : ""}`}>
                <span className="checklist-dot">{stepsDone.details && <CheckCircle2 size={12} />}</span>
                <span>Title and abstract added</span>
              </div>
              <div className={`checklist-item${stepsDone.classification ? " done" : ""}`}>
                <span className="checklist-dot">{stepsDone.classification && <CheckCircle2 size={12} />}</span>
                <span>Keywords and SDGs tagged</span>
              </div>
              <div className={`checklist-item${stepsDone.files ? " done" : ""}`}>
                <span className="checklist-dot">{stepsDone.files && <CheckCircle2 size={12} />}</span>
                <span>Manuscript uploaded</span>
              </div>
            </div>
          </div>

          <div className="card submit-aside-panel">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <ShieldCheck size={16} color="var(--brass-600)" style={{ marginTop: 1, flexShrink: 0 }} />
              <div>
                <div className="submit-aside-title" style={{ marginBottom: 6 }}>Before you submit</div>
                <p style={{ fontSize: 12, color: "var(--ink-500)", lineHeight: 1.6 }}>
                  Double-check author names and your adviser's spelling — these appear as-is on the
                  approved record. Submissions are reviewed within 3–5 business days.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Dropzone({ accept, slot, file, previousFile, onRemovePrevious, onChange, onError, error, check, analysisMessage, analysisStatus, hint, required }) {
  function selectFiles(list) {
    // Some mobile pickers return an empty list when dismissed; preserve the
    // current selection instead of treating that as a request to remove it.
    if (!list.length) return;
    if (list.length > 1) {
      onChange(null);
      onError("Only one file can be uploaded at a time. Please select one file.");
      return;
    }
    const selected = list[0] || null;
    const validationError = validateResearchUploadFile(selected, slot);
    if (validationError) {
      onChange(null);
      onError(validationError);
      return;
    }
    onError("");
    onChange(selected);
  }

  const typeMismatch = check?.type && check.type !== check.expectedType;
  const confidenceLabel = check?.confidence == null ? "" : getDocumentConfidenceLabel(check.confidence);
  return (
    <>
    <div
      className={`dropzone${file ? " has-file" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); selectFiles(Array.from(event.dataTransfer.files || [])); }}
    >
      <div className="dropzone-icon">
        {file ? <CheckCircle2 size={17} /> : <UploadCloud size={17} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="dropzone-text">
          {file ? file.name : previousFile ? `Previously selected: ${previousFile.name}` : `Click to upload or drag a file here`}
        </div>
        <div className="dropzone-sub">
          {file ? "Click to replace this file" : previousFile ? "Please reselect this file to continue" : hint}
        </div>
      </div>
      {(file || previousFile) && (
        <button
          type="button"
          className="dropzone-remove"
          aria-label={`Remove ${file?.name || previousFile.name}`}
          title="Remove file"
          onClick={(event) => {
            event.stopPropagation();
            if (file) onChange(null);
            else onRemovePrevious?.();
          }}
        >
          <X size={15} />
        </button>
      )}
      <input
        type="file"
        accept={accept}
        required={required && !file}
        onChange={(event) => { selectFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ""; }}
      />
    </div>
    {error && <div role="alert" className="auth-error" style={{ marginTop: 6 }}>{error}</div>}
    {previousFile && !file && (
      <div className="metadata-analysis error" role="status" style={{ marginTop: 8 }}>
        <strong>Reselect this file to continue</strong>
        <span>{previousFile.name} was selected before the page reloaded. The file itself was not stored in browser storage.</span>
      </div>
    )}
    {check && slot !== "sourceCode" && (
      <div className={`metadata-analysis ${check.status === "analyzing" ? "analyzing" : typeMismatch ? "error" : "done"}`} role="status" style={{ marginTop: 8 }}>
        <strong>{previousFile && !file ? "Saved document validation" : "Document validation"}</strong>
        {check.status === "analyzing" ? <span>Analyzing document content…</span> : <>
          <span>{check.confidence >= DOCUMENT_CONFIDENCE.medium ? "Detected type" : "Possible document type"}: {check.type} ({Math.round(check.confidence * 100)}% — {confidenceLabel})</span>
          <span>Expected: {check.expectedType}</span>
          {previousFile && !file && <span>Saved result only; it will be checked again after you reselect the document.</span>}
          {typeMismatch && check.confidence >= DOCUMENT_CONFIDENCE.rejectMismatch && <span>This document appears incompatible with this upload field and cannot be submitted.</span>}
          {check.confidence < DOCUMENT_CONFIDENCE.medium && <span>Please verify that you selected the correct research document.</span>}
        </>}
      </div>
    )}
    {slot === "manuscript" && analysisStatus !== "idle" && (
      <div className={`metadata-analysis ${analysisStatus === "error" ? "error" : "done"}`} role="status" style={{ marginTop: 8 }}>
        <strong>AI-assisted metadata analysis</strong>
        <span>{analysisMessage}</span>
      </div>
    )}
    {check && slot === "sourceCode" && <div className="dropzone-sub" role="status">Expected: ZIP source-code archive · maximum {MAX_RESEARCH_UPLOAD_SIZE_LABEL}</div>}
    </>
  );
}
