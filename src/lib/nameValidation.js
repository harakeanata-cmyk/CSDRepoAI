const REQUIRED_NAME_FIELDS = [
  ["first_name", "first name"],
  ["middle_name", "middle name"],
  ["last_name", "last name"],
];

// Unicode letters and combining marks support names from a wide range of languages.
// Separators are limited to ordinary spaces, apostrophes, periods, and hyphens.
const VALID_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*$/u;

export function validatePersonNameFields(values = {}) {
  const normalized = {};
  const errors = {};

  for (const [field, label] of REQUIRED_NAME_FIELDS) {
    const value = String(values[field] ?? "").trim();
    normalized[field] = value;
    if (!value) {
      errors[field] = `Please enter your ${label}.`;
    } else if (!VALID_NAME_PATTERN.test(value)) {
      errors[field] = `Please enter a valid ${label}. Numbers are not allowed.`;
    }
  }

  const suffix = String(values.suffix ?? "").trim();
  normalized.suffix = suffix;
  if (suffix && !(/^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*$/u.test(suffix) || /^(?:II|III|IV|V)$/i.test(suffix))) {
    errors.suffix = "Please enter a valid suffix.";
  }

  return { ok: Object.keys(errors).length === 0, errors, normalized };
}

export function assertValidPersonNameFields(values) {
  const result = validatePersonNameFields(values);
  if (!result.ok) {
    const error = new Error(Object.values(result.errors)[0]);
    error.fieldErrors = result.errors;
    throw error;
  }
  return result.normalized;
}
