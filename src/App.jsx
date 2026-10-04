import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import RoleRedirect from "./pages/RoleRedirect";
import Search from "./pages/Search";
import Profile from "./pages/Profile";
import Analytics from "./pages/Analytics";
import Archive from "./pages/Archive";
import AdminArchive from "./pages/admin/Archive";

import StudentDashboard from "./pages/student/Dashboard";
import Submit from "./pages/student/Submit";
import MySubmissions from "./pages/student/MySubmissions";

import FacultyDashboard from "./pages/faculty/Dashboard";

import AdminDashboard from "./pages/admin/Dashboard";
import UserManagement from "./pages/admin/UserManagement";
import AcademicYearManagement from "./pages/admin/AcademicYearManagement";
import OCRScan from "./pages/admin/OCRScan";
import ReviewApproval from "./pages/admin/ReviewApproval";
import Settings from "./pages/Settings";
import ResearchDocumentPreview from "./pages/ResearchDocumentPreview";

function PortalNavigationLoader() {
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const pendingNavigation = useRef(null);
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    const clearPending = () => {
      if (!pendingNavigation.current) return;
      clearTimeout(pendingNavigation.current.fallbackTimer);
      clearTimeout(pendingNavigation.current.finishTimer);
      pendingNavigation.current = null;
      setIsLoading(false);
    };

    const beginNavigation = (destination) => {
      clearPending();
      const navigation = { destination, startedAt: Date.now(), fallbackTimer: null, finishTimer: null };
      navigation.fallbackTimer = window.setTimeout(clearPending, 3000);
      pendingNavigation.current = navigation;
      setIsLoading(true);
    };

    const portalPath = /^\/(student|faculty|admin)(?:\/|$)/;
    const handleLinkClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const target = new URL(link.href, window.location.href);
      const currentLocation = `${locationRef.current.pathname}${locationRef.current.search}`;
      const destination = `${target.pathname}${target.search}`;
      if (target.origin !== window.location.origin || !portalPath.test(locationRef.current.pathname) || !portalPath.test(target.pathname) || destination === currentLocation) return;

      beginNavigation(destination);
    };

    const handleHistoryNavigation = () => {
      if (portalPath.test(locationRef.current.pathname)) beginNavigation("history");
    };

    document.addEventListener("click", handleLinkClick, true);
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => {
      document.removeEventListener("click", handleLinkClick, true);
      window.removeEventListener("popstate", handleHistoryNavigation);
      clearPending();
    };
  }, []);

  useEffect(() => {
    const navigation = pendingNavigation.current;
    if (!navigation) return undefined;
    const currentLocation = `${location.pathname}${location.search}`;
    if (navigation.destination !== "history" && navigation.destination !== currentLocation) return undefined;

    const remainingVisibleTime = Math.max(0, 100 - (Date.now() - navigation.startedAt));
    navigation.finishTimer = window.setTimeout(() => {
      if (pendingNavigation.current === navigation) {
        clearTimeout(navigation.fallbackTimer);
        pendingNavigation.current = null;
        setIsLoading(false);
      }
    }, remainingVisibleTime);
    return undefined;
  }, [location.pathname, location.search]);

  if (!isLoading) return null;

  return (
    <div className="portal-navigation-loader" role="status" aria-live="polite" aria-label="Loading page">
      <div className="portal-navigation-loader-card">
        <div className="portal-navigation-loader-mark">
          <img src="/logo.png" alt="" />
          <span className="portal-navigation-spinner" />
        </div>
        <div className="portal-navigation-loader-copy">
          <span className="portal-navigation-loader-brand">CSDRepoAI</span>
          <span className="portal-navigation-loader-label">Preparing your workspace</span>
        </div>
        <div className="portal-navigation-loader-track" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}

const PORTAL_NAMES = {
  student: "Student Portal",
  faculty: "Faculty Portal",
  admin: "Administrator Portal",
};

