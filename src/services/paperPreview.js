import { supabase } from "../lib/supabaseClient";
import { getResearchDownloadUrl, getResearchFileType, isResearchStorageUrl } from "../lib/researchFilePreview";

export async function openResearchPreviewInNewTab({ urls, title, label = "manuscript" }) {
  const fileUrls = (Array.isArray(urls) ? urls : []).filter(Boolean);
  const previewTab = window.open("about:blank", "_blank");
  if (!previewTab) throw new Error("Allow pop-ups for this site to open paper previews in a new tab.");
  previewTab.opener = null;
  previewTab.document.open();
  previewTab.document.write(buildPreviewShell(title, label, fileUrls));
  previewTab.document.close();

  if (!fileUrls.length) {
    writeErrorPage(previewTab, "Preview is unavailable for this file. No manuscript file was found.", []);
    return;
  }

  try {
    const files = await Promise.all(fileUrls.map((url) => prepareFile(url)));
    const pdfs = files.filter((file) => file.type === "pdf");
    if (files.length === 1 && pdfs.length === 1) {
      previewTab.location.replace(pdfs[0].url);
      return;
    }

    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (!previewTab.closed) return;
      controller.abort();
      window.clearInterval(timer);
    }, 1000);

    try {
      for (let index = 0; index < files.length; index += 1) {
        if (previewTab.closed) return;
        const file = files[index];
        const section = previewTab.document.getElementById(`file-${index}`);
        const status = previewTab.document.getElementById(`status-${index}`);
        const content = previewTab.document.getElementById(`content-${index}`);
        const download = previewTab.document.getElementById(`download-${index}`);
        download.href = file.downloadUrl;
        download.hidden = false;
        download.textContent = files.length > 1 ? `Download original page ${index + 1}` : "Download original";

        if (file.type === "pdf") {
          content.innerHTML = `<iframe src="${escapeHtml(file.url)}" title="${escapeHtml(title)} ${escapeHtml(label)}"></iframe>`;
        } else if (file.type === "image") {
          content.innerHTML = `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(title)} - page ${index + 1}">`;
          content.className = "image-page";
        } else if (file.type === "docx") {
          await renderDocx(file, content, status, previewTab, controller.signal);
        } else {
          throw new Error(`The file type for page ${index + 1} is not supported.`);
        }
        status.remove();
        section.dataset.ready = "true";
      }
    } finally {
      window.clearInterval(timer);
    }
  } catch (error) {
    if (!previewTab.closed) {
      writeErrorPage(
        previewTab,
        "Preview is unavailable for this file. You can download the original manuscript instead.",
        fileUrls.map((url, index) => ({ url, index })),
        error.message,
      );
    }
  }
}

async function prepareFile(rawUrl) {
  if (!isResearchStorageUrl(rawUrl, supabase.supabaseUrl)) {
    throw new Error("This file is not in the research-files storage bucket.");
  }

  const url = new URL(rawUrl);
  url.searchParams.delete("download");
  let type = getResearchFileType(url.href);
  if (type === "unknown" || type === "docx") {
    const response = await fetch(url.href, { method: "HEAD" });
    if (response.ok) type = getResearchFileType(url.href, response.headers.get("content-type"));
  }

  return {
    url: url.href,
    type,
    downloadUrl: getResearchDownloadUrl(url.href),
  };
}

async function renderDocx(file, content, status, tab, signal) {
  status.textContent = "Loading original document...";
  const response = await fetch(file.url, { signal });
  if (!response.ok) throw new Error(`Could not load the paper (${response.status}).`);
  const actualType = getResearchFileType(file.url, response.headers.get("content-type"));
  if (actualType === "pdf") {
    content.innerHTML = `<iframe src="${escapeHtml(file.url)}" title="Research paper PDF"></iframe>`;
    file.type = "pdf";
    return;
  }
  if (actualType !== "docx") throw new Error("The stored file is not a readable DOCX document.");

  const bytes = await response.arrayBuffer();
  if (tab.closed) return;
  status.textContent = "Rendering document pages...";
  const { renderAsync } = await import("docx-preview");
  await renderAsync(bytes, content, tab.document.head, {
    className: "docx",
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });
}

