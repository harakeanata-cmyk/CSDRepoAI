import { useState } from "react";
import { Download, Eye } from "lucide-react";
import { getResearchDownloadUrl, isResearchStorageUrl, normalizeResearchFileUrls } from "../lib/researchFilePreview";
import { supabase } from "../lib/supabaseClient";
import { openResearchFile, recordResearchDownload } from "../services/research";

export default function ResearchFileActions({ paper, field = "file_url", label = "manuscript", urls, className = "" }) {
  const [error, setError] = useState("");
  const fileUrls = urls || normalizeResearchFileUrls(paper?.[field]);
  const downloadableUrls = fileUrls.filter((url) => isResearchStorageUrl(url, supabase.supabaseUrl));
  if (!fileUrls.length) return null;

  async function preview() {
    setError("");
    try {
      await openResearchFile(paper, field, label);
    } catch (previewError) {
      setError(previewError.message || "Could not open the paper preview.");
    }
  }

  return (
    <span className={`research-file-actions ${className}`.trim()}>
      <button type="button" className="search-file-action search-file-preview" onClick={preview} title={`Preview ${label} in a new tab`}>
        <Eye size={13} /> Preview {label}
      </button>
      {downloadableUrls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={getResearchDownloadUrl(url)}
          className="search-file-action"
          title={`Download original ${label}${downloadableUrls.length > 1 ? ` page ${index + 1}` : ""}`}
          onClick={() => recordResearchDownload(paper?.id)}
        >
          <Download size={13} /> Download {label}{downloadableUrls.length > 1 ? ` ${index + 1}` : ""}
        </a>
      ))}
      {error && <span className="research-file-action-error" role="alert">{error}</span>}
    </span>
  );
}
