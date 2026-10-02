import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { PageHeader, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { validatePassword } from "../lib/authValidation";
import { updateProfile } from "../services/users";
import { validatePersonNameFields } from "../lib/nameValidation";

export default function Profile() {
  const { profile, user, updatePassword } = useAuth();
  const [form, setForm] = useState({
    first_name: profile?.first_name || "",
    middle_name: profile?.middle_name || "",
    last_name: profile?.last_name || "",
    suffix: profile?.suffix || "",
    program: profile?.program || "",
    student_number: profile?.student_number || "",
    faculty_number: profile?.faculty_number || "",
  });
  const [saved, setSaved] = useState(false);
  const [nameErrors, setNameErrors] = useState({});
  const [profileError, setProfileError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirmPassword: "" });
  const [passwordMessage, setPasswordMessage] = useState({ type: "", text: "" });
  const [passwordPending, setPasswordPending] = useState(false);

  useEffect(() => {
    setForm({
      first_name: profile?.first_name || "",
      middle_name: profile?.middle_name || "",
      last_name: profile?.last_name || "",
      suffix: profile?.suffix || "",
      program: profile?.program || "",
      student_number: profile?.student_number || "",
      faculty_number: profile?.faculty_number || "",
    });
  }, [profile]);

  async function handleSave(e) {
    e.preventDefault();
    setSaved(false);
    setProfileError("");
    const nameCheck = validatePersonNameFields(form);
    setNameErrors(nameCheck.errors);
    if (!nameCheck.ok) {
      const firstInvalid = Object.keys(nameCheck.errors)[0];
      document.querySelector(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    if (!window.confirm("Are you sure you want to save these changes?")) return;

    const cleanForm = { ...form, ...nameCheck.normalized };
    const full_name = [cleanForm.first_name, cleanForm.middle_name, cleanForm.last_name, cleanForm.suffix].filter(Boolean).join(" ");
    setProfileSaving(true);
    try {
      await updateProfile(user.id, { ...cleanForm, full_name });
      setForm(cleanForm);
      setNameErrors({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setProfileError(error?.message || "Unable to save your profile changes.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPasswordMessage({ type: "", text: "" });

    if (passwordForm.password !== passwordForm.confirmPassword) {
      setPasswordMessage({ type: "error", text: "Passwords do not match." });
      return;
    }

    const passwordCheck = validatePassword(passwordForm.password);
    if (!passwordCheck.ok) {
      setPasswordMessage({ type: "error", text: passwordCheck.message });
      return;
    }

    setPasswordPending(true);
    const result = await updatePassword(passwordForm.password);
    setPasswordPending(false);

    if (result.error) {
      setPasswordMessage({ type: "error", text: result.friendlyError || result.error.message });
      return;
    }

    setPasswordForm({ password: "", confirmPassword: "" });
    setPasswordMessage({ type: "success", text: "Password changed successfully." });
  }

  return (
    <Layout>
      <PageHeader eyebrow="Account" title="Profile" description="Keep your account details accurate and up to date." />

      <div className="profile-form-shell">
        <div className="card card-pad profile-card">
          <div className="profile-card-heading">
            <span className="profile-card-kicker">Personal details</span>
            <h2>Account information</h2>
            <p>Update the details used across your research submissions.</p>
          </div>
          <form onSubmit={handleSave} className="profile-form">
          <Field label="First name">
            <input name="first_name" className="input" aria-invalid={Boolean(nameErrors.first_name)} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            {nameErrors.first_name && <small className="profile-password-error">{nameErrors.first_name}</small>}
          </Field>
          <Field label="Middle name">
            <input name="middle_name" className="input" aria-invalid={Boolean(nameErrors.middle_name)} value={form.middle_name} onChange={(e) => setForm((f) => ({ ...f, middle_name: e.target.value }))} />
            {nameErrors.middle_name && <small className="profile-password-error">{nameErrors.middle_name}</small>}
          </Field>
          <Field label="Last name">
            <input name="last_name" className="input" aria-invalid={Boolean(nameErrors.last_name)} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            {nameErrors.last_name && <small className="profile-password-error">{nameErrors.last_name}</small>}
          </Field>
          <Field label="Suffix">
            <select name="suffix" className="input" aria-invalid={Boolean(nameErrors.suffix)} value={form.suffix} onChange={(e) => setForm((f) => ({ ...f, suffix: e.target.value }))}>
              <option value="">None</option>
              <option value="Jr">Jr</option>
              <option value="Sr">Sr</option>
              <option value="II">II</option>
              <option value="III">III</option>
              <option value="IV">IV</option>
            </select>
          </Field>
          {profile?.role === "student" && (
            <>
              <Field label="Program">
                <input className="input" value={form.program} onChange={(e) => setForm((f) => ({ ...f, program: e.target.value }))} />
              </Field>
              <Field label="Student number">
                <input className="input" value={form.student_number} onChange={(e) => setForm((f) => ({ ...f, student_number: e.target.value }))} />
              </Field>
            </>
          )}
          {profile?.role === "faculty" && (
            <Field label="Faculty number">
              <input className="input" value={form.faculty_number} onChange={(e) => setForm((f) => ({ ...f, faculty_number: e.target.value }))} />
            </Field>
          )}
          <Field label="Email">
            <input className="input" value={user?.email || ""} disabled style={{ color: "var(--ink-500)", background: "var(--surface-sunken)" }} />
          </Field>
          <Field label="Role">
            <input className="input" value={profile?.role || ""} disabled style={{ color: "var(--ink-500)", background: "var(--surface-sunken)", textTransform: "capitalize" }} />
          </Field>

          <button type="submit" className="btn btn-primary" style={{ marginTop: 4 }} disabled={profileSaving}>
            {profileSaving ? "Saving..." : "Save Changes"}
          </button>
          {saved && <p style={{ color: "var(--success-700)", fontSize: 13 }}>Saved.</p>}
          {profileError && <p className="profile-password-error" role="alert">{profileError}</p>}
          </form>
        </div>

        <div className="card card-pad profile-card">
          <div className="profile-card-heading">
            <span className="profile-card-kicker">Security</span>
            <h2>Change password</h2>
            <p>Use a strong password to keep your account secure.</p>
          </div>
          <form onSubmit={handlePasswordChange} className="profile-form">
            <Field label="New password">
              <input
                className="input"
                type="password"
                value={passwordForm.password}
                onChange={(e) => setPasswordForm((form) => ({ ...form, password: e.target.value }))}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                className="input"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((form) => ({ ...form, confirmPassword: e.target.value }))}
                autoComplete="new-password"
                required
              />
            </Field>
            <p className="profile-password-hint">At least 12 characters with uppercase, lowercase, a number, and a symbol.</p>
            <button type="submit" className="btn btn-primary" disabled={passwordPending}>
              {passwordPending ? "Changing..." : "Change Password"}
            </button>
            {passwordMessage.text && (
              <p className={passwordMessage.type === "error" ? "profile-password-error" : "profile-password-success"}>
                {passwordMessage.text}
              </p>
            )}
          </form>
        </div>
      </div>
    </Layout>
  );
}
