export function buildProfileState(user, profileData = null) {
  if (!user) return null;

  const metadata = user?.user_metadata ?? {};
  const normalizedEmail = (user?.email || profileData?.email || "").trim().toLowerCase();
  const inferredRole = profileData?.role || metadata.role || (normalizedEmail === "admin@csdrepoai.com" ? "admin" : null);

  const firstName = profileData?.first_name ?? metadata.first_name ?? null;
  const middleName = profileData?.middle_name ?? metadata.middle_name ?? null;
  const lastName = profileData?.last_name ?? metadata.last_name ?? null;
  const suffix = profileData?.suffix ?? metadata.suffix ?? null;
  const derivedFullName = profileData?.full_name || metadata.full_name || [firstName, middleName, lastName, suffix].filter(Boolean).join(" ") || null;

  return {
    id: profileData?.id || user.id,
    email: profileData?.email || user.email || null,
    full_name: derivedFullName,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    suffix,
    role: inferredRole,
    student_number: profileData?.student_number ?? null,
    faculty_number: profileData?.faculty_number ?? null,
    program: profileData?.program ?? null,
    is_active: profileData?.is_active ?? true,
  };
}
