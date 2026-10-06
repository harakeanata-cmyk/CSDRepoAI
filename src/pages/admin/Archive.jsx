import { Fragment, useEffect, useMemo, useState } from "react";
import { FolderOpen, Archive as ArchiveIcon, Power, PowerOff, ChevronDown } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, EmptyState, StatGrid, StatCard } from "../../components/ui";
import { deactivateResearchPaper, reactivateResearchPaper, getApprovedPapersWithAccounts, getResearchFileUrls } from "../../services/research";
import ResearchFileActions from "../../components/ResearchFileActions";
import { normalizeAcademicYear } from "../../lib/academicYear";

export default function Archive() {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [queryFilter, setQueryFilter] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [expandedPaperId, setExpandedPaperId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    getApprovedPapersWithAccounts({ limit: 1000, includeDeactivated: true }).then(setPapers).finally(() => setLoading(false));
  }

  async function handleDeactivate(paper) {
    setDeleteError("");
    setPendingDelete(paper);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const paper = pendingDelete;
    setPendingDelete(null);
    setDeletingId(paper.id);
    try {
      await deactivateResearchPaper(paper);
      setPapers((current) => current.map((item) => item.id === paper.id ? { ...item, is_active: false } : item));
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleReactivate(paper) {
    setDeleteError("");
    try {
      await reactivateResearchPaper(paper);
      setPapers((current) => current.map((item) => item.id === paper.id ? { ...item, is_active: true } : item));
    } catch (error) { setDeleteError(error.message); }
  }

  const years = useMemo(() => {
    const set = new Set(papers.map((p) => normalizeAcademicYear(p.academic_year)).filter(Boolean));
    return ["all", ...Array.from(set).sort().reverse()];
  }, [papers]);

  const activePapers = papers.filter((paper) => paper.is_active !== false);
  const ocrCount = activePapers.filter((p) => p.source === "ocr_scanned").length;
  const sourceCounts = {
    all: activePapers.length,
    digital: activePapers.length - ocrCount,
    ocr_scanned: ocrCount,
  };

  const filtered = papers.filter((p) => {
    const matchesYear = yearFilter === "all" || normalizeAcademicYear(p.academic_year) === yearFilter;
    const matchesSource =
      sourceFilter === "all" ||
      (sourceFilter === "ocr_scanned" ? p.source === "ocr_scanned" : p.source !== "ocr_scanned");
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? p.is_active !== false : p.is_active === false);
    const q = queryFilter.toLowerCase();
    const matchesQuery =
      !q ||
      p.title.toLowerCase().includes(q) ||
      (p.authors || []).some((a) => a.toLowerCase().includes(q)) ||
      (p.keywords || []).some((k) => k.toLowerCase().includes(q));
    return matchesYear && matchesSource && matchesStatus && matchesQuery;
  });

  const digitalPapers = filtered.filter((paper) => paper.source !== "ocr_scanned");
  const ocrPapers = filtered.filter((paper) => paper.source === "ocr_scanned");

  function renderPaperTable(records) {
    return (
      <div className="table-wrap admin-archive-table-wrap">
        <table className="table admin-archive-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Authors</th>
              <th>Year</th>
              <th>Submitted By</th>
              <th>Approved By</th>
              <th>File</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((p) => (
              <Fragment key={p.id}>
              <tr>
                <td data-label="Title" style={{ fontWeight: 600, maxWidth: 320 }}>
                  {p.source === "ocr_scanned" ? (
                    <button type="button" className="archive-title-toggle" aria-expanded={expandedPaperId === p.id} onClick={() => setExpandedPaperId((current) => current === p.id ? null : p.id)}>
                      <span>{p.title}</span><ChevronDown size={15} className={expandedPaperId === p.id ? "is-open" : ""} />
                    </button>
                  ) : p.title}
                </td>
                <td data-label="Authors" style={{ color: "var(--ink-500)" }}>{(p.authors || []).join(", ") || "—"}</td>
                <td data-label="Year">{p.academic_year || "—"}</td>
                <td data-label="Submitted By"><AccountDetails account={p.submitterAccount} /></td>
                <td data-label="Approved By"><AccountDetails account={p.approverAccount} /></td>
                <td data-label="Files" className="admin-archive-file-cell">
                  <div className="admin-archive-file-content">
                    {getResearchFileUrls(p.file_url).length > 0 ? (
                      <div className="admin-archive-file-item">
                        <ResearchFileActions paper={p} field="file_url" label="manuscript" className="admin-archive-file-actions" />
                        <span className="archive-file-format">{getFileFormat(getResearchFileUrls(p.file_url))}</span>
                      </div>
                    ) : (
                      <span style={{ color: "var(--ink-300)" }}>—</span>
                    )}
                    {getResearchFileUrls(p.source_code_url).length > 0 && (
                      <a
                        href={getResearchFileUrls(p.source_code_url)[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="admin-archive-extra-file"
                        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--brass-700)", textDecoration: "underline" }}
                      >
                        <FolderOpen size={13} /> View source code
                        <span className="archive-file-format">{getFileFormat(getResearchFileUrls(p.source_code_url))}</span>
                      </a>
                    )}
                    {getResearchFileUrls(p.ieee_paper_url).length > 0 && (
                      <div className="admin-archive-file-item">
                        <ResearchFileActions paper={p} field="ieee_paper_url" label="IEEE short paper" className="admin-archive-file-actions" />
                        <span className="archive-file-format">{getFileFormat(getResearchFileUrls(p.ieee_paper_url))}</span>
                      </div>
                    )}
                    {getResearchFileUrls(p.acm_paper_url).length > 0 && (
                      <div className="admin-archive-file-item"><ResearchFileActions paper={p} field="acm_paper_url" label="ACM style paper" className="admin-archive-file-actions" /></div>
                    )}
                    {getResearchFileUrls(p.apa_paper_url).length > 0 && (
                      <div className="admin-archive-file-item"><ResearchFileActions paper={p} field="apa_paper_url" label="APA style paper" className="admin-archive-file-actions" /></div>
                    )}
                  </div>
                </td>
                <td data-label="Action">
                  {p.is_active === false ? (
                    <button type="button" className="btn btn-success btn-sm" onClick={() => handleReactivate(p)}>
                      <Power size={13} /> Reactivate
                    </button>
                  ) : (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => handleDeactivate(p)} disabled={deletingId === p.id}>
                      <PowerOff size={13} /> Deactivate
                    </button>
                  )}
                </td>
              </tr>
              {p.source === "ocr_scanned" && expandedPaperId === p.id && (
                <tr key={`${p.id}-reviewers`} className="archive-reviewer-row">
                  <td colSpan={7}>
                    <div className="archive-reviewer-details">
                      <div><span className="archive-reviewer-label">Adviser</span><strong>{p.adviser?.trim() || "Not recorded"}</strong></div>
                      <div><span className="archive-reviewer-label">Panel members</span><strong>{Array.isArray(p.panel_members) && p.panel_members.length ? p.panel_members.join(", ") : "Not recorded"}</strong></div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Layout>
      <PageHeader
        eyebrow="Digital Repository"
        title="Research Archive"
        description="All approved and digitized research currently held in the repository."
      />

      <StatGrid>
        <StatCard label="Active Records" value={activePapers.length} accent="brass" />
        <StatCard label="Digital Submissions" value={activePapers.length - ocrCount} accent="info" />
        <StatCard label="OCR Scanned" value={ocrCount} accent="success" />
      </StatGrid>

      <div style={{ display: "flex", gap: 10, margin: "22px 0 18px", flexWrap: "wrap" }}>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }} aria-label="Filter record status">
          <option value="active">Active</option><option value="deactivated">Deactivated</option><option value="all">All records</option>
        </select>
        <input
          className="input"
          placeholder="Filter by title, author, or keyword..."
          value={queryFilter}
          onChange={(e) => setQueryFilter(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <select className="input" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={{ maxWidth: 180 }}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y === "all" ? "All academic years" : y}
            </option>
          ))}
        </select>
        <select className="input" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ maxWidth: 180 }} aria-label="Filter by source">
          <option value="all">All sources ({sourceCounts.all})</option>
          <option value="digital">Digital ({sourceCounts.digital})</option>
          <option value="ocr_scanned">OCR Scanned ({sourceCounts.ocr_scanned})</option>
        </select>
        <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12.5, color: "var(--ink-500)" }}>
          {loading ? "" : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading ? (
        <p className="page-loading">Loading archive...</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={ArchiveIcon} title="No records found">
            No research records match those filters yet.
          </EmptyState>
        </div>
      ) : (
        <div className="archive-source-sections">
          {digitalPapers.length > 0 && (
            <section className="archive-source-section">
              <div className="archive-source-heading">
                <div>
                  <span className="page-eyebrow">Source collection</span>
                  <h2>Digital Research</h2>
                </div>
                <span className="badge badge-neutral">{digitalPapers.length} records</span>
              </div>
              {renderPaperTable(digitalPapers)}
            </section>
          )}
          {ocrPapers.length > 0 && (
            <section className="archive-source-section">
              <div className="archive-source-heading">
                <div>
                  <span className="page-eyebrow">Source collection</span>
                  <h2>OCR Scanned Research</h2>
                </div>
                <span className="badge badge-info">{ocrPapers.length} records</span>
              </div>
              {renderPaperTable(ocrPapers)}
            </section>
          )}
          {deleteError && <p className="auth-error" style={{ margin: "12px 0" }}>{deleteError}</p>}
        </div>
      )}

      {pendingDelete && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(20, 33, 61, 0.52)",
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-research-title"
            className="card card-pad"
            style={{ width: "min(100%, 460px)", boxShadow: "var(--shadow-lg)" }}
          >
            <h2 id="delete-research-title" style={{ fontSize: 19 }}>Confirm deactivation</h2>
            <p style={{ marginTop: 10, color: "var(--ink-700)" }}>
              Deactivate <strong>{pendingDelete.title}</strong>?
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-700)", fontSize: 13 }}>
              The record, academic year, submission status, history, metadata, and attached files will be preserved. It will no longer appear as active and can be reactivated later.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={confirmDelete}>
                <PowerOff size={13} /> Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function AccountDetails({ account }) {
  if (!account) return <span style={{ color: "var(--ink-300)" }}>Not recorded</span>;

  const role = account.role === "student" ? "Student" : account.role === "faculty" ? "Faculty" : "Admin";
  const identifier = account.role === "student" ? account.student_number : account.faculty_number;

  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontWeight: 600 }}>{account.full_name || "Unnamed account"}</div>
      <div style={{ color: "var(--ink-500)", fontSize: 12 }}>{role}{identifier ? ` · ${identifier}` : ""}</div>
    </div>
  );
}

const FILE_FORMATS = {
  doc: "DOC",
  docx: "DOCX",
  pdf: "PDF",
  odt: "ODT",
  rtf: "RTF",
  txt: "TXT",
  csv: "CSV",
  xls: "XLS",
  xlsx: "XLSX",
  ppt: "PPT",
  pptx: "PPTX",
  zip: "ZIP",
  rar: "RAR",
  jpg: "JPG",
  jpeg: "JPEG",
  png: "PNG",
};

function getFileFormat(urls) {
  if (urls.length > 1) return "PAGES";
  const rawUrl = String(urls[0] || "").split(/[?#]/, 1)[0];
  let path = rawUrl;
  try {
    path = decodeURIComponent(new URL(rawUrl).pathname);
  } catch {
    try { path = decodeURIComponent(rawUrl); } catch { /* Keep the undecoded path. */ }
  }
  const extension = path.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  return FILE_FORMATS[extension] || extension?.toUpperCase() || "FILE";
}
