import mammoth from "mammoth/mammoth.browser.js";

export async function openResearchPreviewInNewTab({ urls, title, label }) {
  const previewTab = window.open("about:blank", "_blank");
  if (!previewTab) throw new Error("Allow pop-ups for this site to open paper previews in a new tab.");

  previewTab.opener = null;
  previewTab.document.title = "Preparing paper preview";
  previewTab.document.body.textContent = "Preparing paper preview...";

  const objectUrls = [];
  const cleanupTimer = window.setInterval(() => {
    if (!previewTab.closed) return;
    window.clearInterval(cleanupTimer);
    objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
  }, 1000);

  try {
    const files = await Promise.all(urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load a paper file (${response.status}).`);

      const blob = await response.blob();
      const extension = getExtension(url);
      if (extension === "docx" || blob.type.includes("wordprocessingml.document")) {
        const result = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
        return { type: "text", content: result.value };
      }

      if (extension === "pdf" || blob.type === "application/pdf") {
        const objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        objectUrls.push(objectUrl);
        return { type: "pdf", src: objectUrl };
      }

      if (blob.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        return { type: "image", src: objectUrl };
      }

      return { type: "unsupported" };
    }));

    if (previewTab.closed) return;
    if (files.length === 1 && files[0].type === "pdf") {
      previewTab.location.replace(files[0].src);
      return;
    }

    const fileMarkup = files.map((file, index) => {
      const heading = files.length > 1 ? `<h2>Page ${index + 1}</h2>` : "";
      if (file.type === "image") return `${heading}<img src="${file.src}" alt="${escapeHtml(title)} - ${index + 1}">`;
      if (file.type === "pdf") return `${heading}<iframe src="${file.src}" title="${escapeHtml(title)} ${escapeHtml(label)}"></iframe>`;
      if (file.type === "text") return `${heading}<pre>${escapeHtml(file.content || "No readable document text was found.")}</pre>`;
      return `${heading}<p>This file type cannot be previewed in the browser. Return to the repository and open the original file.</p>`;
    }).join("");

    const documentHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(label)}</title><style>body{margin:0;padding:24px;background:#e9edf1;color:#17212b;font:16px/1.6 Arial,sans-serif}main{max-width:960px;margin:auto}h1{font-size:20px}h2{font-size:14px;color:#52606d}img,iframe{display:block;width:100%;max-height:90vh;object-fit:contain;margin:0 auto 24px;border:0;background:#fff}iframe{height:90vh}pre{padding:32px;background:#fff;white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.7 Arial,sans-serif}@media print{body{padding:0;background:#fff}main{max-width:none}img,iframe{max-height:none;page-break-after:always}}</style></head><body><main><h1>${escapeHtml(title)}</h1>${fileMarkup}</main></body></html>`;
    previewTab.document.open();
    previewTab.document.write(documentHtml);
    previewTab.document.close();
  } catch (error) {
    if (!previewTab.closed) {
      previewTab.document.body.textContent = `${error.message || "Could not open the paper preview."} Close this tab and try again, or use Open original.`;
    }
    throw error;
  }
}

function getExtension(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
