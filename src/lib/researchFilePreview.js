const EXTENSION_TYPES = {
  pdf: "pdf",
  docx: "docx",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
};

const MIME_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/webp": "image",
};

export function normalizeResearchFileUrls(fileUrl) {
  if (!fileUrl) return [];
  if (Array.isArray(fileUrl)) return fileUrl.filter(Boolean);

  try {
    const parsed = JSON.parse(fileUrl);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [fileUrl];
  } catch {
    return [fileUrl];
  }
}

export function getResearchFileType(url, mimeType = "") {
  const mime = String(mimeType).split(";", 1)[0].trim().toLowerCase();
  if (MIME_TYPES[mime]) return MIME_TYPES[mime];

  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const extension = pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    return EXTENSION_TYPES[extension] || "unknown";
  } catch {
    return "unknown";
  }
}

export function isResearchStorageUrl(rawUrl, supabaseUrl) {
  try {
    const url = new URL(rawUrl);
    const base = new URL(supabaseUrl);
    const path = decodeURIComponent(url.pathname);
    const bucketPath = /^\/storage\/v1\/object\/(?:public|sign)\/research-files\//;
    return url.protocol === "https:" && url.origin === base.origin && bucketPath.test(path);
  } catch {
    return false;
  }
}

export function getResearchDownloadUrl(rawUrl) {
  const url = new URL(rawUrl);
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "research-paper")
    .replace(/[\r\n"\\]/g, "_");
  url.searchParams.set("download", filename || "research-paper");
  return url.href;
}
