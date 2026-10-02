import { supabase, supabaseService, supabaseServiceConfigured } from "../lib/supabaseClient";
import { assertValidPersonNameFields } from "../lib/nameValidation";

export function shouldFallbackDeleteError(error) {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return message.includes("row-level security") || message.includes("permission denied") || message.includes("policy") || message.includes("not allowed") || message.includes("insufficient privilege");
}

/** User Management Module: list all users, optionally filtered by role */
export async function getUsers({ role } = {}) {
  const buildRequest = (client) => {
    let request = client.from("profiles").select("*").order("created_at", { ascending: false });
    if (role) request = request.eq("role", role);
    return request;
  };

  const { data, error } = await buildRequest(supabase);
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

  if (supabaseServiceConfigured && supabaseService?.auth?.admin?.createUser) {
    const { data, error } = await supabaseService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (!error) return data;

    const message = (error.message || "").toLowerCase();
    if (message.includes("invalid api key") || message.includes("401") || message.includes("unauthorized")) {
      console.warn("Supabase service key failed, falling back to anon signup:", error);
    } else {
      throw error;
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
      data: metadata,
    },
  });
  if (error) throw error;
  return data;
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
