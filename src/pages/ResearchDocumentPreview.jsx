import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Minus, Plus, Printer } from "lucide-react";
import { getResearchDownloadUrl, isResearchStorageUrl, normalizeResearchFileUrls } from "../lib/researchFilePreview";
import { prepareResearchPreviewFile } from "../lib/researchFilePreviewRuntime";
import { supabase } from "../lib/supabaseClient";
import { recordResearchDownload } from "../services/research";
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
    // Keep this tab's unique payload in its sessionStorage so a refresh can
    // rebuild the authorized preview. Each preview tab has its own storage copy.
    window.opener = null;
  }, []);

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
    Promise.allSettled(urls.map((url) => prepareResearchPreviewFile(url, { checkMime: urls.length === 1 })))
      .then((results) => {
        if (!active) return;
        const nextFiles = results.map((result, index) => result.status === "fulfilled"
          ? result.value
          : {
            url: urls[index],
            type: "error",
            error: result.reason?.message || "Could not load this page.",
            downloadUrl: isResearchStorageUrl(urls[index], supabase.supabaseUrl) ? getResearchDownloadUrl(urls[index]) : null,
          });
        if (nextFiles.every((file) => file.type === "error")) throw new Error("Could not load any of the original paper files.");
        if (nextFiles.some((file) => file.type !== "error" && !["pdf", "docx", "image"].includes(file.type))) {
          throw new Error("Unsupported manuscript file type.");
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
    document.title = payload?.title ? `${payload.title} - ${payload.label || "manuscript"} - CSDRepoAI` : "Paper Preview - CSDRepoAI";
  }, [payload?.title, payload?.label]);

  function closePreview() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.history.back();
    }, 50);
  }

  const urls = normalizeResearchFileUrls(payload?.urls);
  const downloadUrls = urls.filter((url) => isResearchStorageUrl(url, supabase.supabaseUrl));

  return (
    <main className="research-preview" data-zoom={Math.round(zoom * 100)}>
      <header className="research-preview-toolbar">
        <button type="button" className="preview-tool preview-back" onClick={closePreview} title="Close preview" aria-label="Close preview">
          <ArrowLeft size={18} /> <span>Back</span>
        </button>
        <strong className="research-preview-title">{payload?.title || "Research paper"} - {payload?.label || "manuscript"}</strong>
        <div className="preview-tool-group" aria-label="Document controls">
          <button type="button" className="preview-tool" onClick={() => setZoom((value) => Math.max(.5, value - .1))} title="Zoom out" aria-label="Zoom out"><Minus size={18} /></button>
          <button type="button" className="preview-zoom-value" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button type="button" className="preview-tool" onClick={() => setZoom((value) => Math.min(2, value + .1))} title="Zoom in" aria-label="Zoom in"><Plus size={18} /></button>
        </div>
        <button type="button" className="preview-tool" onClick={() => window.print()} title="Print paper" aria-label="Print paper"><Printer size={18} /><span>Print</span></button>
        {downloadUrls.length === 1 && (
          <a className="preview-tool" href={getResearchDownloadUrl(downloadUrls[0])} onClick={() => recordResearchDownload(payload?.paperId)} title="Download original file" aria-label="Download original file">
            <Download size={18} /><span>Download</span>
          </a>
        )}
      </header>

      {loading && <p className="research-preview-status" role="status">Preparing paper preview...</p>}
      {error && (
        <section className="research-preview-error" role="alert">
          <p>{error} You can download the original file instead.</p>
          <OriginalDownloads urls={urls} paperId={payload?.paperId} />
        </section>
      )}
      {!loading && !error && (
        <div className="research-preview-pages">
          {files.map((file, index) => (
            file.type === "pdf" ? (
              <PDFDocumentPreview
                key={`${file.url}-${index}`}
                file={file}
                title={payload?.title || "Research paper"}
                paperId={payload?.paperId}
                zoom={zoom}
                showDownload={downloadUrls.length > 1}
              />
            ) : (
              <PreviewFile key={`${file.url}-${index}`} file={file} index={index} title={payload?.title || "Research paper"} paperId={payload?.paperId} showPageDownload={downloadUrls.length > 1} onError={setError} />
            )
          ))}
        </div>
      )}
    </main>
  );
}

