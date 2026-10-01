import { useEffect, useState } from "react";
import { FileText, FolderOpen, Check, X, Clock, ClipboardCheck } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, EmptyState } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getPendingSubmissions, openResearchFile, reviewSubmission } from "../../services/research";

export default function ReviewApproval() {
  const { user } = useAuth();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const [pendingDecision, setPendingDecision] = useState(null);
  const [reviewError, setReviewError] = useState("");

  function load() {
    getPendingSubmissions().then(setPending).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDecision(paperId, status) {
    setReviewError("");
    try {
      await reviewSubmission({ paperId, status, notes: notes[paperId] || "", reviewerId: user.id });
      load();
    } catch (error) {
      setReviewError(error.message || "Could not update this submission review.");
      load();
    }
  }

  async function confirmDecision() {
    await handleDecision(pendingDecision.paperId, pendingDecision.status);
    setPendingDecision(null);
  }

  return (
    <Layout>
      <PageHeader eyebrow="Submission Review" title="Review & Approval" description="Evaluate pending research submissions before they're archived." />

      {reviewError && <p className="auth-error" role="alert" style={{ marginBottom: 16 }}>{reviewError}</p>}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton" style={{ height: 160 }} />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <div className="card">
          <EmptyState icon={ClipboardCheck} title="All caught up">
            No pending submissions right now.
          </EmptyState>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {pending.map((p) => (
            <div key={p.id} className="card card-pad">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <h3 style={{ fontSize: 15, fontFamily: "var(--font-display)" }}>{p.title}</h3>
                  <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginTop: 3 }}>
                    Submitted by {p.profiles?.full_name} ({p.profiles?.student_number || "n/a"})
                  </p>
                </div>
                <span className="badge badge-warning">
                  <Clock size={11} /> {p.status.replace("_", " ")}
                </span>
              </div>
              <p style={{ fontSize: 13, marginTop: 10 }}>{p.abstract}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                {p.file_url && (
                  <button type="button" onClick={() => openResearchFile(p).catch((error) => setReviewError(error.message))} style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, color: "var(--brass-700)", background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                    <FileText size={13} /> View manuscript
                  </button>
                )}
                {p.source_code_url && (
                  <a href={p.source_code_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <FolderOpen size={13} /> View source code
                  </a>
                )}
                {p.ieee_paper_url && (
                  <a href={p.ieee_paper_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <FileText size={13} /> View IEEE short paper
                  </a>
                )}
                {p.acm_paper_url && (
                  <a href={p.acm_paper_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <FileText size={13} /> View ACM style paper
                  </a>
                )}
                {p.apa_paper_url && (
                  <a href={p.apa_paper_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <FileText size={13} /> View APA style paper
                  </a>
                )}
              </div>
              <textarea
                placeholder="Review notes (optional)"
                value={notes[p.id] || ""}
                onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                rows={2}
                className="input"
                style={{ marginTop: 12 }}
                disabled={p.status === "student_editing"}
              />
              {p.status === "student_editing" && (
                <p className="auth-info" role="status" style={{ marginTop: 12 }}>
                  The student marked this submission for editing. Review actions are paused until it is resubmitted.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button disabled={p.status === "student_editing"} onClick={() => setPendingDecision({ paperId: p.id, title: p.title, status: "approved" })} className="btn btn-success btn-sm">
                  <Check size={13} /> Approve
                </button>
                <button disabled={p.status === "student_editing"} onClick={() => setPendingDecision({ paperId: p.id, title: p.title, status: "rejected" })} className="btn btn-danger btn-sm">
                  <X size={13} /> Reject
                </button>
                <button disabled={p.status === "student_editing"} onClick={() => handleDecision(p.id, "under_review")} className="btn btn-outline btn-sm">
                  Mark Under Review
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {pendingDecision && (
        <div
          className="review-decision-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPendingDecision(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="review-decision-title"
            className="card card-pad"
            style={{ width: "min(100%, 460px)", boxShadow: "var(--shadow-lg)" }}
          >
            <h2 id="review-decision-title" style={{ fontSize: 19 }}>
              Confirm {pendingDecision.status === "approved" ? "approval" : "rejection"}
            </h2>
            <p style={{ marginTop: 10, color: "var(--ink-700)" }}>
              {pendingDecision.status === "approved" ? "Approve" : "Reject"} <strong>{pendingDecision.title}</strong>?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPendingDecision(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-${pendingDecision.status === "approved" ? "success" : "danger"} btn-sm`}
                onClick={confirmDecision}
              >
                Yes, {pendingDecision.status === "approved" ? "Approve" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
