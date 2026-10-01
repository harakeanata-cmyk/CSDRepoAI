import { useEffect, useState } from "react";
import { ArrowLeft, Download, Minus, Plus, Printer } from "lucide-react";
import { getResearchDownloadUrl, isResearchStorageUrl, normalizeResearchFileUrls } from "../lib/researchFilePreview";
import { prepareResearchPreviewFile } from "../lib/researchFilePreviewRuntime";
import { supabase } from "../lib/supabaseClient";
import "./ResearchDocumentPreview.css";

const PREVIEW_STORAGE_PREFIX = "csdrepoai:paper-preview:";

function readPreviewPayload() {
  const key = new URLSearchParams(window.location.search).get("key");
  if (!key?.startsWith(PREVIEW_STORAGE_PREFIX)) return null;
  try {
    return { key, payload: JSON.parse(window.sessionStorage.getItem(key) || "null") };
  } catch {
    return null;
  }
}

export default function ResearchDocumentPreview() {
  const [previewData] = useState(readPreviewPayload);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const payload = previewData?.payload;

  useEffect(() => {
    window.opener = null;
    if (previewData?.key) window.sessionStorage.removeItem(previewData.key);
  }, [previewData]);

  useEffect(() => {
    if (!payload) {
      setError("This preview link has expired. Return to the archive and open the paper again.");
      setLoading(false);
      return;
    }

    const urls = normalizeResearchFileUrls(payload.urls);
    if (!urls.length) {
      setError("Preview is unavailable for this file. No manuscript file was found.");
      setLoading(false);
      return;
    }

    let active = true;
    Promise.all(urls.map((url) => prepareResearchPreviewFile(url, { checkMime: urls.length === 1 })))
      .then((nextFiles) => {
        if (!active) return;
        if (nextFiles.some((file) => !["pdf", "docx", "image"].includes(file.type))) {
          throw new Error("Unsupported manuscript file type.");
        }
        if (nextFiles.length === 1 && nextFiles[0].type === "pdf") {
          window.location.replace(nextFiles[0].url);
          return;
        }
        setFiles(nextFiles);
      })
      .catch((previewError) => {
        if (active) setError(previewError.message || "Could not identify the manuscript file.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [payload]);

  useEffect(() => {
    document.title = payload?.title ? `${payload.title} - CSDRepoAI Preview` : "Paper Preview - CSDRepoAI";
  }, [payload?.title]);

  function closePreview() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.history.back();
    }, 50);
  }

  const urls = normalizeResearchFileUrls(payload?.urls);

  return (
    <main className="research-preview" data-zoom={Math.round(zoom * 100)}>
      <header className="research-preview-toolbar">
        <button type="button" className="preview-tool preview-back" onClick={closePreview} title="Close preview" aria-label="Close preview">
          <ArrowLeft size={18} /> <span>Back</span>
        </button>
        <strong className="research-preview-title">{payload?.title || "Research paper"}</strong>
        <div className="preview-tool-group" aria-label="Document controls">
          <button type="button" className="preview-tool" onClick={() => setZoom((value) => Math.max(.5, value - .1))} title="Zoom out" aria-label="Zoom out"><Minus size={18} /></button>
          <button type="button" className="preview-zoom-value" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button type="button" className="preview-tool" onClick={() => setZoom((value) => Math.min(2, value + .1))} title="Zoom in" aria-label="Zoom in"><Plus size={18} /></button>
        </div>
        <button type="button" className="preview-tool" onClick={() => window.print()} title="Print paper" aria-label="Print paper"><Printer size={18} /><span>Print</span></button>
      </header>

      {loading && <p className="research-preview-status" role="status">Preparing paper preview...</p>}
      {error && (
        <section className="research-preview-error" role="alert">
          <p>Preview is unavailable for this file. You can download the original manuscript instead.</p>
          <OriginalDownloads urls={urls} />
        </section>
      )}
      {!loading && !error && (
        <div className="research-preview-pages">
          {files.map((file, index) => (
            <PreviewFile key={`${file.url}-${index}`} file={file} index={index} title={payload?.title || "Research paper"} onError={setError} />
          ))}
        </div>
      )}
    </main>
  );
}

function PreviewFile({ file, index, title, onError }) {
  const [status, setStatus] = useState(file.type === "docx" ? "Loading original document..." : "");
  const [actualType, setActualType] = useState(file.type);
  const [element, setElement] = useState(null);

  useEffect(() => {
    if (file.type !== "docx" || !element) return undefined;
    let active = true;
    const controller = new AbortController();

    async function renderDocument() {
      try {
        const response = await fetch(file.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load the original manuscript (${response.status}).`);
        const mime = response.headers.get("content-type");
        if (mime?.toLowerCase().includes("application/pdf")) {
          if (active) {
            setActualType("pdf");
            setStatus("");
          }
          return;
        }
        const bytes = await response.arrayBuffer();
        if (!active) return;
        setStatus("Rendering document pages...");
        const { renderAsync } = await import("docx-preview");
        await renderAsync(bytes, element, document.head, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
        if (active) setStatus("");
      } catch (renderError) {
        if (active) {
          setStatus("");
          onError("Preview is unavailable for this file. You can download the original manuscript instead.");
        }
      }
    }

    renderDocument();
    return () => {
      active = false;
      controller.abort();
    };
  }, [element, file, onError]);

  return (
    <section className={`research-preview-page${actualType === "image" ? " research-preview-image-page" : ""}`}>
      {status && <p className="research-preview-status" role="status">{status}</p>}
      {actualType === "image" && <img src={file.url} alt={`${title}, page ${index + 1}`} onError={() => onError("Preview is unavailable for this file. You can download the original manuscript instead.")} />}
      {actualType === "pdf" && <iframe src={file.url} title={`${title}, page ${index + 1}`} />}
      {actualType === "docx" && <div className="research-preview-docx" ref={setElement} />}
      {filesNeedDownloadLink(file) && <a className="preview-page-download" href={file.downloadUrl}><Download size={15} /> Download original{index ? ` page ${index + 1}` : ""}</a>}
    </section>
  );
}

function filesNeedDownloadLink(file) {
  return Boolean(file.downloadUrl);
}

function OriginalDownloads({ urls }) {
  const validUrls = urls.filter((url) => isResearchStorageUrl(url, supabase.supabaseUrl));
  if (!validUrls.length) return null;
  return (
    <div className="preview-original-downloads">
      {validUrls.map((url, index) => (
        <a key={`${url}-${index}`} href={getResearchDownloadUrl(url)}><Download size={15} /> Download original{validUrls.length > 1 ? ` ${index + 1}` : ""}</a>
      ))}
    </div>
  );
}