function PortalWelcome() {
  const location = useLocation();
  const { profile, role, session, loading } = useAuth();
  const [welcomeRole, setWelcomeRole] = useState(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const lastPortalRole = useRef(null);
  const timeoutRef = useRef(null);
  const portalRole = location.pathname.match(/^\/(student|faculty|admin)(?:\/|$)/)?.[1] || null;
  const firstName = profile?.first_name?.trim() || (!profile?.full_name?.includes("@") ? profile?.full_name?.trim().split(/\s+/)[0] : "");

  useEffect(() => {
    if (!portalRole) {
      lastPortalRole.current = null;
      clearTimeout(timeoutRef.current);
      setIsLeaving(false);
      setWelcomeRole(null);
      return;
    }

    if (loading || !session || role !== portalRole || lastPortalRole.current === portalRole) return;

    clearTimeout(timeoutRef.current);
    lastPortalRole.current = portalRole;
    setIsLeaving(false);
    setWelcomeRole(portalRole);
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 240 : 720;
    timeoutRef.current = window.setTimeout(() => {
      setIsLeaving(true);
      timeoutRef.current = window.setTimeout(() => setWelcomeRole(null), 140);
    }, duration - 140);
  }, [loading, location.pathname, portalRole, role, session]);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  if (!welcomeRole || welcomeRole !== portalRole) return null;

  return (
    <div className={`portal-welcome-overlay${isLeaving ? " is-leaving" : ""}`} role="status" aria-live="polite" aria-label={`Welcome to the ${PORTAL_NAMES[welcomeRole]}`}>
      <section className="portal-welcome-card" data-portal={welcomeRole}>
        <div className="portal-welcome-art" aria-hidden="true">
          <span className="portal-welcome-orbit portal-welcome-orbit-one" />
          <span className="portal-welcome-orbit portal-welcome-orbit-two" />
          <span className="portal-welcome-star portal-welcome-star-one" />
          <span className="portal-welcome-star portal-welcome-star-two" />
          <span className="portal-welcome-emblem"><img src="/logo.png" alt="" /></span>
        </div>
        <span className="portal-welcome-kicker">{PORTAL_NAMES[welcomeRole]} <span>·</span> CSDRepoAI</span>
        <h1 className="portal-welcome-heading">
          {firstName ? <>Welcome back,<br /><span>{firstName}.</span></> : <>Welcome to<br /><span>your workspace.</span></>}
        </h1>
        <p className="portal-welcome-message">Your research space is ready.</p>
        <div className="portal-welcome-ready"><span /> Workspace ready</div>
      </section>
    </div>
  );
}

function PersistentOCRScan() {
  const location = useLocation();
  const { role, session, loading, verifySession } = useAuth();
  const [verifiedLocation, setVerifiedLocation] = useState(null);
  const [checking, setChecking] = useState(true);
  const isActive = location.pathname === "/admin/ocr";

  useEffect(() => {
    if (!isActive) {
      setVerifiedLocation(null);
      setChecking(true);
      return undefined;
    }
    if (loading || role !== "admin") return undefined;
    let active = true;
    const locationToken = `${location.key}:${location.pathname}`;
    let pendingCheck = null;

    async function verifyBeforeDisplay() {
      if (pendingCheck) return pendingCheck;
      setChecking(true);
      setVerifiedLocation(null);
      pendingCheck = verifySession();
      try {
        const valid = await pendingCheck;
        if (active) {
          setVerifiedLocation(valid ? locationToken : null);
          setChecking(false);
        }
      } finally {
        pendingCheck = null;
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void verifyBeforeDisplay();
    };
    const checkOnPageShow = () => void verifyBeforeDisplay();
    void verifyBeforeDisplay();
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("pageshow", checkOnPageShow);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("pageshow", checkOnPageShow);
    };
  }, [isActive, loading, location.key, location.pathname, role, verifySession]);

  if (role !== "admin" || !session) return null;

  return (
    <div style={{ display: isActive && !checking && verifiedLocation === `${location.key}:${location.pathname}` ? "block" : "none" }}>
      <OCRScan isActive={isActive} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/paper-preview" element={<ProtectedRoute allowedRoles={["admin", "faculty", "student"]}><ResearchDocumentPreview /></ProtectedRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/redirect" element={<RoleRedirect />} />
          <Route path="/" element={<Login />} />

          {/* Student routes */}
          <Route path="/student" element={<ProtectedRoute allowedRoles={["student"]}><StudentDashboard /></ProtectedRoute>} />
          <Route path="/student/submit" element={<ProtectedRoute allowedRoles={["student"]}><Submit /></ProtectedRoute>} />
          <Route path="/student/my-submissions" element={<ProtectedRoute allowedRoles={["student"]}><MySubmissions /></ProtectedRoute>} />
          <Route path="/student/archive" element={<ProtectedRoute allowedRoles={["student"]}><Archive /></ProtectedRoute>} />
          <Route path="/student/search" element={<ProtectedRoute allowedRoles={["student"]}><Search /></ProtectedRoute>} />
          <Route path="/student/profile" element={<ProtectedRoute allowedRoles={["student"]}><Profile /></ProtectedRoute>} />
          <Route path="/student/settings" element={<ProtectedRoute allowedRoles={["student"]}><Settings /></ProtectedRoute>} />

          {/* Faculty routes */}
          <Route path="/faculty" element={<ProtectedRoute allowedRoles={["faculty"]}><FacultyDashboard /></ProtectedRoute>} />
          <Route path="/faculty/my-submissions" element={<ProtectedRoute allowedRoles={["faculty"]}><MySubmissions /></ProtectedRoute>} />
          <Route path="/faculty/archive" element={<ProtectedRoute allowedRoles={["faculty"]}><Archive /></ProtectedRoute>} />
          <Route path="/faculty/search" element={<ProtectedRoute allowedRoles={["faculty"]}><Search /></ProtectedRoute>} />
          <Route path="/faculty/review" element={<ProtectedRoute allowedRoles={["faculty"]}><ReviewApproval /></ProtectedRoute>} />
          <Route path="/faculty/analytics" element={<ProtectedRoute allowedRoles={["faculty"]}><Analytics /></ProtectedRoute>} />
          <Route path="/faculty/profile" element={<ProtectedRoute allowedRoles={["faculty"]}><Profile /></ProtectedRoute>} />
          <Route path="/faculty/settings" element={<ProtectedRoute allowedRoles={["faculty"]}><Settings /></ProtectedRoute>} />

          {/* Admin routes */}
          <Route path="/admin" element={<ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRoles={["admin"]}><UserManagement /></ProtectedRoute>} />
          <Route path="/admin/academic-years" element={<ProtectedRoute allowedRoles={["admin"]}><AcademicYearManagement /></ProtectedRoute>} />
          <Route path="/admin/ocr" element={<ProtectedRoute allowedRoles={["admin"]}><div /></ProtectedRoute>} />
          <Route path="/admin/review" element={<ProtectedRoute allowedRoles={["admin"]}><ReviewApproval /></ProtectedRoute>} />
          <Route path="/admin/archive" element={<ProtectedRoute allowedRoles={["admin"]}><AdminArchive /></ProtectedRoute>} />
          <Route path="/admin/search" element={<ProtectedRoute allowedRoles={["admin"]}><Search /></ProtectedRoute>} />
          <Route path="/admin/analytics" element={<ProtectedRoute allowedRoles={["admin"]}><Analytics /></ProtectedRoute>} />
          <Route path="/admin/profile" element={<ProtectedRoute allowedRoles={["admin"]}><Profile /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={["admin"]}><Settings /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <PersistentOCRScan />
        <PortalNavigationLoader />
        <PortalWelcome />
      </BrowserRouter>
    </AuthProvider>
  );
}
