const REQUIRED_NAME_FIELDS = [
  ["first_name", "first name"],
  ["middle_name", "middle name"],
  ["last_name", "last name"],
];

// Keep each stored name within the database/UI limit and accept Unicode letters,
// common name separators, initials, and a trailing period (for example, "Jr.").
const MAX_PERSON_NAME_LENGTH = 100;
const VALID_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+|\.[\p{L}\p{M}]+)*(?:\.)?$/u;
const INVALID_NAME_MESSAGE = "Please enter a valid name. Letters, spaces, hyphens (-), apostrophes ('), periods (.), and accented letters are allowed (up to 100 characters).";

function normalizeName(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function validatePersonNameFields(values = {}) {
  const normalized = {};
  const errors = {};

  for (const [field, label] of REQUIRED_NAME_FIELDS) {
    const value = normalizeName(values[field]);
    normalized[field] = value;
    if (!value) {
      errors[field] = `Please enter your ${label}.`;
    } else if (value.length > MAX_PERSON_NAME_LENGTH || !VALID_NAME_PATTERN.test(value)) {
      errors[field] = INVALID_NAME_MESSAGE;
    }
  }

  const suffix = normalizeName(values.suffix);
  normalized.suffix = suffix;
  if (suffix && (suffix.length > MAX_PERSON_NAME_LENGTH || !(VALID_NAME_PATTERN.test(suffix) || /^(?:II|III|IV|V)$/i.test(suffix)))) {
    errors.suffix = INVALID_NAME_MESSAGE;
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
