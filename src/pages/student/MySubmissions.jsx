import { useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, Pencil, Trash2, X } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, StatusBadge, EmptyState, Field, Button } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { beginResearchEditing, cancelResearchEditing, getMySubmissions, updateResearchSubmission, withdrawResearchSubmission } from "../../services/research";
import ResearchFileActions from "../../components/ResearchFileActions";
import { analyzeResearchDocumentWithAI } from "../../services/metadataSuggestions";
import { SDG_LIST } from "../../lib/sdgList";
import { PROGRAM_OPTIONS } from "../../lib/programs";

const EMPTY_FILES = { manuscript: null, sourceCode: null, ieee: null, acm: null, apa: null };

function listToText(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export default function MySubmissions() {
  const { user, role } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [editStartingId, setEditStartingId] = useState(null);
  const [editActionError, setEditActionError] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [editSdgTags, setEditSdgTags] = useState([]);
  const [editFiles, setEditFiles] = useState(EMPTY_FILES);
  const [editManuscriptText, setEditManuscriptText] = useState("");
  const [editManuscriptLoading, setEditManuscriptLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [confirmEditSave, setConfirmEditSave] = useState(false);
  const [clearTarget, setClearTarget] = useState(null);
  const [clearingId, setClearingId] = useState(null);

  useEffect(() => {
    if (!user) return;
    getMySubmissions(user.id).then(setSubmissions).finally(() => setLoading(false));
  }, [user]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? submissions : submissions.filter((s) => s.status === statusFilter)),
    [submissions, statusFilter]
  );

  const statuses = ["all", "pending", "under_review", "student_editing", "approved", "rejected", "withdrawn"];

  async function confirmClearSubmission() {
    if (!clearTarget || !user || clearingId) return;
    setClearingId(clearTarget.id);
    setEditActionError("");
    try {
      await withdrawResearchSubmission({ paperId: clearTarget.id });
      setSubmissions((current) => current.map((paper) => paper.id === clearTarget.id
        ? { ...paper, status: "withdrawn", updated_at: new Date().toISOString() }
        : paper));
      if (editing?.id === clearTarget.id) {
        setEditing(null);
        setEditForm(null);
        setEditFiles({ ...EMPTY_FILES });
        setEditManuscriptText("");
        setEditManuscriptLoading(false);
        setEditError("");
        setConfirmEditSave(false);
      }
      setClearTarget(null);
    } catch (error) {
      setEditActionError(error.message || "Could not clear this submission.");
    } finally {
      setClearingId(null);
    }
  }

  async function startEditing(paper, event) {
    if (editStartingId !== null) return;
    const paperCard = event?.currentTarget.closest("[data-submission-card]");
    const paperCardTop = paperCard?.getBoundingClientRect().top;
    setEditStartingId(paper.id);
    setEditActionError("");
    try {
      const editPaper = paper.status === "student_editing"
        ? paper
        : await beginResearchEditing({ paperId: paper.id, userId: user.id });
      setStatusFilter("all");
      setSubmissions((current) => current.map((currentPaper) => currentPaper.id === editPaper.id ? editPaper : currentPaper));
      setEditing(editPaper);
    setEditForm({
        title: editPaper.title || "",
        abstract: editPaper.abstract || "",
        authors: listToText(editPaper.authors),
        adviser: editPaper.adviser || "",
        academicYear: editPaper.academic_year || "",
        semester: editPaper.semester || "1st Semester",
        program: editPaper.program || "",
        keywords: listToText(editPaper.keywords),
      });
      setEditSdgTags(editPaper.sdg_tags || []);
      setEditFiles({ ...EMPTY_FILES });
      setEditManuscriptText(editPaper.ocr_raw_text || "");
      setEditManuscriptLoading(false);
      setEditError("");
      setConfirmEditSave(false);
    } catch (error) {
      setEditActionError(error.message || "Could not mark this submission for editing.");
    } finally {
      setEditStartingId(null);
      if (paperCardTop !== undefined) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const currentPaperCard = document.getElementById(`submission-card-${paper.id}`);
          if (!currentPaperCard) return;
          const offset = currentPaperCard.getBoundingClientRect().top - paperCardTop;
          if (Math.abs(offset) > 1) window.scrollBy(0, offset);
        }));
      }
    }
  }

  function validateAcademicYear(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{4})$/);
    if (!match) return "Use the format YYYY-YYYY, for example 2025-2026.";
    if (Number(match[2]) !== Number(match[1]) + 1) {
      return "Academic years must be consecutive and in forward order, for example 2025-2026.";
    }
    return "";
  }

  async function cancelEditing() {
    if (editing?.status === "student_editing" && user) {
      try {
        const returnedPaper = await cancelResearchEditing({ paperId: editing.id, userId: user.id });
        setSubmissions((current) => current.map((paper) => paper.id === returnedPaper.id ? returnedPaper : paper));
      } catch (error) {
        setEditError(error.message || "Could not return this submission to the review queue.");
        return;
      }
    }
    setEditing(null);
    setEditForm(null);
    setEditFiles({ ...EMPTY_FILES });
    setEditManuscriptText("");
    setEditManuscriptLoading(false);
    setEditError("");
    setConfirmEditSave(false);
  }

  function handleEditSubmit(event) {
    event.preventDefault();
    if (!editing || !editForm || !user) return;

    const yearError = validateAcademicYear(editForm.academicYear);
    if (yearError) {
      setEditError(yearError);
      return;
    }

    setEditError("");
    setConfirmEditSave(true);
  }

  async function saveEditChanges() {
    if (!editing || !editForm || !user) return;

    const yearError = validateAcademicYear(editForm.academicYear);
    if (yearError) {
      setEditError(yearError);
      setConfirmEditSave(false);
      return;
    }

    setEditSaving(true);
    setEditError("");
    try {
      const authors = splitList(editForm.authors);
      const keywords = splitList(editForm.keywords);
      const updatedPaper = await updateResearchSubmission({
        paper: editing,
        title: editForm.title,
        abstract: editForm.abstract,
        authors,
        adviser: editForm.adviser,
        academicYear: editForm.academicYear,
        semester: editForm.semester,
        program: editForm.program,
        keywords,
        sdgTags: editSdgTags,
        files: editFiles,
        manuscriptText: editManuscriptText,
        userId: user.id,
      });

      setSubmissions((current) => current.map((paper) => paper.id === updatedPaper.id ? updatedPaper : paper));
      setEditing(null);
      setEditForm(null);
      setEditFiles({ ...EMPTY_FILES });
      setEditManuscriptText("");
      setConfirmEditSave(false);
    } catch (error) {
      setEditError(error.message || "Could not save your changes. Please try again.");
      setConfirmEditSave(false);
    } finally {
      setEditSaving(false);
    }
  }

  function updateEditField(field) {
    return (event) => setEditForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function toggleEditSdg(id) {
    setEditSdgTags((current) => current.includes(id)
      ? current.filter((tag) => tag !== id)
      : [...current, id]);
  }

  async function handleEditManuscriptChange(file) {
    setEditFiles((current) => ({ ...current, manuscript: file }));
    setEditManuscriptText(file ? "" : editing?.ocr_raw_text || "");
    setEditError("");
    if (!file) return;

    setEditManuscriptLoading(true);
    try {
      const analysis = await analyzeResearchDocumentWithAI(file);
      setEditManuscriptText(analysis?.extractedText || "");
    } catch (error) {
      setEditError(`Could not read replacement manuscript text: ${error.message}`);
    } finally {
      setEditManuscriptLoading(false);
    }
  }

  return (
    <Layout>
      <PageHeader
        eyebrow="Research Submission"
        title="My Submissions"
        description={`${role === "faculty" ? "Faculty" : "Student"} research outputs submitted from your account and their current review status.`}
      />

      {submissions.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`tag${statusFilter === s ? " selected" : ""}`}
              style={{ textTransform: "capitalize" }}
            >
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>
      )}

      {editActionError && <p className="auth-error" role="alert" style={{ marginBottom: 16 }}>{editActionError}</p>}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 110 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={FolderOpen} title="Nothing here yet">
            {submissions.length === 0 ? "Nothing submitted yet." : "No submissions match this filter."}
          </EmptyState>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((s) => (
            <div key={s.id} id={`submission-card-${s.id}`} data-submission-card className="card card-pad">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <h3 style={{ fontSize: 15, fontFamily: "var(--font-display)" }}>{s.title}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <StatusBadge status={s.status} />
                  {role === "student" && !["approved", "withdrawn"].includes(s.status) && (
                    <>
                    <Button type="button" variant="danger" size="sm" disabled={editStartingId !== null || clearingId !== null} onClick={() => { setClearTarget(s); setEditActionError(""); }}>
                      <Trash2 size={13} /> Clear submission
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled={editStartingId !== null} onClick={(event) => startEditing(s, event)}>
                      <Pencil size={13} /> {editStartingId === s.id ? "Marking..." : s.status === "student_editing" ? "Continue editing" : "Mark for editing"}
                    </Button>
                    </>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>
                Submitted {new Date(s.created_at).toLocaleDateString()}
              </p>
              {s.reviewActivity?.length > 0 && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--surface-sunken)" }}>
                  <strong style={{ fontSize: 12.5 }}>Review activity</strong>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    {s.reviewActivity.map((entry) => {
                      const action = entry.status === "approved"
                        ? "Approved"
                        : entry.status === "rejected"
                          ? "Rejected"
                          : "Marked under review";
                      const reviewerRole = entry.actor?.role
                        ? entry.actor.role.charAt(0).toUpperCase() + entry.actor.role.slice(1)
                        : "";

                      return (
                        <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
                          <span>
                            {action} by <strong>{entry.actor?.full_name || "account not recorded"}</strong>
                            {reviewerRole && <span style={{ color: "var(--ink-500)" }}> ({reviewerRole}{entry.actor?.faculty_number ? ` · ${entry.actor.faculty_number}` : ""})</span>}
                          </span>
                          {entry.created_at && <time style={{ color: "var(--ink-500)", fontSize: 11.5 }} dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p style={{ fontSize: 13, marginTop: 10 }}>{s.abstract}</p>
              {s.review_notes && (
                <p style={{ fontSize: 12.5, marginTop: 10, background: "var(--surface-sunken)", padding: 10, borderRadius: 8 }}>
                  <strong>Reviewer notes:</strong> {s.review_notes}
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                {s.file_url && (
                  <ResearchFileActions paper={s} field="file_url" label="manuscript" />
                )}
                {s.source_code_url && (
                  <a href={s.source_code_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <FolderOpen size={13} /> View source code
                  </a>
                )}
                {s.ieee_paper_url && (
                  <ResearchFileActions paper={s} field="ieee_paper_url" label="IEEE short paper" />
                )}
                {s.acm_paper_url && (
                  <ResearchFileActions paper={s} field="acm_paper_url" label="ACM style paper" />
                )}
                {s.apa_paper_url && (
                  <ResearchFileActions paper={s} field="apa_paper_url" label="APA style paper" />
                )}
              </div>
              {editing?.id === s.id && editForm && (
                <form className="card card-pad" onSubmit={handleEditSubmit} style={{ marginTop: 18 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
                    <div>
                      <h2 style={{ fontSize: 17 }}>Edit submission</h2>
                      <p style={{ color: "var(--ink-500)", fontSize: 12.5, marginTop: 4 }}>Changes are available until the paper is approved.</p>
                    </div>
                    <button type="button" className="portal-icon-button" aria-label="Cancel editing" title="Cancel editing" onClick={cancelEditing}>
                      <X size={17} />
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Field label="Research title">
                      <input className="input" value={editForm.title} onChange={updateEditField("title")} required />
                    </Field>
                    <Field label="Abstract">
                      <textarea className="input" rows={4} value={editForm.abstract} onChange={updateEditField("abstract")} required />
                    </Field>
                    <Field label="Authors (comma-separated)">
                      <input className="input" value={editForm.authors} onChange={updateEditField("authors")} required />
                    </Field>
                    <Field label="Adviser">
                      <input className="input" value={editForm.adviser} onChange={updateEditField("adviser")} />
                    </Field>
                    <div className="form-grid-2">
                      <Field label="Academic year">
                        <input className="input" value={editForm.academicYear} onChange={updateEditField("academicYear")} placeholder="e.g. 2025-2026" pattern="[0-9]{4}-[0-9]{4}" title="Use the format YYYY-YYYY, for example 2025-2026" required />
                      </Field>
                      <Field label="Semester">
                        <select className="input" value={editForm.semester} onChange={updateEditField("semester")}>
                          <option>1st Semester</option>
                          <option>2nd Semester</option>
                          <option>Summer</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Program">
                      <select className="input" value={editForm.program} onChange={updateEditField("program")} required>
                        <option value="">Select program</option>
                        {PROGRAM_OPTIONS.map((program) => (
                          <option key={program.value} value={program.value}>{program.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Keywords (comma-separated)">
                      <input className="input" value={editForm.keywords} onChange={updateEditField("keywords")} />
                    </Field>
                    <Field label="SDG classification">
                      <div className="sdg-grid">
                        {SDG_LIST.map((sdg) => (
                          <button type="button" key={sdg.id} onClick={() => toggleEditSdg(sdg.id)} className={`sdg-chip${editSdgTags.includes(sdg.id) ? " selected" : ""}`}>
                            <span className="sdg-chip-num">{sdg.id}</span>
                            {sdg.title}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <div className="form-grid-2">
                      <Field label="Replace manuscript (PDF or DOCX)">
                        <input className="input" type="file" accept=".pdf,.docx" onChange={(event) => handleEditManuscriptChange(event.target.files?.[0] || null)} />
                        {editManuscriptLoading && <small className="form-section-hint">Extracting manuscript text and metadata...</small>}
                      </Field>
                      <Field label="Replace source code (ZIP)">
                        <input className="input" type="file" accept=".zip" onChange={(event) => setEditFiles((current) => ({ ...current, sourceCode: event.target.files?.[0] || null }))} />
                      </Field>
                      <Field label="Replace IEEE paper (PDF)">
                        <input className="input" type="file" accept=".pdf" onChange={(event) => setEditFiles((current) => ({ ...current, ieee: event.target.files?.[0] || null }))} />
                      </Field>
                      <Field label="Replace ACM paper (PDF)">
                        <input className="input" type="file" accept=".pdf" onChange={(event) => setEditFiles((current) => ({ ...current, acm: event.target.files?.[0] || null }))} />
                      </Field>
                      <Field label="Replace APA paper (PDF)">
                        <input className="input" type="file" accept=".pdf" onChange={(event) => setEditFiles((current) => ({ ...current, apa: event.target.files?.[0] || null }))} />
                      </Field>
                    </div>
                  </div>

                  {editError && <p className="auth-error" role="alert" style={{ marginTop: 16 }}>{editError}</p>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                    <Button type="button" variant="secondary" onClick={cancelEditing}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={editSaving || editManuscriptLoading}>{editSaving ? "Saving..." : "Save changes"}</Button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmEditSave && editing && (
        <div
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !editSaving) setConfirmEditSave(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(15, 23, 42, 0.55)" }}
        >
          <div className="card card-pad" role="alertdialog" aria-modal="true" aria-labelledby="edit-confirm-title" style={{ width: "min(100%, 440px)", boxShadow: "var(--shadow-lg)" }}>
            <h2 id="edit-confirm-title" style={{ fontSize: 19 }}>Confirm submission changes</h2>
            <p style={{ marginTop: 10, color: "var(--ink-700)" }}>Save your updates to <strong>{editing.title}</strong>?</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={editSaving} onClick={() => setConfirmEditSave(false)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={editSaving} onClick={saveEditChanges}>{editSaving ? "Saving..." : "Yes, save changes"}</button>
            </div>
          </div>
        </div>
      )}

      {clearTarget && (
        <div
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget && !clearingId) setClearTarget(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(15, 23, 42, 0.55)" }}
        >
          <div className="card card-pad" role="alertdialog" aria-modal="true" aria-labelledby="clear-submission-title" style={{ width: "min(100%, 460px)", boxShadow: "var(--shadow-lg)" }}>
            <h2 id="clear-submission-title" style={{ fontSize: 19 }}>Are you sure you want to clear this submission?</h2>
            <p style={{ marginTop: 10, color: "var(--ink-700)" }}>
              <strong>{clearTarget.title}</strong> will be withdrawn from active review. Its record and activity history are preserved, and the same manuscript can be submitted again.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={clearingId !== null} onClick={() => setClearTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={clearingId !== null} onClick={confirmClearSubmission}>{clearingId ? "Clearing..." : "Yes, clear submission"}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
