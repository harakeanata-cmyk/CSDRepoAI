import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, ScanLine, Users, ArrowRight, FolderOpen, Clock, CheckCircle2, XCircle } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, StatGrid, StatCard } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { subscribeToResearchDataChanges } from "../../lib/researchEvents";
import { getAnalyticsSummary } from "../../services/analytics";
import { getPendingSubmissions, getAuditTrail } from "../../services/research";

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);

  useEffect(() => {
    let active = true;
    let refreshSequence = 0;
    const refresh = async () => {
      const currentSequence = ++refreshSequence;
      try {
        const [nextSummary, nextPending, nextAuditTrail] = await Promise.all([
          getAnalyticsSummary(),
          getPendingSubmissions(),
          getAuditTrail({ limit: 8 }),
        ]);
        if (!active || currentSequence !== refreshSequence) return;
        setSummary(nextSummary);
        setPending(nextPending);
        setAuditTrail(nextAuditTrail);
      } catch (error) {
        console.error("Could not refresh the admin dashboard:", error);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    const unsubscribeFromChanges = subscribeToResearchDataChanges(refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      unsubscribeFromChanges();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return (
    <Layout>
      <PageHeader
        eyebrow="Admin Dashboard"
        title={`Welcome back${profile?.full_name ? `, ${profile.full_name.split("@")[0].split(" ")[0]}` : ""}`}
        description="Centralized view of repository activity, pending reviews, and system metrics."
      />

      <StatGrid>
        <StatCard label="Total Research" value={summary?.totalSubmissions ?? "—"} accent="brass" icon={FolderOpen} />
        <StatCard label="Awaiting Review" value={pending.length} accent="warning" icon={Clock} />
        <StatCard label="Approved" value={summary?.approved ?? "—"} accent="success" icon={CheckCircle2} />
        <StatCard label="Rejected" value={summary?.rejected ?? "—"} accent="danger" icon={XCircle} />
      </StatGrid>

      <h2 style={{ fontSize: 13, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brass-700)", margin: "30px 0 14px" }}>
        Quick Actions
      </h2>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <QuickLink to="/admin/review" icon={ClipboardCheck} label="Review Pending Submissions" sub={`${pending.length} waiting`} />
        <QuickLink to="/admin/ocr" icon={ScanLine} label="Digitize a Research Document" sub="JPG, PNG, or other image files" />
        <QuickLink to="/admin/users" icon={Users} label="Manage Users" sub="Roles & accounts" />
      </div>

      <div style={{ marginTop: 28 }} className="card card-pad">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brass-700)" }}>
              Audit Trail
            </div>
            <h2 style={{ fontSize: 16, marginTop: 6 }}>Recent repository activity</h2>
          </div>
        </div>

        {auditTrail.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-500)" }}>No recent activity has been recorded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {auditTrail.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                  borderBottom: "1px solid var(--line)",
                  paddingBottom: 10,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>
                    {entry.paperTitle}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                    {formatAuditAction(entry.action)} by {entry.actorName}
                    {entry.detail?.status ? ` · ${entry.detail.status}` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-500)", whiteSpace: "nowrap" }}>
                  {new Date(entry.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function formatAuditAction(action) {
  switch (action) {
    case "submitted":
      return "Submission recorded";
    case "ocr_scanned":
      return "OCR scan archived";
    case "status_changed":
      return "Review status updated";
    default:
      return action;
  }
}

function QuickLink({ to, icon: Icon, label, sub }) {
  return (
    <Link to={to} className="card card-pad" style={{ flex: "1 1 220px", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--brass-50)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={18} color="var(--brass-600)" />
        </div>
        <div>
          <p style={{ fontWeight: 600, color: "var(--ink-900)", fontSize: 13.5 }}>{label}</p>
          <p style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{sub}</p>
        </div>
      </div>
      <ArrowRight size={16} color="var(--ink-300)" />
    </Link>
  );
}
