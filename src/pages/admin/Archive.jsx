import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Archive as ArchiveIcon, Trash2 } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, EmptyState, StatGrid, StatCard } from "../../components/ui";
import { deleteResearchPaper, getApprovedPapers, getResearchFileUrls } from "../../services/research";
import ResearchFileActions from "../../components/ResearchFileActions";

export default function Archive() {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [queryFilter, setQueryFilter] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    getApprovedPapers({ limit: 200 }).then(setPapers).finally(() => setLoading(false));
  }

  async function handleDelete(paper) {
    setDeleteError("");
    setPendingDelete(paper);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    const paper = pendingDelete;
    setPendingDelete(null);
    setDeletingId(paper.id);
    try {
      await deleteResearchPaper(paper);
      setPapers((current) => current.filter((item) => item.id !== paper.id));
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeletingId(null);
    }
  }

  const years = useMemo(() => {
    const set = new Set(papers.map((p) => p.academic_year).filter(Boolean));
    return ["all", ...Array.from(set).sort().reverse()];
  }, [papers]);

  const ocrCount = papers.filter((p) => p.source === "ocr_scanned").length;
  const sourceCounts = {
    all: papers.length,
    digital: papers.length - ocrCount,
    ocr_scanned: ocrCount,
  };

  const filtered = papers.filter((p) => {
    const matchesYear = yearFilter === "all" || p.academic_year === yearFilter;
    const matchesSource =
      sourceFilter === "all" ||
      (sourceFilter === "ocr_scanned" ? p.source === "ocr_scanned" : p.source !== "ocr_scanned");
    const q = queryFilter.toLowerCase();
    const matchesQuery =
      !q ||
      p.title.toLowerCase().includes(q) ||
      (p.authors || []).some((a) => a.toLowerCase().includes(q)) ||
      (p.keywords || []).some((k) => k.toLowerCase().includes(q));
    return matchesYear && matchesSource && matchesQuery;
  });

  const digitalPapers = filtered.filter((paper) => paper.source !== "ocr_scanned");
  const ocrPapers = filtered.filter((paper) => paper.source === "ocr_scanned");

  function renderPaperTable(records) {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Authors</th>
              <th>Year</th>
              <th>File</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600, maxWidth: 320 }}>{p.title}</td>
                <td style={{ color: "var(--ink-500)" }}>{(p.authors || []).join(", ") || "—"}</td>
                <td>{p.academic_year || "—"}</td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                    {getResearchFileUrls(p.file_url).length > 0 ? (
                      <div>
                        <ResearchFileActions paper={p} field="file_url" label="manuscript" />
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
                        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--brass-700)", textDecoration: "underline" }}
                      >
                        <FolderOpen size={13} /> View source code
                        <span className="archive-file-format">{getFileFormat(getResearchFileUrls(p.source_code_url))}</span>
                      </a>
                    )}
                    {getResearchFileUrls(p.ieee_paper_url).length > 0 && (
                      <div>
                        <ResearchFileActions paper={p} field="ieee_paper_url" label="IEEE short paper" />
                        <span className="archive-file-format">{getFileFormat(getResearchFileUrls(p.ieee_paper_url))}</span>
                      </div>
                    )}
                    {getResearchFileUrls(p.acm_paper_url).length > 0 && (
                      <div><ResearchFileActions paper={p} field="acm_paper_url" label="ACM style paper" /></div>
                    )}
                    {getResearchFileUrls(p.apa_paper_url).length > 0 && (
                      <div><ResearchFileActions paper={p} field="apa_paper_url" label="APA style paper" /></div>
                    )}
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(p)}
                    disabled={deletingId === p.id}
                    title="Delete research record and attached files"
                  >
                    <Trash2 size={13} /> {deletingId === p.id ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
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
        <StatCard label="Total Records" value={papers.length} accent="brass" />
        <StatCard label="Digital Submissions" value={papers.length - ocrCount} accent="info" />
        <StatCard label="OCR Scanned" value={ocrCount} accent="success" />
      </StatGrid>

      <div style={{ display: "flex", gap: 10, margin: "22px 0 18px", flexWrap: "wrap" }}>
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
            <h2 id="delete-research-title" style={{ fontSize: 19 }}>Confirm deletion</h2>
            <p style={{ marginTop: 10, color: "var(--ink-700)" }}>
              Delete <strong>{pendingDelete.title}</strong> from the research archive?
            </p>
            <p style={{ marginTop: 8, color: "var(--danger-700)", fontSize: 13 }}>
              This permanently removes the archive record and all attached research files. This action cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={confirmDelete}>
                <Trash2 size={13} /> Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
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
