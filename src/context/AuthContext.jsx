import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { normalizeEmail, validatePassword } from "../lib/authValidation";
import { validatePersonNameFields } from "../lib/nameValidation";
import { parseRecoveryCode, parseRecoveryParams } from "../lib/authRecovery";
import { getPasswordResetRedirectTo } from "../lib/authReset";
import { buildProfileState } from "../lib/authProfile";
import { applyAuthenticatedSession } from "../lib/authSession";

const AuthContext = createContext(null);

function formatAuthError(error) {
  if (!error) return null;

  const message = error.message?.toLowerCase() ?? "";

  if (message.includes("rate limit")) {
    return "Too many signup emails were sent recently. Please wait a few minutes, use a different email address, and try again.";
  }

  if (message.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }

  if (message.includes("failed to fetch") || message.includes("networkerror") || message.includes("network error")) {
    return "No internet connection. Please connect to the internet and try again.";
  }

  if (message.includes("email")) {
    return "Please enter a valid email address.";
  }

  return error.message;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recoverySession, setRecoverySession] = useState(false);

  async function loadProfile(userId, user = null) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) {
      console.error("Failed to load profile:", error.message);
      setProfile(buildProfileState(user));
    } else {
      setProfile(buildProfileState(user, data));
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;

      setSession(session);
      if (session?.user) await loadProfile(session.user.id, session.user);
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecoverySession(true);
      setSession(session);
      if (session?.user) {
        loadProfile(session.user.id, session.user);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.warn("Supabase signIn error:", error);
    }

    if (!error && data?.session?.user) {
      applyAuthenticatedSession({
        session: data.session,
        user: data.session.user,
        setSession,
        setProfile,
      });
      await loadProfile(data.session.user.id, data.session.user);
      return { error: null, friendlyError: null };
    }

    return { error, friendlyError: formatAuthError(error) };
  }

  async function updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    return { error, friendlyError: formatAuthError(error) };
  }

  async function resetPassword(email) {
    try {
      const redirectTo = getPasswordResetRedirectTo(typeof window !== "undefined" ? window.location.origin : "");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      return { error, friendlyError: formatAuthError(error) };
    } catch (error) {
      return { error, friendlyError: formatAuthError(error) };
    }
  }

  async function handleRecoveryLink() {
    if (typeof window === "undefined") return { handled: false, error: null };

    const { isRecovery, accessToken, refreshToken, type } = parseRecoveryParams(window.location.hash);
    const { isRecovery: hasCode, code } = parseRecoveryCode(window.location.search);
    if (!isRecovery && !hasCode) {
      return recoverySession ? { handled: true, error: null, type: "recovery" } : { handled: false, error: null };
    }

    try {
      const { data, error } = hasCode
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

      if (error) {
        return { handled: true, error, friendlyError: formatAuthError(error) };
      }

      if (data?.session) {
        setRecoverySession(true);
        setSession(data.session);
        if (data.session.user) {
          await loadProfile(data.session.user.id, data.session.user);
        }
      }

      return { handled: true, error: null, friendlyError: null, type: type || "recovery" };
    } catch (recoveryError) {
      return { handled: true, error: recoveryError, friendlyError: formatAuthError(recoveryError) };
    }
  }

  async function sendLoginCode(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    return { error, friendlyError: formatAuthError(error) };
  }

  async function verifyLoginCode(email, token) {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    return { data, error, friendlyError: formatAuthError(error) };
  }

  async function signUp({ email, password, fullName, firstName, middleName, lastName, suffix, role, studentNumber, program }) {
    const normalizedEmail = normalizeEmail(email);
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) {
      return { error: { message: passwordCheck.message }, friendlyError: passwordCheck.message, localFallback: false };
    }

    const normalizedRole = role === "faculty" ? "faculty" : "student";
    const resolvedFirstName = firstName ?? (fullName ? fullName.trim().split(/\s+/)[0] || "" : "");
    const resolvedMiddleName = middleName ?? "";
    const resolvedLastName = lastName ?? (fullName ? fullName.trim().split(/\s+/).slice(1).join(" ") || "" : "");
    const resolvedSuffix = suffix ?? "";
    const nameCheck = validatePersonNameFields({ first_name: resolvedFirstName, middle_name: resolvedMiddleName, last_name: resolvedLastName, suffix: resolvedSuffix });
    if (!nameCheck.ok) {
      const message = Object.values(nameCheck.errors)[0];
      return { error: { message }, friendlyError: message, localFallback: false };
    }
    const { first_name: cleanFirstName, middle_name: cleanMiddleName, last_name: cleanLastName, suffix: cleanSuffix } = nameCheck.normalized;
    const resolvedFullName = [cleanFirstName, cleanMiddleName, cleanLastName, cleanSuffix].filter(Boolean).join(" ");

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: resolvedFullName,
            first_name: cleanFirstName,
            middle_name: cleanMiddleName,
            last_name: cleanLastName,
            suffix: cleanSuffix,
            role: normalizedRole,
          },
        },
      });

      if (error) {
        console.warn("Supabase signup failed:", error.message);
        return { error, friendlyError: formatAuthError(error), localFallback: false, requiresConfirmation: false };
      }

      if (data?.user) {
        const { error: profileError } = await supabase
          .from("profiles")
          .upsert({
            id: data.user.id,
            email,
            full_name: resolvedFullName,
            first_name: cleanFirstName,
            middle_name: cleanMiddleName,
            last_name: cleanLastName,
            suffix: cleanSuffix,
            role: normalizedRole,
            student_number: normalizedRole === "student" ? studentNumber : null,
            faculty_number: normalizedRole === "faculty" ? studentNumber : null,
            program,
          });

        if (profileError) {
          console.error("Profile upsert failed:", profileError.message);
        }
      }

      if (data?.user && data?.session) {
        applyAuthenticatedSession({
          session: data.session,
          user: data.user,
          setSession,
          setProfile,
        });
        await loadProfile(data.user.id, data.user);
        return { error: null, friendlyError: null, localFallback: false, requiresConfirmation: false };
      }

      return { error: null, friendlyError: null, localFallback: false, requiresConfirmation: true };
    } catch (signupError) {
      console.warn("Supabase signup failed:", signupError);
      return { error: signupError, friendlyError: formatAuthError(signupError), localFallback: false, requiresConfirmation: false };
    }
  }

  async function signOut() {
    setSession(null);
    setProfile(null);
    await supabase.auth.signOut();
  }

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    loading,
    recoverySession,
    signIn,
    sendLoginCode,
    verifyLoginCode,
    signUp,
    signOut,
    updatePassword,
    resetPassword,
    handleRecoveryLink,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
