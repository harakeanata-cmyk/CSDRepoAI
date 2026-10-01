import { useEffect, useState } from "react";
import mammoth from "mammoth/mammoth.browser.js";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";

export default function ResearchPreview({ title, label, urls, onClose }) {
  const [fileIndex, setFileIndex] = useState(0);
  const [preview, setPreview] = useState({ status: "loading" });
  const url = urls[fileIndex];

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadPreview() {
      setPreview({ status: "loading" });
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load this paper (${response.status}).`);
        const blob = await response.blob();
        const extension = getExtension(url);

        if (extension === "pdf") {
          objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
          if (!cancelled) setPreview({ status: "ready", type: "pdf", src: objectUrl });
        } else if (extension === "docx") {
          const result = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
          if (!cancelled) setPreview({ status: "ready", type: "text", text: result.value });
        } else if (blob.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setPreview({ status: "ready", type: "image", src: objectUrl });
        } else {
          if (!cancelled) setPreview({ status: "unsupported" });
        }
      } catch (error) {
        if (!cancelled) setPreview({ status: "error", message: error.message || "Could not load this paper preview." });
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="research-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="research-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${label}: ${title}`}>
        <header className="research-preview-toolbar">
          <div className="research-preview-heading">
            <strong>{title}</strong>
            <span>{label}{urls.length > 1 ? ` - File ${fileIndex + 1} of ${urls.length}` : ""}</span>
          </div>
          <div className="research-preview-actions">
            {urls.length > 1 && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFileIndex((index) => Math.max(0, index - 1))} disabled={fileIndex === 0} aria-label="Previous file">
                  <ChevronLeft size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFileIndex((index) => Math.min(urls.length - 1, index + 1))} disabled={fileIndex === urls.length - 1} aria-label="Next file">
                  <ChevronRight size={15} />
                </button>
              </>
            )}
            <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer" title="Open the original file in a new tab">
              <ExternalLink size={14} /> Open original
            </a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close preview" title="Close preview">
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="research-preview-content">
          {preview.status === "loading" && <p role="status">Loading preview...</p>}
          {preview.status === "error" && <p className="auth-error" role="alert">{preview.message} You can open the original file in a new tab.</p>}
          {preview.status === "unsupported" && <p role="status">This file type cannot be previewed here. You can open the original file in a new tab.</p>}
          {preview.type === "pdf" && <iframe className="research-preview-pdf" src={preview.src} title={`${title} ${label} preview`} />}
          {preview.type === "image" && <img className="research-preview-image" src={preview.src} alt={`${title} ${label}`} />}
          {preview.type === "text" && <article className="research-preview-text"><pre>{preview.text || "No readable document text was found."}</pre></article>}
        </div>
      </section>
    </div>
  );
}

function getExtension(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}
