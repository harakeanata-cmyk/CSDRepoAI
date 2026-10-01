import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  FileText,
  Search as SearchIcon,
  User,
  Users,
  ScanLine,
  ClipboardCheck,
  Archive as ArchiveIcon,
  BarChart3,
  Bell,
  Menu,
  X,
  Target,
  ChevronDown,
  ClipboardList,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { SDG_LIST } from "../lib/sdgList";
import { getAuditTrail } from "../services/research";

const NAV_ITEMS = {
  student: [
    { to: "/student", label: "Dashboard", end: true, icon: LayoutDashboard },
    { to: "/student/submit", label: "Submit Research", icon: Upload },
    { to: "/student/my-submissions", label: "My Submissions", icon: FileText },
    { to: "/student/archive", label: "Research Archive", icon: ArchiveIcon },
    { type: "sdg-group", key: "sdg", label: "Browse by SDG", icon: Target, basePath: "/student/archive" },
    { to: "/student/search", label: "AI Search", icon: SearchIcon },
  ],
  faculty: [
    { to: "/faculty", label: "Dashboard", end: true, icon: LayoutDashboard },
    { to: "/faculty/archive", label: "Research Archive", icon: ArchiveIcon },
    { type: "sdg-group", key: "sdg", label: "Browse by SDG", icon: Target, basePath: "/faculty/archive" },
    { to: "/faculty/search", label: "AI Search", icon: SearchIcon },
    { to: "/faculty/review", label: "Review & Approval", icon: ClipboardCheck },
    { to: "/faculty/analytics", label: "Research Analytics", icon: BarChart3 },
  ],
  admin: [
    { to: "/admin", label: "Dashboard", end: true, icon: LayoutDashboard },
    { to: "/admin/users", label: "User Management", icon: Users },
    { to: "/admin/academic-years", label: "Academic Years", icon: ClipboardList },
    { to: "/admin/ocr", label: "Document Digitization", icon: ScanLine },
    { to: "/admin/review", label: "Review & Approval", icon: ClipboardCheck },
    { to: "/admin/archive", label: "Research Archive", icon: ArchiveIcon },
    { to: "/admin/search", label: "AI Search", icon: SearchIcon },
    { to: "/admin/analytics", label: "Research Analytics", icon: BarChart3 },
  ],
};

const ROLE_LABEL = {
  student: "Student Portal",
  faculty: "Faculty Portal",
  admin: "Administrator",
};

