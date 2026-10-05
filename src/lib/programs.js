export const PROGRAM_OPTIONS = [
  { value: "BSIT", label: "Bachelor of Science in Information Technology (BSIT)" },
  { value: "BSCS", label: "Bachelor of Science in Computer Science (BSCS)" },
  { value: "BSCpE", label: "Bachelor of Science in Computer Engineering (BSCpE)" },
  { value: "Associate/Diploma in Computer Technology", label: "Associate/Diploma in Computer Technology" },
  { value: "BLIS", label: "Bachelor of Library and Information Science (BLIS)" },
];

// Canonicalize legacy values already stored in profiles and research records.
export function normalizeProgram(program) {
  const value = String(program || "").trim();
  const normalized = value.toLocaleUpperCase();

  if (normalized === "BLISS") return "BLIS";
  if (normalized === "BSIS") return "";
  return value;
}
