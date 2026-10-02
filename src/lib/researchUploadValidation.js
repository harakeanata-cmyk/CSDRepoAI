export const MAX_RESEARCH_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_RESEARCH_UPLOAD_SIZE_LABEL = "50 MB";

const FILE_RULES = {
  manuscript: {
    extensions: ["pdf", "docx"],
    mimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    description: "PDF or DOCX research manuscript",
  },
  sourceCode: {
    extensions: ["zip"],
    mimeTypes: ["application/zip", "application/x-zip-compressed", "multipart/x-zip"],
    description: "ZIP source-code archive",
  },
  ieee: { extensions: ["pdf"], mimeTypes: ["application/pdf"], description: "PDF IEEE short paper" },
  acm: { extensions: ["pdf"], mimeTypes: ["application/pdf"], description: "PDF ACM style paper" },
  apa: { extensions: ["pdf"], mimeTypes: ["application/pdf"], description: "PDF APA style paper" },
};

export function validateResearchUploadFile(file, slot) {
  if (!file) return null;
  const rule = FILE_RULES[slot];
  if (!rule) return "This upload field is not supported.";
  if (file.size > MAX_RESEARCH_UPLOAD_SIZE_BYTES) {
    return `File is too large. Please upload a file within the ${MAX_RESEARCH_UPLOAD_SIZE_LABEL} size limit.`;
  }

  const extension = String(file.name || "").split(".").pop().toLowerCase();
  if (!rule.extensions.includes(extension)) {
    return `Invalid ${slot === "manuscript" ? "manuscript" : "file"} file. Please upload a ${rule.description}.`;
  }

  const mimeType = String(file.type || "").toLowerCase().split(";")[0].trim();
  const genericMimeTypes = ["", "application/octet-stream", "binary/octet-stream"];
  if (!genericMimeTypes.includes(mimeType) && !rule.mimeTypes.includes(mimeType)) {
    return `Invalid ${slot === "manuscript" ? "manuscript" : "file"} file. Please upload a ${rule.description}.`;
  }
  return null;
}

export function validateResearchUploadFiles(files = {}) {
  for (const [slot, file] of Object.entries(files)) {
    const error = validateResearchUploadFile(file, slot);
    if (error) throw new Error(error);
  }
}
