import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { validatePassword } from "../lib/authValidation";
import { Field } from "../components/ui";

export default function Login() {
  const { signIn, handleRecoveryLink, updatePassword, resetPassword, signOut, recoverySession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const [failedLoginAttempts, setFailedLoginAttempts] = useState(0);
  const [lockoutStage, setLockoutStage] = useState(0);
  const [loginLockedUntil, setLoginLockedUntil] = useState(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    const previousColorScheme = root.style.colorScheme;

    root.dataset.theme = "light";
    root.style.colorScheme = "light";

    return () => {
      if (previousTheme) root.dataset.theme = previousTheme;
      else delete root.dataset.theme;
      root.style.colorScheme = previousColorScheme;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function processRecoveryLink() {
      const result = await handleRecoveryLink();
      if (!mounted) return;

      if (result?.handled && !result.error) {
        setRecoveryActive(true);
        setInfo("Your password reset link is active. Please choose a new password.");
        setError("");
      } else if (result?.handled && result.error) {
        setRecoveryActive(false);
        setError(result.friendlyError || "The password reset link is invalid or has expired.");
      }
    }

    processRecoveryLink();

    if (recoverySession) {
      setRecoveryActive(true);
      setInfo("Your password reset link is active. Please choose a new password.");
      setError("");
    }

    return () => {
      mounted = false;
    };
  }, [handleRecoveryLink, navigate, recoverySession]);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!loginLockedUntil) {
      setLockoutRemaining(0);
      return undefined;
    }

    function updateRemaining() {
      const remaining = Math.max(0, loginLockedUntil - Date.now());
      setLockoutRemaining(remaining);
      if (remaining === 0) {
        setLoginLockedUntil(0);
        setFailedLoginAttempts(0);
      }
    }

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [loginLockedUntil]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!isOnline) {
      setError("No internet connection. Please connect to the internet and try again.");
      return;
    }

    if (showResetPrompt) {
      if (!form.email) {
        setError("Please enter your email so we can send the reset link.");
        return;
      }

      setLoading(true);
      const result = await resetPassword(form.email);
      setLoading(false);

      // Keep the same response for known and unknown addresses, including provider errors.
      setInfo("If an account exists for that email, password reset instructions have been sent.");
      setShowResetPrompt(false);
      return;
    }

    if (recoveryActive) {
      if (newPassword !== confirmNewPassword) {
        setError("Passwords do not match.");
        return;
      }

      const passwordCheck = validatePassword(newPassword);
      if (!passwordCheck.ok) {
        setError(passwordCheck.message);
        return;
      }

      setLoading(true);
      const result = await updatePassword(newPassword);
      setLoading(false);

      if (result.error) {
        setError(result.friendlyError || result.error.message);
        return;
      }

      setNewPassword("");
      setConfirmNewPassword("");
      setForm((current) => ({ ...current, password: "" }));
      setRecoveryActive(false);
      await signOut();
      setResetComplete(true);
      setError("");
      setInfo("");
      return;
    }

    if (loginLockedUntil > Date.now()) {
      setError(`Too many incorrect password attempts. Please wait ${formatLockoutTime(lockoutRemaining)} before trying again.`);
      return;
    }

    setLoading(true);

    const result = await signIn(form.email, form.password);

    setLoading(false);

    if (result.error) {
      const nextAttempt = failedLoginAttempts + 1;
      setFailedLoginAttempts(nextAttempt);
      if (nextAttempt <= 5) {
        setError(`Incorrect email or password. You have ${5 - nextAttempt} attempt${5 - nextAttempt === 1 ? "" : "s"} remaining before a temporary login warning.`);
        return;
      }

      const lockoutSeconds = lockoutStage === 0 ? 30 : lockoutStage === 1 ? 60 : 180;
      setLockoutStage((stage) => Math.min(stage + 1, 2));
      setLoginLockedUntil(Date.now() + lockoutSeconds * 1000);
      setError(`Too many incorrect password attempts. Login is paused for ${formatLockoutTime(lockoutSeconds * 1000)}.`);
      return;
    }

    setFailedLoginAttempts(0);
    setLockoutStage(0);
    setLoginLockedUntil(0);
    navigate("/redirect");
  }

  function formatLockoutTime(milliseconds) {
    const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
    if (seconds >= 60) return `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? "" : "s"}`;
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <header className="auth-header">
          <div className="auth-logo-badge">
            <img src="/logo.png" alt="CSDRepoAI logo" className="auth-logo-image" />
          </div>
          <h1 className="auth-logo-wordmark">CSDRepoAI</h1>
          <p className="auth-logo-subtitle">Notre Dame of Marbel University</p>
        </header>

        <div className="auth-body">
          {!isOnline && (
            <p className="auth-error auth-connection-error" role="alert">
              No internet connection. Please connect to the internet and try again.
            </p>
          )}
          <form onSubmit={handleSubmit} className="auth-form">
            <h2>{resetComplete ? "Password reset complete" : recoveryActive ? "Set a new password" : showResetPrompt ? "Reset your password" : "Sign in to your account"}</h2>
            <p className="auth-form-sub">
              {resetComplete
                ? "Your password has been reset successfully. You can now sign in with your new password."
                : recoveryActive
                ? "Use the password reset link to choose a new password for your account."
                : showResetPrompt
                  ? "Enter your email and we will send you a password reset link."
                  : "Use your institutional credentials."}
            </p>

            {recoveryActive && (
              <>
                <Field label="New password">
                  <div className="password-field">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="New password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="input password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="password-toggle"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
                <Field label="Confirm new password">
                  <div className="password-field">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      required
                      className="input password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="password-toggle"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
              </>
            )}

            {!recoveryActive && !resetComplete && (
              <Field label="Email">
                <input
                  type="email"
                  placeholder="you@ndmu.edu.ph"
                  value={form.email}
                  onChange={update("email")}
                  required
                  className="input"
                />
              </Field>
            )}

            {!showResetPrompt && !recoveryActive && !resetComplete && (
              <Field label="Password">
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={form.password}
                    onChange={update("password")}
                    required
                    className="input password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="password-toggle"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
            )}

            {error && <p className="auth-error">{error}</p>}
            {info && <p className="auth-info">{info}</p>}

            {resetComplete ? (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => {
                  setResetComplete(false);
                  setShowResetPrompt(false);
                  setError("");
                  setInfo("");
                  setForm((current) => ({ ...current, password: "" }));
                }}
              >
                Back to Login
              </button>
            ) : !recoveryActive && (
              <div className="auth-button-stack">
                <button type="submit" disabled={loading || lockoutRemaining > 0} className="btn btn-primary btn-block">
                  {loading ? "Please wait..." : lockoutRemaining > 0 ? `Try again in ${formatLockoutTime(lockoutRemaining)}` : showResetPrompt ? "Send Reset Link" : "Log In"}
                </button>
                <div className="auth-links">
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetPrompt((value) => !value);
                      setError("");
                      setInfo("");
                    }}
                    className="auth-switch"
                  >
                    {showResetPrompt ? "Back to sign in" : "Forgot password?"}
                  </button>
                </div>
              </div>
            )}

            {recoveryActive && (
              <>
                <button type="submit" disabled={loading} className="btn btn-primary btn-block">
                  {loading ? "Please wait..." : "Reset Password"}
                </button>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
