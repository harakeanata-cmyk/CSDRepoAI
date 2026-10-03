import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
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
      </BrowserRouter>
    </AuthProvider>
  );
}
