export function normalizeAcademicYear(value) {
  return String(value || "").trim().replace(/\s*-\s*/g, "-");
}

export function validateAcademicYear(value) {
  const normalized = normalizeAcademicYear(value);
  const match = /^(\d{4})-(\d{4})$/.exec(normalized);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error("Please enter a valid academic year. The ending year must be exactly one year after the starting year.");
  }
  return normalized;
}
