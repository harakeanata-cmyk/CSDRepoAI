import mammoth from "mammoth/mammoth.browser.js";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export async function openResearchPreviewInNewTab({ urls, title, label, getDocumentText }) {
  const previewTab = window.open("about:blank", "_blank");
  if (!previewTab) throw new Error("Allow pop-ups for this site to open paper previews in a new tab.");

  previewTab.opener = null;
  const files = urls.map((url) => ({ url: getInlineUrl(url), extension: getExtension(url) }));

  if (files.length === 1 && files[0].extension === "pdf") {
    previewTab.location.replace(files[0].url);
    return;
  }
  if (files.length === 1 && IMAGE_EXTENSIONS.has(files[0].extension)) {
    previewTab.location.replace(files[0].url);
    return;
  }

  const textFiles = [];
  const controller = new AbortController();
  const timer = window.setInterval(() => {
    if (!previewTab.closed) return;
    controller.abort();
    window.clearInterval(timer);
  }, 1000);

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file.extension !== "docx") continue;

      writeLoadingPage(previewTab, title, label, "Loading searchable manuscript text...", 0);
      let extractedText = "";
      try {
        extractedText = await getDocumentText?.();
      } catch {
        // Fall back to extracting text from the original document.
      }
      if (previewTab.closed) return;
      if (extractedText) {
        textFiles.push({ index, content: extractedText, fromArchive: true });
        continue;
      }

      updateLoadingMessage(previewTab, "Connecting to manuscript...");
      const response = await fetch(file.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load the paper (${response.status}).`);
      const totalBytes = Number(response.headers.get("content-length")) || 0;
      const reader = response.body?.getReader();
      updateLoadingMessage(previewTab, "Loading document...");
      const chunks = [];
      let loadedBytes = 0;
      let documentBytes;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedBytes += value.byteLength;
          updateLoadingPage(previewTab, loadedBytes, totalBytes);
        }

        documentBytes = new Uint8Array(loadedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          documentBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } else {
        const buffer = await response.arrayBuffer();
        loadedBytes = buffer.byteLength;
        documentBytes = new Uint8Array(buffer);
        updateLoadingPage(previewTab, loadedBytes, totalBytes);
      }

      if (previewTab.closed) return;
      updateLoadingMessage(previewTab, "Preparing document for print and reading...");
      const result = await mammoth.extractRawText({ arrayBuffer: documentBytes.buffer });
      textFiles.push({ index, content: result.value, fromArchive: false });
    }

    if (previewTab.closed) return;
    const textByIndex = new Map(textFiles.map((file) => [file.index, file.content]));
    const archivedTextIndexes = new Set(textFiles.filter((file) => file.fromArchive).map((file) => file.index));
    const fileMarkup = files.map((file, index) => {
      const heading = files.length > 1 ? `<h2>File ${index + 1}</h2>` : "";
      if (file.extension === "pdf") return `${heading}<iframe src="${escapeHtml(file.url)}" title="${escapeHtml(title)} ${escapeHtml(label)}"></iframe>`;
      if (IMAGE_EXTENSIONS.has(file.extension)) return `${heading}<img src="${escapeHtml(file.url)}" alt="${escapeHtml(title)} - ${index + 1}">`;
      if (textByIndex.has(index)) {
        const note = archivedTextIndexes.has(index)
          ? '<p class="notice">Text preview. Page layout and figures may differ from the original file.</p>'
          : "";
        return `${heading}${note}<pre>${escapeHtml(textByIndex.get(index) || "No readable document text was found.")}</pre>`;
      }
      return `${heading}<p>This file type cannot be previewed in the browser. Return to the repository and choose Open original.</p>`;
    }).join("");

    previewTab.document.open();
    previewTab.document.write(buildPreviewDocument(title, label, fileMarkup));
    previewTab.document.close();
  } catch (error) {
    if (!previewTab.closed) writeErrorPage(previewTab, error.message || "Could not open the paper preview.");
    throw error;
  } finally {
    window.clearInterval(timer);
  }
}

function writeLoadingPage(tab, title, label, message, percent) {
  tab.document.open();
  tab.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(label)}</title><style>body{margin:0;background:#f2f5f7;color:#17212b;font:16px/1.5 Arial,sans-serif}.panel{max-width:540px;margin:16vh auto;padding:28px}h1{font-size:20px}.track{height:8px;overflow:hidden;border-radius:8px;background:#dce3e8}.bar{height:100%;width:${percent}%;background:#1f7a68;transition:width .15s}.status{margin-top:12px;color:#52606d;font-size:14px}@media(max-width:600px){.panel{margin:12vh 16px;padding:18px}}</style></head><body><main class="panel"><h1>${escapeHtml(title)}</h1><div class="track"><div class="bar" id="bar"></div></div><p class="status" id="status">${escapeHtml(message)}</p></main></body></html>`);
  tab.document.close();
}

function updateLoadingPage(tab, loadedBytes, totalBytes) {
  const percent = totalBytes ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 0;
  const bar = tab.document.getElementById("bar");
  const status = tab.document.getElementById("status");
  if (bar) bar.style.width = `${percent}%`;
  if (status) {
    const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
    status.textContent = totalBytes
      ? `Loading document... ${percent}% (${loadedMb} MB)`
      : `Loading document... ${loadedMb} MB`;
  }
}

function updateLoadingMessage(tab, message) {
  const bar = tab.document.getElementById("bar");
  const status = tab.document.getElementById("status");
  if (bar) bar.style.width = "100%";
  if (status) status.textContent = message;
}

function writeErrorPage(tab, message) {
  tab.document.body.textContent = message;
}

function buildPreviewDocument(title, label, content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(label)}</title><style>body{margin:0;padding:24px;background:#e9edf1;color:#17212b;font:16px/1.6 Arial,sans-serif}main{max-width:960px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:20px}h2{font-size:14px;color:#52606d}button{padding:8px 14px;border:0;border-radius:4px;background:#1f7a68;color:white;font:inherit;cursor:pointer}img,iframe{display:block;width:100%;max-height:90vh;object-fit:contain;margin:0 auto 24px;border:0;background:#fff}iframe{height:90vh}pre{padding:32px;background:#fff;white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.7 Arial,sans-serif}@media(max-width:600px){body{padding:12px}pre{padding:18px}}@media print{body{padding:0;background:#fff}main{max-width:none}header button{display:none}img,iframe{max-height:none;page-break-after:always}pre{padding:0}}</style></head><body><main><header><h1>${escapeHtml(title)}</h1><button type="button" onclick="window.print()">Print</button></header>${content}</main></body></html>`;
}

function getInlineUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("This file does not have a supported preview URL.");
  url.searchParams.delete("download");
  return url.href;
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