function buildPreviewShell(title, label, urls) {
  const fileRows = urls.map((_, index) => `
    <section class="file-preview" id="file-${index}">
      <p class="status" id="status-${index}">Preparing preview...</p>
      <a class="download" id="download-${index}" hidden>Download original</a>
      <div id="content-${index}"></div>
    </section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${escapeHtml(label)}</title><style>
    :root{--zoom:1;color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#e8edf0;color:#16212a;font:15px/1.5 Arial,sans-serif}header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#24292e;color:#fff;box-shadow:0 1px 4px #0004}header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:auto}button,.download{border:0;border-radius:4px;padding:7px 10px;background:#fff;color:#17212b;font:inherit;text-decoration:none;cursor:pointer}button:hover,.download:hover{background:#dbe3e8}.status,.error{max-width:900px;margin:24px auto;padding:12px 18px;color:#485761}.error{background:#fff;border-left:4px solid #be3838}.file-preview{padding:14px 0 28px}.download{display:block;width:max-content;margin:0 auto 10px;background:#267b68;color:#fff}.download:hover{background:#1f6859}.docx-wrapper{zoom:var(--zoom);background:#e8edf0!important;padding:8px 0 20px!important}.docx-wrapper>.docx{box-shadow:0 1px 6px #0002!important;margin:0 auto 18px!important}.image-page{width:min(100%,900px);margin:0 auto 24px;background:#fff;box-shadow:0 1px 6px #0002;text-align:center;zoom:var(--zoom)}.image-page img{display:block;max-width:100%;max-height:none;width:auto;height:auto;margin:0 auto}.pdf-frame{display:block;width:100%;height:calc(100vh - 56px);border:0;background:white}iframe{display:block;width:100%;height:calc(100vh - 56px);border:0;background:white}.error-downloads{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.error-downloads a{margin:0}@media(max-width:600px){header{gap:4px;padding:7px 6px}button,.download{padding:7px 8px;font-size:13px}.docx-wrapper{padding:4px 0!important}.docx-wrapper>.docx{margin-bottom:8px!important}.file-preview{padding-top:8px}}@media print{body{background:#fff}header,.download,.status,.error{display:none!important}.file-preview{padding:0;break-after:page}.docx-wrapper{zoom:1;background:#fff!important;padding:0!important}.docx-wrapper>.docx,.image-page{box-shadow:none!important;margin:0 auto!important}.image-page{width:100%;break-after:page}iframe{height:100vh}}
  </style></head><body><header><button type="button" id="back" title="Close preview">Close</button><strong>${escapeHtml(title)} · ${escapeHtml(label)}</strong><button type="button" id="zoom-out" title="Zoom out">−</button><button type="button" id="zoom-reset" title="Reset zoom">100%</button><button type="button" id="zoom-in" title="Zoom in">+</button><button type="button" id="print" title="Print">Print</button></header><main>${fileRows || `<p class="error">Preview is unavailable for this file. No manuscript file was found.</p>`}</main><script>
    (()=>{let zoom=1;const update=()=>{document.documentElement.style.setProperty('--zoom',zoom);document.getElementById('zoom-reset').textContent=Math.round(zoom*100)+'%'};document.getElementById('zoom-in').onclick=()=>{zoom=Math.min(2,zoom+.1);update()};document.getElementById('zoom-out').onclick=()=>{zoom=Math.max(.5,zoom-.1);update()};document.getElementById('zoom-reset').onclick=()=>{zoom=1;update()};document.getElementById('print').onclick=()=>window.print();document.getElementById('back').onclick=()=>{window.close();setTimeout(()=>{if(!window.closed)history.back()},50)}})();
  </script></body></html>`;
}

function writeErrorPage(tab, message, files, detail = "") {
  if (tab.closed) return;
  const main = tab.document.querySelector("main");
  if (!main) {
    tab.document.body.textContent = message;
    return;
  }
  const downloads = files.map(({ url, index }) => {
    if (!isResearchStorageUrl(url, supabase.supabaseUrl)) return "";
    let href;
    try { href = getResearchDownloadUrl(url); } catch { return ""; }
    return `<a class="download" href="${escapeHtml(href)}">Download original${files.length > 1 ? ` ${index + 1}` : ""}</a>`;
  }).join("");
  main.innerHTML = `<div class="error" role="alert"><strong>${escapeHtml(message)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}</div><div class="error-downloads">${downloads}</div>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
