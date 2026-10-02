import { useEffect, useState } from "react";
import { CalendarRange, Plus, Trash2, Power, PowerOff } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, Field, Button, EmptyState } from "../../components/ui";
import {
  createAcademicYear,
  deleteAcademicYear,
  getAcademicYears,
  updateAcademicYear,
} from "../../services/academicYears";

export default function AcademicYearManagement() {
  const [academicYears, setAcademicYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [success, setSuccess] = useState("");

  async function loadYears() {
    setLoading(true);
    setError("");
    try {
      const items = await getAcademicYears();
      setAcademicYears(items || []);
    } catch (loadError) {
      console.error("Failed to load academic years:", loadError);
      setError(loadError?.message || "Unable to load academic years.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadYears();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!label.trim()) {
        throw new Error("Academic year is required.");
      }

      await createAcademicYear({ label, is_active: true, sort_order: academicYears.length });
      setLabel("");
      setSuccess("Academic year added successfully.");
      await loadYears();
    } catch (createError) {
      console.error("Failed to create academic year:", createError);
      setError(createError?.message || "Unable to create academic year.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(item) {
    try {
      await updateAcademicYear(item.id, { is_active: !item.is_active });
      await loadYears();
    } catch (toggleError) {
      console.error("Failed to update academic year:", toggleError);
      setError(toggleError?.message || "Unable to update academic year.");
    }
  }

  async function handleDelete(item) {
    const confirmed = window.confirm(`Delete "${item.label}" from the academic-year list?`);
    if (!confirmed) return;

    setDeleteError(null);
    setError("");
    setSuccess("");
    try {
      await deleteAcademicYear(item.id);
      await loadYears();
      setSuccess(`"${item.label}" was removed.`);
    } catch (deleteFailure) {
      console.error("Failed to delete academic year:", deleteFailure);
      setDeleteError({
        id: item.id,
        message: deleteFailure?.message || "Unable to delete academic year.",
      });
    }
  }

  return (
    <Layout>
      <PageHeader
        eyebrow="Administration"
        title="Academic Year Setup"
        description="Create the academic terms available throughout the repository so submissions and OCR review use a consistent list."
      />

      <div className="card card-pad" style={{ maxWidth: 760 }}>
        <form onSubmit={handleCreate} style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--brass-700)", fontWeight: 700 }}>
            <CalendarRange size={16} />
            Add academic year
          </div>

          <Field label="Academic year label">
            <input
              className="input"
              placeholder="e.g. 2025-2026"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Button type="submit" disabled={saving}>
              <Plus size={14} style={{ marginRight: 6 }} />
              {saving ? "Saving..." : "Add academic year"}
            </Button>
          </div>

          {error && (
            <div className="alert alert-danger" style={{ marginTop: 4 }}>
              {error}
            </div>
          )}
          {success && (
            <div className="alert alert-success" style={{ marginTop: 4 }}>
              {success}
            </div>
          )}
        </form>
      </div>

      <div className="card card-pad" style={{ marginTop: 24, maxWidth: 760 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
          Available academic years
        </div>

        {loading ? (
          <p className="page-loading">Loading academic years...</p>
        ) : academicYears.length === 0 ? (
          <EmptyState icon={CalendarRange} title="No academic years configured">
            Add the first academic term to start using the organized dropdown in submissions and OCR review.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Academic year</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {academicYears.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.label}</td>
                    <td>
                      <span className={`badge ${item.is_active ? "badge-success" : "badge-neutral"}`}>
                        {item.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${item.is_active ? "btn-outline" : "btn-success"}`}
                          onClick={() => handleToggleActive(item)}
                        >
                          {item.is_active ? <PowerOff size={14} style={{ marginRight: 4 }} /> : <Power size={14} style={{ marginRight: 4 }} />}
                          {item.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(item)}
                        >
                          <Trash2 size={14} style={{ marginRight: 4 }} />
                          Delete
                        </button>
                      </div>
                      {deleteError?.id === item.id && (
                        <div className="alert alert-danger" role="alert" style={{ marginTop: 8 }}>
                          {deleteError.message}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
