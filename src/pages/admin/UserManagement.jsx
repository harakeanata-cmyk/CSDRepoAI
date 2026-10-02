import { useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Download, Eye, EyeOff, Filter, KeyRound, Plus, RefreshCw, Search, ShieldCheck, UserCheck, Users, UserCog, UserRound } from "lucide-react";
import Layout from "../../components/Layout";
import { PageHeader, EmptyState, Avatar, StatGrid, StatCard, Field, Button } from "../../components/ui";
import { createUserAccount, getUsers, updateUserRole, setUserActive } from "../../services/users";
import { validatePassword } from "../../lib/authValidation";
import { supabaseServiceConfigured } from "../../lib/supabaseClient";
import { validatePersonNameFields } from "../../lib/nameValidation";
import { PROGRAM_OPTIONS } from "../../lib/programs";
import { useAuth } from "../../context/AuthContext";

export default function UserManagement() {
  const { resetPassword } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    suffix: "",
    role: "student",
    student_number: "",
    faculty_number: "",
    program: "",
  });
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resettingUserId, setResettingUserId] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const pageSize = 8;

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const users = await getUsers();
      setUsers(users || []);
    } catch (error) {
      console.error("Failed to load users:", error);
      setUsers([]);
      setLoadError(error?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRoleChange(userId, role) {
    await updateUserRole(userId, role);
    load();
  }

  function handleSort(nextSort) {
    if (sortBy === nextSort) {
      setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    } else {
      setSortBy(nextSort);
      setSortDirection("asc");
    }
  }

  function exportUsers() {
    const rows = [["Name", "Email", "Role", "Status", "Student number", "Faculty number"], ...filtered.map((user) => [
      user.full_name,
      user.email || "",
      user.role,
      user.is_active ? "Active" : "Deactivated",
      user.student_number || "",
      user.faculty_number || "",
    ])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "csdrepoai-users.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleToggleActive(userId, current) {
    await setUserActive(userId, !current);
    load();
  }

  async function handleSendPasswordReset(user) {
    if (!user.email) return;
    const confirmed = window.confirm(`Send a password reset link to ${user.email}? You will not see or set their password.`);
    if (!confirmed) return;

    setResettingUserId(user.id);
    setResetStatus(null);
    try {
      const result = await resetPassword(user.email);
      if (result.error) throw result.error;
      setResetStatus({ id: user.id, type: "success", message: `Reset link sent to ${user.email}.` });
    } catch (error) {
      setResetStatus({ id: user.id, type: "error", message: error.message || "Unable to send a reset link." });
    } finally {
      setResettingUserId(null);
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setCreateError("");
    setCreateSuccess("");
    setCreating(true);

    const nameCheck = validatePersonNameFields(newUser);
    if (!nameCheck.ok) {
      setCreateError(Object.values(nameCheck.errors)[0]);
      setCreating(false);
      return;
    }
    if (!newUser.email.trim()) {
      setCreateError("Please enter an email address.");
      setCreating(false);
      return;
    }

    if (newUser.password) {
      const pwCheck = validatePassword(newUser.password);
      if (!pwCheck.ok) {
        setCreateError(pwCheck.message || "Password does not meet requirements.");
        setCreating(false);
        return;
      }
    }
    try {
      await createUserAccount({ ...newUser, ...nameCheck.normalized, email: newUser.email.trim(), password: newUser.password || undefined });
      setCreateSuccess("User created successfully. If confirmation is required, they should receive an email shortly.");
      setNewUser({
        email: "",
        password: "",
        first_name: "",
        middle_name: "",
        last_name: "",
        suffix: "",
        role: "student",
        student_number: "",
        faculty_number: "",
        program: "",
      });
      load();
    } catch (error) {
      console.error("Failed to create user:", error);
      setCreateError(error.message || "Unable to create the user account.");
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return users
      .filter((user) => {
        const searchable = [user.full_name, user.email, user.student_number, user.faculty_number].filter(Boolean).join(" ").toLowerCase();
        return (!query || searchable.includes(query)) &&
          (roleFilter === "all" || user.role === roleFilter) &&
          (statusFilter === "all" || (statusFilter === "active" ? user.is_active : !user.is_active));
      })
      .sort((left, right) => {
        const leftValue = sortBy === "status" ? Number(left.is_active) : String(left[sortBy] || "").toLowerCase();
        const rightValue = sortBy === "status" ? Number(right.is_active) : String(right[sortBy] || "").toLowerCase();
        return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * (sortDirection === "asc" ? 1 : -1);
      });
  }, [filter, roleFilter, statusFilter, sortBy, sortDirection, users]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleUsers = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeCount = users.filter((user) => user.is_active).length;
  const studentCount = users.filter((user) => user.role === "student").length;
  const facultyCount = users.filter((user) => user.role === "faculty").length;
  const adminCount = users.filter((user) => user.role === "admin").length;

  useEffect(() => {
    setPage(1);
  }, [filter, roleFilter, statusFilter]);

  return (
    <Layout>
      <PageHeader
        eyebrow="Administration / Users"
        title="Users portal"
        description="A focused view of account health, access roles, and directory activity."
      />

      <section className="users-hero-grid" aria-label="User account metrics">
        <div className="users-welcome-panel">
          <div className="users-panel-kicker">Directory overview</div>
          <h2>Keep every account ready for research.</h2>
          <p>Monitor access, keep roles accurate, and resolve inactive accounts from one place.</p>
          <div className="users-hero-meta"><span><span className="users-live-dot" /> Directory synced</span><span>Updated just now</span></div>
        </div>
        <div className="users-metric-grid">
          <StatCard label="Total accounts" value={users.length} accent="brass" icon={Users} hint="All roles" />
          <StatCard label="Active now" value={activeCount} accent="success" icon={UserCheck} hint={users.length ? `${Math.round((activeCount / users.length) * 100)}% of directory` : "No accounts yet"} />
          <StatCard label="Students" value={studentCount} accent="info" icon={UserRound} />
          <StatCard label="Faculty" value={facultyCount} accent="info" icon={UserCog} />
          <StatCard label="Admins" value={adminCount} accent="warning" icon={ShieldCheck} hint="Privileged access" />
        </div>
      </section>

      <section className="users-workspace-grid">
        <div className="users-directory-panel">
          <div className="users-toolbar">
            <div>
              <div className="users-panel-kicker">Account directory</div>
              <h2>All users <span className="users-result-count">{filtered.length}</span></h2>
            </div>
            <div className="users-toolbar-actions">
              <Button type="button" variant="secondary" size="sm" onClick={load} disabled={loading} title="Refresh directory"><RefreshCw size={15} /> Refresh</Button>
              <Button type="button" variant="secondary" size="sm" onClick={exportUsers} title="Export filtered users"><Download size={15} /> Export</Button>
            </div>
          </div>

          <div className="users-filter-bar">
            <div className="users-search-field">
              <Search size={16} aria-hidden="true" />
              <input aria-label="Search users" placeholder="Search name, email, or ID" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <label className="users-select-wrap"><Filter size={14} aria-hidden="true" /><span className="sr-only">Filter by role</span><select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="all">All roles</option><option value="student">Students</option><option value="faculty">Faculty</option><option value="admin">Admins</option></select></label>
            <select className="users-filter-select" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Deactivated</option></select>
          </div>

      {loadError ? (
        <div className="card">
          <EmptyState icon={Users} title="Unable to load users">
            <div style={{ whiteSpace: "pre-wrap" }}>{loadError}</div>
            {!supabaseServiceConfigured && (
              <div style={{ marginTop: 10 }}>
                This usually means the Supabase service role key is missing or invalid. Please set `VITE_SUPABASE_SERVICE_ROLE` in your project's `.env` to your Supabase
                service_role key and restart the app.
              </div>
            )}
            {loadError.toLowerCase().includes("invalid api key") && (
              <div style={{ marginTop: 8 }}>
                The API key appears invalid. Replace the key with the correct service role key and restart the dev server.
              </div>
            )}
          </EmptyState>
        </div>
      ) : loading ? (
        <div className="table-wrap card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 20 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={Users} title="No users found">
            No users match that search.
          </EmptyState>
        </div>
      ) : (
        <div className="users-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><button className="users-sort-button" onClick={() => handleSort("full_name")}>User {sortBy === "full_name" ? (sortDirection === "asc" ? <ArrowDownAZ size={13} /> : <ArrowUpAZ size={13} />) : <ArrowDownAZ size={13} />}</button></th>
                <th>Identifier</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="users-person-cell">
                      <Avatar name={u.full_name} size={30} />
                      <div><span className="users-person-name">{u.full_name}</span><span className="users-person-email">{u.email || "No email listed"}</span></div>
                    </div>
                  </td>
                  <td><span className="users-identifier">{u.student_number || u.faculty_number || "No ID assigned"}</span></td>
                  <td>
                    <select value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)} className="input" style={{ padding: "5px 8px", fontSize: 12.5, width: "auto" }}>
                      <option value="student">Student</option>
                      <option value="faculty">Faculty</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? "badge-success" : "badge-neutral"}`}>{u.is_active ? "Active" : "Deactivated"}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => handleToggleActive(u.id, u.is_active)} className={`btn btn-sm ${u.is_active ? "btn-danger" : "btn-success"}`}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => handleSendPasswordReset(u)}
                        disabled={!u.email || resettingUserId === u.id}
                        title={u.email ? "Email a password reset link" : "No email is recorded for this account"}
                      >
                        <KeyRound size={13} /> {resettingUserId === u.id ? "Sending..." : "Reset Password"}
                      </button>
                    </div>
                    {resetStatus?.id === u.id && (
                      <small role={resetStatus.type === "error" ? "alert" : "status"} style={{ display: "block", marginTop: 6, color: resetStatus.type === "error" ? "var(--danger-700)" : "var(--success-700)" }}>
                        {resetStatus.message}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="users-table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="users-pagination"><button className="users-page-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="users-page-button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
        </div>
      )}
        </div>

        <aside className="users-quick-panel">
          <div className="users-panel-kicker">Quick actions</div>
          <h2>Keep momentum.</h2>
          <p>Common directory tasks, one click away.</p>
          <button className="users-action-link" onClick={() => setShowCreateForm(true)}><span className="users-action-icon"><Plus size={16} /></span><span><strong>Create account</strong><small>Add a student or faculty profile</small></span></button>
          <button className="users-action-link" onClick={exportUsers}><span className="users-action-icon"><Download size={16} /></span><span><strong>Export directory</strong><small>Download the current filtered view</small></span></button>
          <button className="users-action-link" onClick={() => { setRoleFilter("all"); setStatusFilter("inactive"); setFilter(""); }}><span className="users-action-icon"><ShieldCheck size={16} /></span><span><strong>Review inactive</strong><small>{users.length - activeCount} account{users.length - activeCount === 1 ? "" : "s"} need attention</small></span></button>
          <div className="users-quick-note"><ShieldCheck size={15} /><span>Role changes take effect immediately across the portal.</span></div>
        </aside>
      </section>

      <div className="card card-pad" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>
              Create user account
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-900)", marginBottom: 0 }}>
              Add a new repository user from the admin dashboard.
            </div>
          </div>
          <Button type="button" variant={showCreateForm ? "secondary" : "primary"} onClick={() => setShowCreateForm((prev) => !prev)}>
            {showCreateForm ? "Cancel" : <><Plus size={16} /> Add user</>}
          </Button>
        </div>
        {showCreateForm && (
          <form
            onSubmit={handleCreateUser}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            <Field label="First name">
              <input
                className="input"
                maxLength={100}
                value={newUser.first_name}
                onChange={(e) => setNewUser((prev) => ({ ...prev, first_name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Middle name">
              <input
                className="input"
                maxLength={100}
                value={newUser.middle_name}
                onChange={(e) => setNewUser((prev) => ({ ...prev, middle_name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Last name">
              <input
                className="input"
                maxLength={100}
                value={newUser.last_name}
                onChange={(e) => setNewUser((prev) => ({ ...prev, last_name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Suffix">
              <select
                className="input"
                value={newUser.suffix}
                onChange={(e) => setNewUser((prev) => ({ ...prev, suffix: e.target.value }))}
              >
                <option value="">None</option>
                <option value="Jr">Jr</option>
                <option value="Sr">Sr</option>
                <option value="II">II</option>
                <option value="III">III</option>
                <option value="IV">IV</option>
              </select>
            </Field>
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))}
                required
              />
            </Field>
            <Field label="Password">
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={showPassword ? "text" : "password"}
                  value={newUser.password}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--ink-500)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={newUser.role}
                onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
              >
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
              </select>
            </Field>
            {newUser.role === "student" && (
              <>
                <Field label="Student number">
                  <input
                    className="input"
                    value={newUser.student_number}
                    onChange={(e) => setNewUser((prev) => ({ ...prev, student_number: e.target.value }))}
                  />
                </Field>
                <Field label="Program">
                  <select
                    className="input"
                    value={newUser.program}
                    onChange={(e) => setNewUser((prev) => ({ ...prev, program: e.target.value }))}
                    required
                  >
                    <option value="">Select program</option>
                    {PROGRAM_OPTIONS.map((program) => (
                      <option key={program.value} value={program.value}>{program.label}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {newUser.role === "faculty" && (
              <Field label="Faculty number">
                <input
                  className="input"
                  value={newUser.faculty_number}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, faculty_number: e.target.value }))}
                />
              </Field>
            )}
            {createError && (
              <p className="auth-error" style={{ gridColumn: "1 / -1" }}>
                {createError}
              </p>
            )}
            {createSuccess && (
              <p className="auth-info" style={{ gridColumn: "1 / -1" }}>
                {createSuccess}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={creating} style={{ gridColumn: "1 / -1" }}>
              {creating ? "Creating..." : "Create user"}
            </Button>
          </form>
        )}
      </div>
    </Layout>
  );
}
