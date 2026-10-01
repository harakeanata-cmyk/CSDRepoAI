import { supabase } from "./supabaseClient";
import { getResearchDownloadUrl, getResearchFileType, isResearchStorageUrl } from "./researchFilePreview";

export async function prepareResearchPreviewFile(rawUrl, { checkMime = false } = {}) {
  if (!isResearchStorageUrl(rawUrl, supabase.supabaseUrl)) {
    throw new Error("This file is not in the research-files storage bucket.");
  }

  const url = new URL(rawUrl);
  url.searchParams.delete("download");
  let type = getResearchFileType(url.href);
  if (type === "unknown" || type === "docx" || checkMime) {
    try {
      const response = await fetch(url.href, { method: "HEAD" });
      if (response.ok) {
        const detectedType = getResearchFileType(url.href, response.headers.get("content-type"));
        if (detectedType !== "unknown") type = detectedType;
      }
    } catch {
      if (type === "unknown") throw new Error("Could not identify this file type.");
    }
  }

  return {
    url: url.href,
    type,
    downloadUrl: getResearchDownloadUrl(url.href),
  };
}