export default function Layout({ children }) {
  const { profile, role, user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({});
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [seenNotificationIds, setSeenNotificationIds] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const notificationsOpenRef = useRef(false);
  const notificationStorageKey = profile?.id ? `csdrepoai-notifications-seen:${profile.id}` : null;
  const themeKey = profile?.id ? `csdrepoai-theme:${profile.id}` : null;
  const items = NAV_ITEMS[role] || [];
  const accountEmail = profile?.email || user?.email || "No email available";
  const profileName = [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix]
    .filter(Boolean)
    .join(" ")
    .trim() || (profile?.full_name && !profile.full_name.includes("@") ? profile.full_name : role === "admin" ? "Admin" : "Account");
  const initials = (profileName || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Prevent background scroll while the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const nextDarkMode = themeKey && localStorage.getItem(themeKey) === "dark";
    setDarkMode(Boolean(nextDarkMode));
    document.documentElement.dataset.theme = nextDarkMode ? "dark" : "light";
  }, [themeKey]);

  function toggleTheme() {
    const nextDarkMode = !darkMode;
    if (themeKey) localStorage.setItem(themeKey, nextDarkMode ? "dark" : "light");
    setDarkMode(nextDarkMode);
    document.documentElement.dataset.theme = nextDarkMode ? "dark" : "light";
  }

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      setLogoutPending(false);
      navigate("/login");
    }
  }

  useEffect(() => {
    let mounted = true;
    let firstRefresh = true;
    setNotifications([]);

    if (!notificationStorageKey) {
      setSeenNotificationIds([]);
      return () => {
        mounted = false;
      };
    }

    try {
      const savedIds = JSON.parse(localStorage.getItem(notificationStorageKey) || "[]");
      setSeenNotificationIds(Array.isArray(savedIds) ? savedIds : []);
    } catch {
      setSeenNotificationIds([]);
    }

    async function refreshNotifications() {
      if (firstRefresh) setNotificationsLoading(true);
      try {
        const entries = await getAuditTrail({ limit: 6 });
        if (!mounted) return;
        const latestEntries = entries || [];
        setNotifications(latestEntries);
        if (notificationsOpenRef.current) {
          markNotificationsSeen(latestEntries, notificationStorageKey);
        }
      } catch {
        if (mounted) setNotifications([]);
      } finally {
        if (mounted && firstRefresh) {
          setNotificationsLoading(false);
          firstRefresh = false;
        }
      }
    }

    refreshNotifications();
    const refreshTimer = setInterval(refreshNotifications, 30_000);

    return () => {
      mounted = false;
      clearInterval(refreshTimer);
    };
  }, [notificationStorageKey]);

  function markNotificationsSeen(entries, storageKey = notificationStorageKey) {
    if (!storageKey) return;

    let savedIds = [];
    try {
      const parsedIds = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(parsedIds)) savedIds = parsedIds;
    } catch {
      savedIds = [];
    }

    const newIds = (entries || []).map((entry) => String(entry.id));
    const nextIds = [...new Set([...savedIds, ...newIds])].slice(-200);
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextIds));
    } catch {
      // Keep the current session's seen state if browser storage is unavailable.
    }
    setSeenNotificationIds(nextIds);
  }

  function toggleNotifications() {
    const nextOpen = !notificationsOpen;
    notificationsOpenRef.current = nextOpen;
    setNotificationsOpen(nextOpen);
    if (nextOpen) markNotificationsSeen(notifications);
  }

  function formatNotificationAction(action) {
    return String(action || "activity").replaceAll("_", " ");
  }

  function formatNotificationTime(createdAt) {
    if (!createdAt) return "Recently";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(createdAt));
  }

  const unreadNotificationCount = notifications.filter(
    (entry) => !seenNotificationIds.includes(String(entry.id))
  ).length;
  const displayedNotificationCount = unreadNotificationCount || notifications.length;

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <img src="/logo.png" alt="CSDRepoAI logo" className="mobile-topbar-logo" width="26" height="26" />
          <span className="mobile-topbar-title">CSDRepoAI</span>
        </div>
        <div className="mobile-topbar-actions">
          <button className="mobile-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      <div className={`sidebar-backdrop${menuOpen ? " open" : ""}`} onClick={() => setMenuOpen(false)} />

      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="sidebar-brand" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/logo.png" alt="CSDRepoAI logo" className="sidebar-logo" width="34" height="34" />
            <div>
              <div className="sidebar-title">CSDRepoAI</div>
              <div className="sidebar-subtitle">{ROLE_LABEL[role]}</div>
            </div>
          </div>
          <button
            className="mobile-menu-btn"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            style={{ display: menuOpen ? "flex" : "none" }}
          >
            <X size={16} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {items.map((item) => {
            if (item.type === "sdg-group") {
              const Icon = item.icon;
              const isOpen = Boolean(openGroups[item.key]);
              const activeSdg = location.pathname.startsWith(item.basePath) && location.search.includes("sdg=");
              return (
                <div key={item.key} className="sidebar-group">
                  <button
                    type="button"
                    className={`sidebar-link sidebar-group-toggle${activeSdg ? " active" : ""}`}
                    onClick={() => setOpenGroups((g) => ({ ...g, [item.key]: !g[item.key] }))}
                    aria-expanded={isOpen}
                  >
                    <Icon size={16} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <ChevronDown
                      size={14}
                      style={{
                        transform: isOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.15s ease",
                      }}
                    />
                  </button>
                  {isOpen && (
                    <div className="sidebar-subnav">
                      {SDG_LIST.map((sdg) => (
                        <NavLink
                          key={sdg.id}
                          to={`${item.basePath}?sdg=${sdg.id}`}
                          className={({ isActive }) => {
                            const active =
                              location.pathname === item.basePath &&
                              location.search === `?sdg=${sdg.id}`;
                            return `sidebar-sublink${active ? " active" : ""}`;
                          }}
                        >
                          <span className="sidebar-sublink-num">{sdg.id}</span>
                          {sdg.title}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

      </aside>
      <main className="app-main">
        <header className="portal-topbar">
          <div className="portal-topbar-actions">
            <button
              type="button"
              className="portal-icon-button portal-theme-button"
              onClick={toggleTheme}
              aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
              title={`Switch to ${darkMode ? "light" : "dark"} mode`}
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="portal-profile-menu-wrap">
              <button type="button" className="portal-profile-button" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-haspopup="menu">
                <span className="portal-profile-avatar">{initials}</span><span className="portal-profile-name">{profileName}</span><ChevronDown size={14} />
              </button>
              {profileMenuOpen && (
                <div className="portal-profile-menu" role="menu">
                  <strong>{profileName}</strong>
                  <span className="portal-profile-email">{accountEmail}</span>
                  <NavLink to={`/${role}/profile`} className="portal-profile-edit" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                    <User size={14} /> Edit profile
                  </NavLink>
                  <button type="button" className="portal-profile-logout" role="menuitem" onClick={() => { setProfileMenuOpen(false); setLogoutPending(true); }}>
                    <LogOut size={14} /> Log out
                  </button>
                </div>
              )}
            </div>
            <div className="portal-notification-wrap">
              <button type="button" className="portal-icon-button" aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} new updates` : notifications.length ? ", recent updates already viewed" : ""}`} title="Notifications" aria-expanded={notificationsOpen} onClick={toggleNotifications}><Bell size={17} />{notifications.length > 0 && <span className={`portal-notification-count${unreadNotificationCount === 0 ? " is-seen" : ""}`}>{displayedNotificationCount > 99 ? "99+" : displayedNotificationCount}</span>}</button>
              {notificationsOpen && (
                <div className="portal-notification-menu" role="dialog" aria-label="Recent repository activity">
                  <div className="portal-notification-heading"><div><strong>Notifications</strong><span>Recent repository activity</span></div></div>
                  {notificationsLoading ? <div className="portal-notification-empty">Loading activity...</div> : notifications.length === 0 ? <div className="portal-notification-empty">No recent activity.</div> : notifications.map((entry) => <div className="portal-notification-item" key={entry.id}><span className="portal-notification-item-dot" /><div><strong>{formatNotificationAction(entry.action)}</strong><span>{entry.paperTitle}</span><small>{entry.actorName} · {formatNotificationTime(entry.created_at)}</small></div></div>)}
                </div>
              )}
            </div>
          </div>
        </header>
        {children}
      </main>
      {logoutPending && (
        <div className="logout-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogoutPending(false); }}>
          <div className="logout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="topbar-logout-title">
            <div className="logout-dialog-icon"><LogOut size={18} /></div>
            <div>
              <h2 id="topbar-logout-title">Are you sure you want to log out?</h2>
              <p>Your current session will be ended.</p>
            </div>
            <div className="logout-dialog-actions">
              <button type="button" className="btn btn-outline" onClick={() => setLogoutPending(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleSignOut}>Yes, log out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
