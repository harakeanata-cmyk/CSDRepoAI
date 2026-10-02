import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Wraps a page and only renders it if the logged-in user's role
 * is included in `allowedRoles`. Otherwise redirects to /login
 * (if not logged in) or to their own dashboard (if wrong role).
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { session, role, loading, verifySession } = useAuth();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [sessionVerified, setSessionVerified] = useState(false);
  const [verifiedLocation, setVerifiedLocation] = useState(null);
  const checkId = useRef(0);
  const locationToken = `${location.key}:${location.pathname}`;

  useEffect(() => {
    if (loading) return undefined;
    let active = true;
    let pendingCheck = null;

    async function checkCurrentSession() {
      if (pendingCheck) return pendingCheck;
      const id = ++checkId.current;
      setChecking(true);
      setVerifiedLocation(null);
      pendingCheck = verifySession();
      try {
        const valid = await pendingCheck;
        if (active && id === checkId.current) {
          setSessionVerified(valid);
          setVerifiedLocation(valid ? locationToken : null);
        }
      } finally {
        if (active && id === checkId.current) setChecking(false);
        pendingCheck = null;
      }
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") void checkCurrentSession();
    }

    function checkOnPageShow() {
      void checkCurrentSession();
    }

    void checkCurrentSession();
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("pageshow", checkOnPageShow);

    return () => {
      active = false;
      checkId.current += 1;
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("pageshow", checkOnPageShow);
    };
  }, [loading, location.key, location.pathname, locationToken, verifySession]);

  if (loading || checking || verifiedLocation !== locationToken) return <div className="page-loading">Checking your session...</div>;

  if (!session || !sessionVerified) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={`/${role}`} replace />;
  }

  return children;
}
