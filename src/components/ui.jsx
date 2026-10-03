import { ChevronRight, Inbox } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, style, className = "" }) {
  return (
    <div className={`card card-pad ${className}`} style={style}>
      {children}
    </div>
  );
}

export function StatGrid({ children, className = "" }) {
  return <div className={`stat-grid ${className}`.trim()}>{children}</div>;
}

const ACCENTS = {
  brass: "var(--brass-600)",
  success: "var(--success-600)",
  warning: "var(--warning-600)",
  danger: "var(--danger-600)",
  info: "var(--info-600)",
};

export function StatCard({ label, value, accent = "brass", icon: Icon, hint }) {
  return (
    <div className="stat-card" style={{ "--accent": ACCENTS[accent] }}>
      <div className="stat-card-top">
        <div className="stat-label">{label}</div>
        {Icon && (
          <div className="stat-icon" style={{ color: ACCENTS[accent] }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Button({ variant = "primary", size, children, ...props }) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", props.className || ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...props} className={classes}>
      {children}
    </button>
  );
}

const BADGE_MAP = {
  pending: "warning",
  under_review: "info",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

export function StatusBadge({ status }) {
  const kind = BADGE_MAP[status] || "neutral";
  const label = status === "withdrawn" ? "Withdrawn" : status.replace("_", " ");
  return <span className={`badge badge-${kind}`}>{label}</span>;
}

export function Field({ label, children }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
    </label>
  );
}

export function EmptyState({ children, icon: Icon = Inbox, title }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={22} />
      </div>
      {title && <div className="empty-state-title">{title}</div>}
      <p>{children}</p>
    </div>
  );
}

export function Avatar({ name = "", size = 34 }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

export function Skeleton({ height = 14, width = "100%", style }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function Breadcrumb({ items }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "var(--ink-500)" }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {item}
          {i < items.length - 1 && <ChevronRight size={12} />}
        </span>
      ))}
    </div>
  );
}
