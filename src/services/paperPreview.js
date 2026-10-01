const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export async function openResearchPreviewInNewTab({ urls, title, label }) {
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

  const controller = new AbortController();
  const timer = window.setInterval(() => {
    if (!previewTab.closed) return;
    controller.abort();
    window.clearInterval(timer);
  }, 1000);

  try {
    previewTab.document.open();
    previewTab.document.write(buildPreviewShell(title, label, files.length));
    previewTab.document.close();

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const content = previewTab.document.getElementById(`file-${index}`);
      const status = previewTab.document.getElementById(`status-${index}`);
      if (file.extension === "docx") {
        file.contentType = await getContentType(file.url, controller.signal);
        if (file.contentType?.includes("application/pdf")) {
          if (files.length === 1) {
            previewTab.location.replace(file.url);
            return;
          }
          file.extension = "pdf";
        }
      }
      if (file.extension === "pdf") {
        content.innerHTML = `<iframe src="${escapeHtml(file.url)}" title="${escapeHtml(title)} ${escapeHtml(label)}"></iframe>`;
        continue;
      }
      if (IMAGE_EXTENSIONS.has(file.extension)) {
        content.innerHTML = `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(title)} - ${index + 1}">`;
        continue;
      }
      if (file.extension !== "docx") {
        content.textContent = "This file type cannot be previewed in the browser.";
        status.remove();
        continue;
      }

      status.textContent = "Connecting to manuscript...";
      const response = await fetch(file.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load the paper (${response.status}).`);
      const totalBytes = Number(response.headers.get("content-length")) || 0;
      const reader = response.body?.getReader();
      status.textContent = "Loading original document...";
      const chunks = [];
      let loadedBytes = 0;
      let documentBytes;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedBytes += value.byteLength;
          updateLoadingPage(status, loadedBytes, totalBytes);
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
        updateLoadingPage(status, loadedBytes, totalBytes);
      }

      if (previewTab.closed) return;
      status.textContent = "Rendering original page layout...";
      const { renderAsync } = await import("docx-preview");
      await renderAsync(documentBytes.buffer, content, previewTab.document.head, {
        className: "docx",
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      });
      status.remove();
    }
  } catch (error) {
    if (!previewTab.closed) writeErrorPage(previewTab, error.message || "Could not open the paper preview.");
    throw error;
  } finally {
    window.clearInterval(timer);
  }
}

async function getContentType(url, signal) {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    return response.ok ? response.headers.get("content-type")?.toLowerCase() || "" : "";
  } catch {
    return "";
  }
}

function updateLoadingPage(status, loadedBytes, totalBytes) {
  const percent = totalBytes ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 0;
  const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
  status.textContent = totalBytes
    ? `Loading original document... ${percent}% (${loadedMb} MB)`
    : `Loading original document... ${loadedMb} MB`;
}

function writeErrorPage(tab, message) {
  tab.document.body.textContent = message;
}

function buildPreviewShell(title, label, fileCount) {
  const fileSlots = [];
  const count = Math.max(1, fileCount);
  for (let index = 0; index < count; index += 1) {
    fileSlots.push(`<section class="file-preview"><p class="status" id="status-${index}">Preparing paper preview...</p><div id="file-${index}"></div></section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(label)}</title><style>body{margin:0;background:#e9edf1;color:#17212b;font:16px/1.5 Arial,sans-serif}header{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;padding:10px 16px;background:#e9edf1;border-bottom:1px solid #cbd3d9}button{padding:8px 14px;border:0;border-radius:4px;background:#1f7a68;color:#fff;font:inherit;cursor:pointer}.status{margin:24px auto;max-width:900px;padding:12px 20px;color:#52606d}.file-preview{overflow:auto}.docx-wrapper{background:#e9edf1!important;padding:24px 0!important}.docx-wrapper>.docx{box-shadow:0 1px 6px #0002!important;margin-bottom:24px!important}iframe{display:block;width:100%;height:calc(100vh - 54px);border:0;background:white}img{display:block;max-width:100%;height:auto;margin:24px auto}@media(max-width:600px){.docx-wrapper{padding:10px 0!important}.docx-wrapper>.docx{margin-bottom:10px!important}}@media print{body{background:#fff}header{display:none}.docx-wrapper{padding:0!important;background:#fff!important}.docx-wrapper>.docx{box-shadow:none!important;margin:0!important}.status{display:none}iframe{height:100vh}}</style></head><body><header><button type="button" onclick="window.print()">Print</button></header><main>${fileSlots.join("")}</main></body></html>`;
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
