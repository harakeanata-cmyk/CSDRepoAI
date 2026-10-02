import { supabase } from "../lib/supabaseClient";
import { assertValidPersonNameFields } from "../lib/nameValidation";
import { toGenkitEndpoint } from "../lib/genkitUrl.js";

const ADMIN_USERS_URL = toGenkitEndpoint(
  import.meta.env.VITE_GENKIT_SEARCH_URL || (import.meta.env.PROD && typeof window !== "undefined" ? window.location.origin : "http://localhost:8787"),
  "admin/users",
);

export function shouldFallbackDeleteError(error) {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return message.includes("row-level security") || message.includes("permission denied") || message.includes("policy") || message.includes("not allowed") || message.includes("insufficient privilege");
}

/** User Management Module: list all users, optionally filtered by role */
export async function getUsers({ role } = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.access_token) throw new Error("Please sign in again to load the user directory.");

  let request = supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (role) request = request.eq("role", role);
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

export async function createUserAccount({ email, password, full_name, first_name, middle_name, last_name, suffix, role, student_number, faculty_number, program }) {
  const names = assertValidPersonNameFields({ first_name, middle_name, last_name, suffix });
  first_name = names.first_name;
  middle_name = names.middle_name;
  last_name = names.last_name;
  suffix = names.suffix;
  const resolvedFullName = [first_name, middle_name, last_name, suffix].filter(Boolean).join(" ").trim() || full_name || "";
  const metadata = {
    full_name: resolvedFullName,
    first_name,
    middle_name,
    last_name,
    suffix,
    role,
    student_number,
    faculty_number,
    program,
  };

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Please sign in again to create a user account.");

  const response = await fetch(ADMIN_USERS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ email, password, ...metadata }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Unable to create the account.");
  return result.user;
}

/** User Management Module: change a user's role */
export async function updateUserRole(userId, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}

/** User Management Module: activate/deactivate an account */
export async function setUserActive(userId, isActive) {
  const { error } = await supabase.from("profiles").update({ is_active: isActive }).eq("id", userId);
  if (error) throw error;
}

/** User Management Module: permanently remove a user's profile record.
 *  Note: this removes their profile/app access. Fully deleting the underlying
 *  auth.users row requires the service_role key and should be done from a
 *  secure server context (e.g. a Supabase Edge Function), never the browser. */
export async function deleteUserProfile(userId) {
  try {
    const { error } = await supabase.from("profiles").delete().eq("id", userId);
    if (!error) {
      return { success: true, deleted: true };
    }

    if (shouldFallbackDeleteError(error)) {
      const { error: deactivateError } = await supabase.from("profiles").update({ is_active: false }).eq("id", userId);
      if (deactivateError) {
        throw new Error("Deleting users is blocked by the current database permissions. Please enable the required Supabase policies or run this from a secure server context.");
      }
      return { success: true, deleted: false, deactivated: true };
    }

    throw error;
  } catch (error) {
    if (shouldFallbackDeleteError(error)) {
      throw new Error("Deleting users is blocked by the current database permissions. Please enable the required Supabase policies or run this from a secure server context.");
    }
    throw error;
  }
}

/** Profile Management Module: update your own profile */
export async function updateProfile(userId, updates) {
  const names = assertValidPersonNameFields(updates);
  const { error } = await supabase.from("profiles").update({ ...updates, ...names }).eq("id", userId);
  if (error) throw error;
}