function PreviewFile({ file, index, title, paperId, showPageDownload, onError }) {
  const [status, setStatus] = useState(["docx", "pdf"].includes(file.type) ? "Loading original document..." : "");
  const [actualType, setActualType] = useState(file.type);
  const [element, setElement] = useState(null);
  const [styleContainer, setStyleContainer] = useState(null);

  useEffect(() => {
    if (file.type !== "docx" || !element || !styleContainer) return undefined;
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
        await renderAsync(bytes, element, styleContainer, {
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
  }, [element, file, onError, styleContainer]);

  if (actualType === "pdf") {
    return <PDFDocumentPreview file={file} title={title} paperId={paperId} showDownload={showPageDownload} />;
  }

  return (
    <section className={`research-preview-page${actualType === "image" ? " research-preview-image-page" : ""}`}>
      {status && <p className="research-preview-status" role="status">{status}</p>}
      {actualType === "error" && <p className="research-preview-status" role="alert">Page {index + 1} could not be loaded. {file.error} {file.downloadUrl && <a href={file.downloadUrl} onClick={() => recordResearchDownload(paperId)}>Download original page</a>}</p>}
      {actualType === "image" && <img src={file.url} alt={`${title}, page ${index + 1}`} onError={() => setStatus("This image could not be previewed. Use Download original below.")} />}
      {actualType === "docx" && (
        <>
          <div className="research-preview-docx-styles" ref={setStyleContainer} />
          <div className="research-preview-docx" ref={setElement} />
        </>
      )}
      {showPageDownload && filesNeedDownloadLink(file) && <a className="preview-page-download" href={file.downloadUrl} onClick={() => recordResearchDownload(paperId)}><Download size={15} /> Download original page {index + 1}</a>}
    </section>
  );
}

function PDFDocumentPreview({ file, title, paperId, zoom = 1, showDownload = false }) {
  const [pdfData, setPdfData] = useState(null);
  const [pages, setPages] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let documentTask;
    const controller = new AbortController();

    async function loadPdf() {
      try {
        const response = await fetch(file.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load the original PDF (${response.status}).`);
        const bytes = await response.arrayBuffer();
        const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        GlobalWorkerOptions.workerSrc = workerModule.default || workerModule;
        documentTask = getDocument({ data: bytes });
        const pdf = await documentTask.promise;
        if (!active) {
          await pdf.destroy();
          return;
        }
        const pageInfo = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1);
          const viewport = page.getViewport({ scale: 1 });
          return { page, width: viewport.width, height: viewport.height, number: index + 1 };
        }));
        if (active) {
          setPages(pageInfo);
          setPdfData(pdf);
        } else {
          await pdf.destroy();
        }
      } catch (loadError) {
        if (active && loadError.name !== "AbortError") {
          setError(loadError.message || "Could not render this PDF.");
        }
      }
    }

    loadPdf();
    return () => {
      active = false;
      controller.abort();
      documentTask?.destroy();
    };
  }, [file.url]);

  if (error) {
    return (
      <section className="research-preview-pdf-error" role="alert">
        <p>{error} The original PDF is still available.</p>
        {file.downloadUrl && <a className="preview-page-download" href={file.downloadUrl} onClick={() => recordResearchDownload(paperId)}><Download size={15} /> Download original PDF</a>}
      </section>
    );
  }

  if (!pdfData) return <p className="research-preview-status" role="status">Preparing PDF pages...</p>;

  return (
    <>
      {pages.map((page) => <PDFPage key={page.number} page={page} title={title} zoom={zoom} />)}
      {showDownload && file.downloadUrl && (
        <div className="research-preview-pdf-download">
          <a className="preview-page-download" href={file.downloadUrl} onClick={() => recordResearchDownload(paperId)}><Download size={15} /> Download original PDF</a>
        </div>
      )}
    </>
  );
}

function PDFPage({ page, title, zoom }) {
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(page.number === 1);
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    const element = pageRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "1000px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvasRef.current) return undefined;
    let cancelled = false;
    let renderTask;

    async function drawPage() {
      try {
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        const cssWidth = Math.min(850, Math.max(280, window.innerWidth - 32));
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.page.getViewport({ scale: (cssWidth / page.width) * outputScale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        renderTask = page.page.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (pageError) {
        if (!cancelled && pageError.name !== "RenderingCancelledException") {
          setRenderError("This page could not be rendered.");
        }
      }
    }

    drawPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [page, visible]);

  return (
    <section
      ref={pageRef}
      className="research-preview-page research-preview-pdf-page"
      style={{ aspectRatio: `${page.width} / ${page.height}`, zoom }}
      aria-label={`${title}, page ${page.number}`}
    >
      <canvas ref={canvasRef} aria-label={`${title}, page ${page.number}`} />
      {renderError && <p className="research-preview-pdf-page-error" role="alert">{renderError}</p>}
    </section>
  );
}

function filesNeedDownloadLink(file) {
  return Boolean(file.downloadUrl);
}

function OriginalDownloads({ urls, paperId }) {
  const validUrls = urls.filter((url) => isResearchStorageUrl(url, supabase.supabaseUrl));
  if (!validUrls.length) return null;
  return (
    <div className="preview-original-downloads">
      {validUrls.map((url, index) => (
        <a key={`${url}-${index}`} href={getResearchDownloadUrl(url)} onClick={() => recordResearchDownload(paperId)}><Download size={15} /> Download original{validUrls.length > 1 ? ` ${index + 1}` : ""}</a>
      ))}
    </div>
  );
}
