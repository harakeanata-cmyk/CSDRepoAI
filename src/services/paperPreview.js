const PREVIEW_STORAGE_PREFIX = "csdrepoai:paper-preview:";

export function openResearchPreviewInNewTab({ urls, title, label = "manuscript", paperId = null }) {
  const key = `${PREVIEW_STORAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify({ urls: Array.isArray(urls) ? urls : [], title, label, paperId });
  try {
    window.sessionStorage.setItem(key, payload);
  } catch {
    throw new Error("Could not prepare the paper preview. Please try again.");
  }

  const target = new URL("/paper-preview", window.location.origin);
  target.searchParams.set("key", key);
  const previewTab = window.open(target.href, "_blank");
  if (!previewTab) {
    window.sessionStorage.removeItem(key);
    throw new Error("Allow pop-ups for this site to open paper previews in a new tab.");
  }
  return previewTab;
}
