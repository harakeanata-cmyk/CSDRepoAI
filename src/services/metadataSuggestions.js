import { SDG_LIST } from "../lib/sdgList.js";
import { toGenkitEndpoint } from "../lib/genkitUrl.js";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import mammoth from "mammoth/mammoth.browser.js";

const viteEnv = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
const GENKIT_METADATA_URL = viteEnv.VITE_GENKIT_METADATA_URL;
const GENKIT_EXTRACTION_URL = toMetadataEndpoint(GENKIT_METADATA_URL, "extract-metadata");
const GENKIT_ANALYSIS_URL = toMetadataEndpoint(GENKIT_METADATA_URL, "metadata");
const GENKIT_KEYWORD_SUGGESTION_URL = toMetadataEndpoint(
  GENKIT_METADATA_URL || viteEnv.VITE_GENKIT_SEARCH_URL,
  "metadata",
) || (viteEnv.PROD ? "/metadata" : "");

export const THESIS_BOILERPLATE_ANCHORS = [
  "Notre Dame of Marbel University",
  "Bachelor of Science in",
  "Thesis Adviser",
  "Approval Sheet",
  "Panel Chair",
  "Panel Chairperson",
  "Panel Member",
  "Panel Members",
];

export function normalizeThesisBoilerplate(text) {
  return THESIS_BOILERPLATE_ANCHORS.reduce((normalized, anchor) => {
    const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anchorPattern = new RegExp(`([^\\n_])\\s*(${escapedAnchor})`, "gi");
    return normalized.replace(anchorPattern, "$1\n$2");
  }, String(text || ""));
}

const CONCATENATED_NAME_PATTERN = "[A-Z][a-z]+(?:\\s[A-Z][a-z]+)*\\s[A-Z]\\.\\s[A-Z][a-z]+";

export function splitConcatenatedNames(line) {
  const concatenatedNames = new RegExp(`(${CONCATENATED_NAME_PATTERN})\\s+(?=${CONCATENATED_NAME_PATTERN})`, "g");
  return String(line || "").replace(concatenatedNames, "$1\n");
}

export function toMetadataEndpoint(url, endpoint) {
  return toGenkitEndpoint(url, endpoint);
}

function logMetadataDebug(message, details) {
  if (viteEnv.DEV) console.debug(`[metadata] ${message}`, details);
}

export async function extractMetadataWithAI(documentText) {
  if (!GENKIT_EXTRACTION_URL) {
    return { unavailable: true };
  }

  // Metadata is concentrated in the title page, approval sheet, and abstract.
  // Keep the request bounded for long DOCX manuscripts; the complete extracted
  // text is still retained locally and archived for full-text search.
  const normalizedDocumentText = normalizeThesisBoilerplate(String(documentText || "").slice(0, 60000));

  try {
    const response = await fetch(GENKIT_EXTRACTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documentText: normalizedDocumentText }),
    });

    if (!response.ok) {
      throw new Error(`metadata extraction request failed (${response.status})`);
    }

    const payload = await response.json();
    logMetadataDebug("AI extraction response received", {
      title: Boolean(payload?.title),
      authors: Array.isArray(payload?.authors) ? payload.authors.length : 0,
      adviser: Boolean(payload?.adviser),
      abstractLength: String(payload?.abstract || "").length,
      keywords: Array.isArray(payload?.keywords) ? payload.keywords.length : 0,
    });
    return payload;
  } catch (error) {
    console.warn("Google Genkit metadata extraction unavailable, using local metadata extraction.", error);
    return { failed: true };
  }
}

export async function suggestKeywordsWithAI({ title = "", abstract = "", text = "" }) {
  if (!GENKIT_KEYWORD_SUGGESTION_URL || !String(text || "").trim()) {
    return { keywords: [], status: "unavailable" };
  }

  try {
    const response = await fetch(GENKIT_KEYWORD_SUGGESTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        abstract,
        keywords: "",
        text: String(text).slice(0, 30000),
      }),
    });

    if (!response.ok) throw new Error(`keyword suggestion request failed (${response.status})`);

    const payload = await response.json();
    const keywords = [...new Map(
      (Array.isArray(payload?.keywords) ? payload.keywords : [])
        .map((keyword) => String(keyword || "").trim().replace(/\s+/g, " "))
        .filter((keyword) => keyword.length > 1 && keyword.length <= 80)
        .map((keyword) => [keyword.toLowerCase(), keyword]),
    ).values()].slice(0, 8);

    return { keywords, status: keywords.length ? "ready" : "empty" };
  } catch (error) {
    console.warn("AI keyword suggestions unavailable.", error);
    return { keywords: [], status: "unavailable" };
  }
}

async function configurePdfWorker() {
  if (typeof window === "undefined" && typeof document === "undefined") {
    return;
  }

  try {
    const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    const workerSrc = workerModule.default || workerModule;
    GlobalWorkerOptions.workerSrc = workerSrc;
  } catch {
    // Ignore in environments where the browser-only worker URL cannot be resolved.
  }
}

const TOPIC_RULES = [
  { category: "Artificial Intelligence", terms: ["artificial intelligence", "machine learning", "deep learning", "neural network", "chatbot", "computer vision", "natural language"] },
  { category: "Information Systems", terms: ["information system", "management system", "information management", "record system", "database"] },
  { category: "Education Technology", terms: ["learning", "education", "student", "school", "teaching", "academic"] },
  { category: "Health Technology", terms: ["health", "medical", "hospital", "clinic", "disease", "patient"] },
  { category: "Cybersecurity", terms: ["cybersecurity", "cyber security", "privacy", "encryption", "malware", "phishing", "security"] },
  { category: "Web and Mobile Development", terms: ["web", "website", "mobile", "android", "ios", "application", "app"] },
  { category: "Data and Analytics", terms: ["data", "analytics", "prediction", "forecast", "classification", "survey"] },
];

const SDG_RULES = [
  { id: 3, terms: ["health", "medical", "hospital", "clinic", "patient", "disease"] },
  { id: 4, terms: ["education", "learning", "student", "school", "teaching", "academic"] },
  { id: 8, terms: ["employment", "work", "business", "entrepreneur", "livelihood", "productivity"] },
  { id: 9, terms: ["technology", "innovation", "infrastructure", "system", "software", "engineering"] },
  { id: 10, terms: ["inclusion", "accessibility", "inequality", "disability", "marginalized"] },
  { id: 11, terms: ["community", "city", "urban", "disaster", "transportation", "sustainable"] },
  { id: 12, terms: ["consumption", "waste", "recycling", "production", "resource"] },
  { id: 13, terms: ["climate", "environment", "carbon", "energy", "renewable", "pollution"] },
];

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
}

function matches(text, terms) {
  return terms.some((term) => text.includes(term));
}

function isLikelyNonTitle(title, adviser = "") {
  if (!title) return false;
  const normalized = title.toLowerCase();
  return /(bachelor of|university|college|institute|department of|school of)/i.test(title)
    || Boolean(adviser && normalized.includes(adviser.toLowerCase()));
}

export function suggestMetadata({ title = "", abstract = "", keywords = "" }) {
  const source = normalize(`${title} ${abstract} ${keywords}`);
  const topicMatches = TOPIC_RULES.filter((rule) => matches(source, rule.terms));
  const suggestedKeywords = [...new Set(
    topicMatches.flatMap((rule) => rule.terms.filter((term) => source.includes(term)))
  )].slice(0, 8);
  const suggestedSdgs = SDG_RULES.filter((rule) => matches(source, rule.terms)).map((rule) => rule.id);
  const category = topicMatches[0]?.category || "Computer Studies";

  return {
    category,
    keywords: suggestedKeywords,
    sdgTags: suggestedSdgs,
    sdgNames: suggestedSdgs.map((id) => SDG_LIST.find((sdg) => sdg.id === id)?.title).filter(Boolean),
  };
}

export async function analyzeResearchDocument(file) {
  if (!file) return null;

  const source = await readResearchDocument(file);
  return buildLocalAnalysis(file, source);
}

export async function analyzeResearchDocumentWithAI(file) {
  if (!file) return null;

  const source = await readResearchDocument(file);
  const { documentText, extracted, abstract } = source;

  if (!GENKIT_EXTRACTION_URL) {
    logMetadataDebug("AI extraction unavailable; using local fallback", { reason: "endpoint not configured" });
    return buildLocalAnalysis(file, source);
  }

  const aiMetadata = await extractMetadataWithAI(documentText);
  if (aiMetadata?.unavailable || aiMetadata?.failed) {
    logMetadataDebug("AI extraction unavailable; using local fallback", { reason: "request failed" });
    return buildLocalAnalysis(file, source);
  }

  if (!aiMetadata) {
    logMetadataDebug("AI extraction returned no metadata; using local fallback", {});
    return buildLocalAnalysis(file, source);
  }

  const merged = mergeExtractedMetadata(extracted, abstract, aiMetadata, file);
  const aiSuggestions = suggestMetadata({
    title: merged.title,
    abstract: merged.abstract,
    keywords: merged.keywords,
  });
  logMetadataDebug("AI extraction validation complete", {
    title: Boolean(merged.title),
    authors: merged.authors.length,
    adviser: Boolean(merged.adviser),
    abstractLength: merged.abstract.length,
    keywords: merged.keywords.length,
  });

  return {
    title: merged.title,
    authors: merged.authors.join(", "),
    adviser: merged.adviser,
    keywords: merged.keywords,
    abstract: merged.abstract,
    category: aiSuggestions.category,
    sdgTags: aiSuggestions.sdgTags,
    sdgNames: aiSuggestions.sdgNames,
    extractedText: documentText,
    sourceTextLength: documentText.length,
  };
}

async function readResearchDocument(file) {
  const documentText = normalizeThesisBoilerplate(
    isDocx(file) ? await extractDocxText(file) : await extractPdfText(file)
  );
  const extracted = extractDocumentFields(documentText);
  // Do not fabricate an abstract from the opening sentences of the body. If
  // the document has no identifiable abstract section, leave it for review.
  const abstract = extracted.abstract;
  logMetadataDebug("document extracted", {
    pages: isDocx(file) ? 1 : Math.max(1, (documentText.match(/--- Page \d+ ---/g) || []).length + 1),
    textLength: documentText.length,
    title: Boolean(extracted.title),
    authors: extracted.authors.length,
    adviser: Boolean(extracted.adviser),
    abstractLength: abstract.length,
    keywords: Boolean(extracted.keywords),
  });
  return { documentText, extracted, abstract };
}

async function buildLocalAnalysis(file, { documentText, extracted, abstract }) {
  const metadata = await maybeAnalyzeWithGenkit({
    title: extracted.title,
    abstract,
    keywords: extracted.keywords,
    text: documentText,
  });
  const title = resolveDocumentTitle(extracted.title, extracted.adviser);
  const keywords = extracted.keywords || metadata.keywords.join(", ");
  logMetadataDebug("local metadata fallback ready", {
    title: Boolean(title),
    authors: extracted.authors.length,
    adviser: Boolean(extracted.adviser),
    abstractLength: abstract.length,
    keywords: Boolean(keywords),
  });
  return {
    title,
    authors: extracted.authors,
    adviser: extracted.adviser,
    keywords,
    abstract,
    category: metadata.category,
    sdgTags: metadata.sdgTags,
    sdgNames: metadata.sdgNames,
    extractedText: documentText,
    sourceTextLength: documentText.length,
  };
}

export function mergeExtractedMetadata(local, localAbstract, ai, file) {
  const localTitle = resolveDocumentTitle(local.title, local.adviser);
  const aiTitle = resolveDocumentTitle(ai.title, ai.adviser || local.adviser);
  const title = chooseTitle(localTitle, aiTitle);
  const localAuthors = cleanAuthorList(local.authors);
  const aiAuthors = cleanAuthorList(ai.authors);
  const authors = localAuthors.length ? localAuthors : aiAuthors;
  const aiAdviser = cleanAdviser(ai.adviser);
  const adviser = cleanAdviser(local.adviser) || aiAdviser;
  const aiAbstract = cleanAbstract(ai.abstract);
  const abstract = cleanAbstract(localAbstract) || aiAbstract;
  const aiKeywords = normalizeKeywords(ai.keywords);
  const localKeywords = normalizeKeywords(local.keywords);
  const keywords = (localKeywords.length ? localKeywords : aiKeywords).join(", ");

  return { title, authors, adviser, abstract, keywords };
}

function chooseTitle(localTitle, aiTitle) {
  const localValid = isValidTitle(localTitle);
  const aiValid = isValidTitle(aiTitle);
  // The title page is the strongest source. Use generated text only when the
  // local title-page parser could not find a credible title.
  if (localValid) return localTitle;
  if (aiValid) return aiTitle;
  return "";
}

function isValidTitle(value) {
  const title = normalizeTitleCandidate(value);
  return title.length >= 12
    && !isPlaceholderTitle(title)
    && !isTitlePageBoilerplateLine(title)
    && !isLikelyNonTitle(title)
    && !/^(abstract|keywords?|introduction|chapter\s+[ivxlcdm\d]+)$/i.test(title);
}

function cleanAuthorList(value) {
  const authors = Array.isArray(value) ? value : String(value || "").split(/[;\n]+/);
  return [...new Set(authors
    .map((author) => cleanMetadataLine(String(author)).replace(/\s+/g, " ").trim())
    .filter((author) => isAuthorCandidate(author) && !/\b(?:approved by|dean|chairperson|panel)\b/i.test(author)))];
}

function cleanAdviser(value) {
  const adviser = cleanMetadataLine(String(value || "")).replace(/\s+/g, " ").trim();
  if (!adviser || !isLikelyAuthorLine(adviser)) return "";
  if (/\b(?:panel|dean|chairperson|department chair|approved by|adviser|advisor)\b/i.test(adviser)) return "";
  return adviser;
}

function cleanAbstract(value) {
  const abstract = cleanMetadataLine(String(value || "")).replace(/\s+/g, " ").trim();
  if (abstract.length < 60 || /^(abstract|introduction|chapter\s+[ivxlcdm\d]+)$/i.test(abstract)) return "";
  return abstract;
}

function normalizeKeywords(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[;,\n|]+/);
  return [...new Set(values
    .map((keyword) => cleanMetadataLine(String(keyword)).replace(/^[*\s]+|[*\s.,;:]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean))].slice(0, 12);
}

async function maybeAnalyzeWithGenkit({ title, abstract, keywords, text }) {
  if (!GENKIT_ANALYSIS_URL) {
    return suggestMetadata({ title, abstract, keywords });
  }

  try {
    const response = await fetch(GENKIT_ANALYSIS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, abstract, keywords, text }),
    });

    if (!response.ok) {
      throw new Error(`metadata analysis request failed (${response.status})`);
    }

    const payload = await response.json();
    return normalizeMetadataPayload(payload);
  } catch (error) {
    console.warn("Google Genkit metadata analysis unavailable, using local heuristic analysis.", error);
    return suggestMetadata({ title, abstract, keywords });
  }
}

function normalizeMetadataPayload(payload) {
  const fallback = suggestMetadata({ title: payload?.title || "", abstract: payload?.abstract || "", keywords: payload?.keywords || "" });

  return {
    category: String(payload?.category || fallback.category).trim() || fallback.category,
    keywords: Array.isArray(payload?.keywords)
      ? payload.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 8)
      : fallback.keywords,
    sdgTags: Array.isArray(payload?.sdgTags)
      ? payload.sdgTags.map((tag) => Number(tag)).filter((tag) => Number.isInteger(tag))
      : fallback.sdgTags,
    sdgNames: Array.isArray(payload?.sdgNames)
      ? payload.sdgNames.map((name) => String(name).trim()).filter(Boolean)
      : fallback.sdgNames,
  };
}

async function extractPdfText(file) {
  await configurePdfWorker();
  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;
  const pages = [];
  const pageLimit = pdf.numPages;

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = joinPdfTextItems(content.items, content.styles);
    pages.push(pageNumber === 1 ? pageText : `--- Page ${pageNumber} ---\n${pageText}`);
  }

  const text = pages.join("\n\n").trim();
  const textLayer = text.replace(/--- Page \d+ ---/g, "").trim();
  if (textLayer.length >= 120) return text;

  // Scanned PDFs have no selectable text layer. Reuse the app's existing
  // PaddleOCR flow to recover the title page and common front-matter sections.
  try {
    const { extractScannedPdfText } = await import("./ocr.js");
    const scannedText = await extractScannedPdfText(file);
    return scannedText.trim() ? scannedText : text;
  } catch (error) {
    console.warn("Scanned PDF OCR fallback failed; using available PDF text.", error);
    return text;
  }
}

async function extractDocxText(file) {
  const { metadataText } = await extractDocxTextWithFormatting(file);
  return metadataText;
}

export async function extractDocxTextWithFormatting(file) {
  const arrayBuffer = await file.arrayBuffer();
  const [{ value }, { value: html }] = await Promise.all([
    mammoth.extractRawText({ arrayBuffer }),
    mammoth.convertToHtml({ arrayBuffer }),
  ]);
  const boldLines = getBoldDocxParagraphs(html);
  const italicLines = getItalicDocxParagraphs(html);
  const rawLines = value.replace(/\r/g, "").split("\n");
  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  const markedLines = lines.map((line) => {
    if (boldLines.has(line)) return `__DOCX_BOLD__${line}`;
    if (italicLines.has(line)) return `__DOCX_ITALIC__${line}`;
    return line;
  });
  return {
    text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    metadataText: markedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function getBoldDocxParagraphs(html) {
  const boldLines = new Set();
  const blocks = html.match(/<(p|h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi) || [];

  for (const block of blocks) {
    const isHeading = /^<h[1-6]\b/i.test(block);
    if (!isHeading && !/<strong\b|<b\b/i.test(block)) continue;

    const text = block
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (text) boldLines.add(text);
  }

  return boldLines;
}

function getItalicDocxParagraphs(html) {
  const italicLines = new Set();
  const paragraphs = html.match(/<p[\s\S]*?<\/p>/gi) || [];

  for (const paragraph of paragraphs) {
    if (!/<em\b|<i\b/i.test(paragraph)) continue;
    const text = paragraph
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (text) italicLines.add(text);
  }

  return italicLines;
}

const LINE_ITEM_OVERLAP_EPSILON = 0.5;

function joinPdfTextItems(items, styles = {}) {
  const lines = [];
  const baseFontSize = getBaseFontSize(items);
  for (const item of items) {
    const text = item.str?.trim();
    if (!text) continue;
    const y = item.transform?.[5] ?? 0;
    const fontSize = getPdfFontSize(item);
    const x = item.transform?.[4] ?? 0;
    const width = item.width ?? 0;
    const line = lines.find((candidate) => (
      Math.abs(candidate.y - y) < 3
      && candidate.items.every((existingItem) => (
        x >= existingItem.x + existingItem.width - LINE_ITEM_OVERLAP_EPSILON
        || x + width <= existingItem.x + LINE_ITEM_OVERLAP_EPSILON
      ))
    ));
    if (line) {
      line.items.push({ x, text, width, bold: isPdfBoldItem(item, styles, fontSize, baseFontSize) });
    } else {
      lines.push({ y, items: [{ x, text, width, bold: isPdfBoldItem(item, styles, fontSize, baseFontSize) }] });
    }
  }

  const joined = lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const itemsInOrder = line.items.sort((a, b) => a.x - b.x);
      const text = itemsInOrder.reduce((result, item, index) => {
        if (index === 0) return item.text;
        const previous = itemsInOrder[index - 1];
        const gap = item.x - (previous.x + previous.width);
        return `${result}${gap > 1 ? " " : ""}${item.text}`;
      }, "");
      return line.items.some((item) => item.bold) ? `__PDF_BOLD__${text}` : text;
    })
    .join("\n");

  return collapseHyphenSpacing(joined);
}

function isPdfBoldItem(item, styles, fontSize, baseFontSize) {
  const style = styles?.[item.fontName] || {};
  const fontName = `${item.fontName || ""} ${style.fontFamily || ""}`;
  if (/bold|black|semibold|demi/i.test(fontName)) return true;
  if (baseFontSize <= 0) return false;
  return fontSize >= baseFontSize * 1.08;
}

function getPdfFontSize(item) {
  return Math.hypot(item.transform?.[0] ?? 0, item.transform?.[1] ?? 0);
}

function getBaseFontSize(items) {
  const counts = new Map();
  for (const item of items) {
    const text = item.str?.trim();
    if (!text) continue;
    const size = Math.round(getPdfFontSize(item) * 100) / 100;
    counts.set(size, (counts.get(size) || 0) + text.length);
  }
  let baseSize = 0;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      baseSize = size;
    }
  }
  return baseSize;
}

function collapseHyphenSpacing(text) {
  return text.replace(/(\w)[ \t]*[-–—][ \t]*(\w)/g, "$1-$2");
}

function isDocx(file) {
  return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name);
}

export function extractDocumentFields(text) {
  if (!text) return { title: "", abstract: "", keywords: "", authors: [], adviser: "", panelMembers: [] };

  const lines = normalizeThesisBoilerplate(text)
    .split("\n")
    .flatMap((line) => splitConcatenatedNames(line).split("\n"))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const abstractIndex = findAbstractIndex(lines);
  const keywordsIndex = findKeywordsIndex(lines, abstractIndex);
  const abstract = extractSection(lines, abstractIndex, ["keywords?", "introduction", "chapter", "table of contents"]);
  const keywordsLine = extractKeywords(lines, keywordsIndex);
  const title = extractTitle(lines);
  const authors = extractAuthors(lines);
  const adviser = extractAdviser(lines);
  const panelMembers = extractPanelMembers(lines, adviser, authors);

  return {
    title,
    authors,
    adviser,
    panelMembers,
    abstract,
    keywords: cleanMetadataLine(keywordsLine).replace(/[.;]+$/, "").trim(),
  };
}

function extractTitle(lines) {
  const titleIndex = lines.slice(0, 12).findIndex((line) => /^title\s*(?:[:\-].*|)$/i.test(cleanMetadataLine(line)));
  if (titleIndex >= 0) {
    const titleLines = [];
    const firstTitleLine = cleanMetadataLine(lines[titleIndex]).replace(/^title\s*[:\-]?\s*/i, "").trim();
    if (firstTitleLine) titleLines.push(firstTitleLine);
    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 8); index += 1) {
      const line = cleanMetadataLine(lines[index]);
      if (!line || isPageMarkerLine(line) || isTitlePageBoilerplateLine(line)) continue;
      if (isTitlePageAuthorBoundary(lines, index) || isTitlePageInstitutionLine(line) || isDocumentHeading(line)) break;
      if (/^(authors?|researchers?|prepared by|by)\s*[:\-]?$/i.test(line)) break;
      titleLines.push(line);
    }
    if (titleLines.length) return titleLines.join(" ").replace(/\s+/g, " ").trim();
  }

  const hasBoldMarkers = lines.some(isBoldMetadataLine);
  if (!hasBoldMarkers) return firstPageTitle(lines);

  const boldTitleIndex = lines
    .slice(0, 12)
    .findIndex((line) => isBoldMetadataLine(line) && !isDocumentHeading(cleanMetadataLine(line)));
  if (boldTitleIndex >= 0) {
    const titleLines = [];
    for (let index = boldTitleIndex; index < Math.min(lines.length, 12); index += 1) {
      if (!isBoldMetadataLine(lines[index])) break;
      titleLines.push(cleanMetadataLine(lines[index]));
    }
    if (titleLines.length > 0) return titleLines.join(" ").replace(/\s+/g, " ").trim();
  }

  const authorLabelIndex = lines.findIndex((line) => /^(authors?|researchers?|prepared by|by)\s*[:\-]?\s*/i.test(line));
  if (authorLabelIndex > 0) {
    const beforeAuthors = lines.slice(0, authorLabelIndex).filter((line) => !isPageMarkerLine(line));
    if (beforeAuthors.length > 0) return beforeAuthors.slice(-3).join(" ").trim();
  }

  return firstPageTitle(lines);
}

function resolveDocumentTitle(title, adviser = "") {
  const cleanedTitle = sanitizeResearchTitle(title);
  if (cleanedTitle && !isPlaceholderTitle(cleanedTitle) && !isLikelyNonTitle(cleanedTitle, adviser)) return cleanedTitle;
  return "";
}

export function sanitizeResearchTitle(value) {
  const title = normalizeTitleCandidate(value);
  return isNonTitlePageLabel(title) || isPlaceholderTitle(title) ? "" : title;
}

function normalizeTitleCandidate(value) {
  return cleanMetadataLine(String(value || ""))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:hardbound|softbound)\s+[a-z0-9-]+\s+/i, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[_*]+|[_*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderTitle(title) {
  return /^(string|title|document|manuscript|research paper|untitled|unknown|n\/a|null|undefined)$/i.test(title.trim());
}

function extractSection(lines, startIndex, stopPatterns) {
  if (startIndex < 0) return "";
  const content = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    if (index === startIndex) {
      const inline = stripAbstractHeading(cleanMetadataLine(lines[index]));
      if (inline) content.push(inline);
      continue;
    }
    const line = cleanMetadataLine(lines[index]);
    const keywordPosition = line.search(/\*?\s*key\s*(?:words?|wrods?|wods?)\s*\*?\s*[:\-]/i);
    if (stopPatterns.includes("keywords?") && (keywordPosition >= 0 || isKeywordsHeading(line))) {
      const beforeKeywords = line.slice(0, keywordPosition).trim();
      if (beforeKeywords) content.push(beforeKeywords);
      break;
    }
    if (stopPatterns.some((pattern) => pattern !== "keywords?" && new RegExp(`^${pattern}\\b`, "i").test(line))) break;
    content.push(line);
  }
  return content.join(" ").replace(/\s+/g, " ").trim();
}

function extractKeywords(lines, startIndex) {
  if (startIndex < 0) return "";

  const firstLine = cleanMetadataLine(lines[startIndex]);
  const keywordStart = firstLine.search(/\*?\s*key\s*(?:words?|wrods?|wods?)\s*\*?\s*[:\-]/i);
  const firstKeywordLine = stripKeywordsHeading(keywordStart >= 0 ? firstLine.slice(keywordStart) : firstLine);
  const firstBoundary = findKeywordSectionBoundary(firstKeywordLine);
  let firstKeywordContent = firstBoundary >= 0 ? firstKeywordLine.slice(0, firstBoundary).trim() : firstKeywordLine;
  if (firstBoundary >= 0) {
    const lastDelimiter = Math.max(firstKeywordContent.lastIndexOf(","), firstKeywordContent.lastIndexOf(";"));
    const trailingFragment = firstKeywordContent.slice(lastDelimiter + 1).trim();
    if (lastDelimiter >= 0 && /^[A-Z][A-Za-z0-9-]{1,12}$/.test(trailingFragment)) {
      firstKeywordContent = firstKeywordContent.slice(0, lastDelimiter).trim();
    }
  }
  const segments = [firstKeywordContent];
  let index = startIndex + 1;
  while (
    index < lines.length
    && segments.length < 6
    && firstBoundary < 0
    && !/\.\s*$/.test(segments[segments.length - 1].trim())
  ) {
    const nextLine = cleanMetadataLine(lines[index]);
    if (
      !nextLine
      || findKeywordSectionBoundary(nextLine) >= 0
      || isPageMarkerLine(nextLine)
      || isDocumentHeading(nextLine)
      || isAbstractHeading(nextLine)
      || isKeywordsHeading(nextLine)
      || /^\d+$/.test(nextLine)
    ) break;
    segments.push(nextLine);
    index += 1;
  }

  return segments
    .join(" ")
    .replace(/\*+\s*$/, "")
    .replace(/[.;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findKeywordSectionBoundary(line) {
  return line.search(/\b(?:acknowledg(?:e)?ments?|we\s+sincerely\s+thank|we\s+would\s+like\s+to\s+thank)\b/i);
}

function findKeywordsIndex(lines, abstractIndex) {
  if (abstractIndex >= 0 && hasKeywordsMarker(cleanMetadataLine(lines[abstractIndex]))) {
    return abstractIndex;
  }
  const startIndex = abstractIndex >= 0 ? abstractIndex + 1 : 0;
  return lines.findIndex((line, index) => index >= startIndex && hasKeywordsMarker(cleanMetadataLine(line)));
}

function findAbstractIndex(lines) {
  return lines.findIndex((line, index) => {
    const cleaned = cleanMetadataLine(line).trim();
    if (!isAbstractHeading(cleaned)) return false;
    // Ignore table-of-contents rows such as "Abstract 4" or a heading whose
    // next line is only its page number.
    if (/^abstract\s*(?:\.{2,}\s*)?\d+\s*$/i.test(cleaned)) return false;
    if (/^abstract\s*$/i.test(cleaned) && /^\d{1,3}$/.test(cleanMetadataLine(lines[index + 1] || "").trim())) return false;
    return true;
  });
}

function isAbstractHeading(line) {
  return /^\s*(?:abstract|abstrac|abstrct)(?=\s|[:\-]|$)/i.test(line);
}

function stripAbstractHeading(line) {
  return line.replace(/^\s*[*_\s-]*(?:abstract|abstrac|abstrct)\s*[:\-]?\s*/i, "").trim();
}

function isKeywordsHeading(line) {
  return /^\s*[*_\s-]*key\s*(?:words?|wrods?|wods?)\s*[*_\s]*(?:[:\-].*)?$/i.test(line);
}

function hasKeywordsMarker(line) {
  return /\*?\s*key\s*(?:words?|wrods?|wods?)\s*\*?\s*[:\-]/i.test(line) || isKeywordsHeading(line);
}

function stripKeywordsHeading(line) {
  return line.replace(/^\s*[*_\s-]*key\s*(?:words?|wrods?|wods?)\s*[*_\s]*[:\-]?\s*[*_\s]*/i, "").trim();
}

function isDocumentHeading(line) {
  return /^(introduction|background|methodology|methods?|results?|discussion|conclusion|references?|chapter|table of contents|acknowledg(?:e)?ments?|approval[\s-]*sheet|dedication)\b/i.test(line);
}

function isPageMarkerLine(line) {
  return /^-{2,}\s*page\s*\d+\s*-{2,}$/i.test(line.trim());
}

function firstPageTitle(lines) {
  const firstPageLines = getFirstPageLines(lines);
  const inlineTitle = extractInlineFirstPageTitle(firstPageLines);
  if (inlineTitle) return inlineTitle;

  const titleLines = [];

  for (let index = 0; index < firstPageLines.length && index < 20; index += 1) {
    const line = cleanMetadataLine(firstPageLines[index])
      .replace(/^(title\s*[:\-]?\s*)/i, "")
      .trim();
    if (!line) continue;
    if (isPageMarkerLine(line)) continue;
    if (isNonTitlePageLabel(line)) continue;
    if (isTitlePageBoilerplateLine(line)) continue;
    if (isTitlePageInstitutionLine(line)) {
      if (titleLines.length) break;
      continue;
    }
    if (/^(abstract|keywords?)\b/i.test(line)) break;
    if (isTitlePageAuthorBoundary(firstPageLines, index)) break;
    if (titleLines.length > 0 && isInstitutionLine(line) && !isAllCapsLine(line)) break;
    titleLines.push(line);
  }

  return titleLines.join(" ").replace(/\s+/g, " ").trim();
}

function isTitlePageInstitutionLine(line) {
  return /^\s*(?:Notre Dame of Marbel University|Republic of the Philippines|University of\b|Polytechnic University\b|College of\b|Institute of\b|Bachelor of\b|Master of\b|Department of Education\b)/i.test(line);
}

function isNonTitlePageLabel(line) {
  const normalized = cleanMetadataLine(line)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return [
    "hardbound",
    "hardbound bayad",
    "hard bound",
    "hard bound bayad",
  ].includes(normalized);
}

function isTitlePageBoilerplateLine(line) {
  return isNonTitlePageLabel(line)
    || (/^(?:softbound|manuscript|thesis|capstone|research\s+paper|research\s+study)(?:\s+[a-z0-9-]+){0,3}$/i.test(line)
      && line.length <= 60)
    || /^(?:(?:a\s+)?(?:thesis|capstone|research paper|project report)\s+(?:submitted|presented|prepared)|in partial fulfillment|submitted to|presented to)\b/i.test(line)
    || /\b(?:in partial fulfillment|submitted to|presented to the)\b/i.test(line);
}

function getFirstPageLines(lines) {
  const firstPage = [];
  for (const line of lines) {
    if (isPageMarkerLine(line) && /page\s+[2-9]\d*/i.test(line)) break;
    firstPage.push(line);
  }
  return firstPage;
}

function extractInlineFirstPageTitle(lines) {
  const contentLines = getFirstPageLines(lines).filter((line) => !isPageMarkerLine(line));
  if (contentLines[0]?.length <= 100) return "";

  const pageText = contentLines
    .map((line) => cleanMetadataLine(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!pageText) return "";

  const institutionMatch = pageText.search(/\b(?:Notre Dame of Marbel University|University|College|Institute|Bachelor of|Master of)\b/i);
  const titlePageText = institutionMatch >= 0 ? pageText.slice(0, institutionMatch).trim() : pageText;
  if (!titlePageText || titlePageText.includes("\n")) return "";

  const authorMatch = titlePageText.search(/\b(?!Pair\b|Language\b|Translation\b|Machine\b|Neural\b|Speech\b|Text\b|Low\b|Resource\b|End\b|the\b|for\b|and\b|of\b)[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+[A-Z]\.\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/);
  if (authorMatch > 0) {
    const title = titlePageText.slice(0, authorMatch).trim();
    if (title && !isDocumentHeading(title)) return title;
  }

  return "";
}

function isTitlePageAuthorBoundary(lines, index) {
  const line = cleanMetadataLine(lines[index]);
  if (!isLikelyAuthorNameLine(line)) return false;
  if (/\b(?:a|an|and|for|from|in|of|on|the|to|with)\b/i.test(line)) return false;
  if (/[A-Za-z]-[A-Za-z]/.test(line)) return false;

  for (let nextIndex = index + 1; nextIndex <= index + 3 && nextIndex < lines.length; nextIndex += 1) {
    const nextLine = cleanMetadataLine(lines[nextIndex]);
    if (isInstitutionLine(nextLine) || /^(bachelor|master|bs\b|ms\b|approval sheet)\b/i.test(nextLine)) return true;
    if (isLikelyAuthorNameLine(nextLine)) continue;
    if (isDocumentHeading(nextLine)) break;
  }

  return false;
}

function extractInlineFirstPageAuthors(lines, title) {
  if (!title) return [];

  const contentLines = getFirstPageLines(lines).filter((line) => !isPageMarkerLine(line));
  if (contentLines[0]?.length <= 100) return [];

  const pageText = contentLines
    .map((line) => cleanMetadataLine(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const titleEnd = pageText.indexOf(title);
  if (titleEnd < 0) return [];

  const afterTitle = pageText.slice(titleEnd + title.length);
  const institutionMatch = afterTitle.search(/\b(?:Notre Dame of Marbel University|University|College|Institute|Bachelor of|Master of)\b/i);
  const authorText = (institutionMatch >= 0 ? afterTitle.slice(0, institutionMatch) : afterTitle).trim();
  const authors = splitConcatenatedNames(authorText)
    .split("\n")
    .map((line) => cleanMetadataLine(line).trim())
    .filter((line) => isAuthorCandidate(line) || isLikelyAuthorNameLine(line));

  return [...new Set(authors)].slice(0, 6);
}

function extractAuthors(lines) {
  const labeledAuthors = extractLabeledAuthors(lines);
  if (labeledAuthors.length > 0) return labeledAuthors;

  const titleIndex = lines.findIndex((line) => isBoldMetadataLine(line));
  const title = extractTitle(lines);
  const inlineAuthors = extractInlineFirstPageAuthors(lines, title);
  if (inlineAuthors.length > 0) return inlineAuthors;
  const universityIndex = lines.findIndex((line, index) => index > 0 && /\b(university|college|institute)\b/i.test(cleanMetadataLine(line)));
  let authorStart = 0;
  if (titleIndex >= 0) {
    authorStart = titleIndex + 1;
    while (authorStart < lines.length && isBoldMetadataLine(lines[authorStart])) {
      authorStart += 1;
    }
  }
  if (authorStart === 0) {
    const titleEndIndex = findTitleEndIndex(lines, title);
    if (titleEndIndex > 0) authorStart = titleEndIndex;
  }
  const searchEnd = universityIndex > 0 ? universityIndex : Math.min(lines.length, 12);

  const authors = [];
  for (let index = authorStart; index < searchEnd && authors.length < 4; index += 1) {
    const line = cleanMetadataLine(lines[index]);

    if (!line || line.length > 60) continue;
    if (/^(abstract|keywords?|approval sheet|thesis adviser|panel chair|panel member|acknowledgement|dedication|chapter)\b/i.test(line)) break;
    if (isInstitutionLine(line)) break;
    if (!isAuthorCandidate(line)) continue;

    authors.push(line.trim());
  }

  if (authors.length > 0) return authors;

  for (let index = searchEnd - 1; index >= 0 && authors.length < 4; index -= 1) {
    const line = cleanMetadataLine(lines[index]);
    if (isAuthorCandidate(line)) authors.unshift(line);
  }

  return authors;
}

function findTitleEndIndex(lines, title) {
  if (!title) return -1;

  let combined = "";
  for (let index = 0; index < Math.min(lines.length, 20); index += 1) {
    const line = cleanMetadataLine(lines[index]);
    if (isPageMarkerLine(line)) continue;
    combined = `${combined} ${line}`.trim();
    if (combined === title) return index + 1;
    if (!title.startsWith(combined)) return -1;
  }

  return -1;
}

function cleanMetadataLine(line) {
  return line.replace(/^__(?:DOCX|PDF)_(?:BOLD|ITALIC)__/, "").trim();
}

function isBoldMetadataLine(line) {
  return /^__(?:DOCX|PDF)_BOLD__/.test(line);
}

function extractLabeledAuthors(lines) {
  const authors = [];
  const labelPattern = /^(authors?|researchers?|prepared by|by)\s*[:\-]?\s*(.*)$/i;

  for (let index = 0; index < lines.length && index < 20; index += 1) {
    const match = lines[index].match(labelPattern);
    if (!match) continue;

    if (match[2].trim()) {
      authors.push(...splitPeople(match[2]));
    } else {
      for (let nextIndex = index + 1; nextIndex < lines.length && nextIndex < index + 7; nextIndex += 1) {
        const line = cleanMetadataLine(lines[nextIndex]);
        if (isInstitutionLine(line) || isDocumentHeading(line)) break;
        if (isAuthorCandidate(line)) authors.push(line);
      }
    }
    break;
  }

  return [...new Set(authors.map((author) => author.trim()).filter(Boolean))].slice(0, 6);
}

function splitPeople(value) {
  return value
    .split(/\s*(?:;|\||\band\b)\s*|\s*,\s*(?=[A-Z][a-z])/i)
    .map((author) => author.trim())
    .filter((author) => isLikelyAuthorNameLine(author));
}

function isAuthorCandidate(line) {
  const candidate = cleanMetadataLine(line);
  if (!candidate || candidate.length > 60 || isInstitutionLine(candidate) || isTitlePageBoilerplateLine(candidate)) return false;
  if (/^(abstract|keywords?|title|authors?|researchers?|prepared by|by|approval sheet|thesis adviser|panel chair|panel member|chapter|introduction|background|methodology|references?)\b/i.test(candidate)) {
    return false;
  }

  const words = candidate.replace(/[,:;]/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  return words.every((word) => {
    const letters = word.replace(/[^A-Za-z.'-]/g, "");
    return letters.length >= 2 || /^[A-Za-z]\.?$/.test(word);
  });
}

function isInstitutionLine(line) {
  return /(university|college|institute|campus|bachelor|bs\b|bsc\b|computer science|information technology|school of|department of|year|month|date)/i.test(line);
}

function isLikelyAuthorNameLine(line) {
  if (!isLikelyAuthorLine(line) || isInstitutionLine(line)) return false;
  if (isAllCapsLine(line)) return false;
  if (/^(abstract|keywords?|title|approval sheet|thesis adviser|panel chair|panel member|chapter|introduction|background|methodology|references?)\b/i.test(line)) {
    return false;
  }

  const words = line.replace(/[,:;]/g, "").split(/\s+/).filter(Boolean);
  const nameLikeWords = words.filter((word) => /^[A-Z][A-Za-z.'-]*$/.test(word));
  return nameLikeWords.length >= 2 || /\b[A-Z][a-z]+,\s*[A-Z]/.test(line);
}

function isAllCapsLine(line) {
  const lettersOnly = line.replace(/[^A-Za-z]/g, "");
  return Boolean(lettersOnly) && lettersOnly === lettersOnly.toUpperCase();
}

function extractAdviser(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanMetadataLine(lines[index]);
    const nextLine = cleanMetadataLine(lines[index + 1] || "");

    const sameLine = extractSameLineAdviser(line);
    if (sameLine) return sameLine;
    if (!isPageMarkerLine(line) && isAdviserCaption(nextLine) && !extractSameLineAdviser(nextLine)) {
      return line.replace(/[\s,:;-]+$/, "").trim();
    }
  }

  return "";
}

function extractPanelMembers(lines, adviser = "", authors = []) {
  const panelMembers = [];
  const excludedPeople = new Set([adviser, ...authors].map(normalizePersonName).filter(Boolean));
  const chairRole = "chair(?:person|man|woman)?";
  const panelRolePattern = new RegExp(`^(?:panel\\s*(?:${chairRole}|members?|ists?)|(?:${chairRole}|member)\\s+of\\s+(?:the\\s+)?panel|${chairRole})$`, "i");
  const panelSectionPattern = /^(?:panelists?(?:\s+names?)?|panel\s+members?(?:\s+names?)?|members\s+of\s+the\s+panel|panel\s+of\s+examiners|composition\s+of\s+(?:the\s+)?panel|board\s+of\s+examiners)\s*:?$/i;
  const panelRoleLinePattern = /^(?:panel\s*(?:chair(?:\s*person|person|man|woman)?|members?|ists?)|(?:chair(?:person|man|woman)?|member)\s+of\s+(?:the\s+)?panel|chair(?:person|man|woman)?)[\s:;,.]*$/i;
  const inlinePanelPattern = new RegExp(`^(.*?)\\s+(?:panel\\s*(?:${chairRole}|members?|ists?)|(?:${chairRole}|member)\\s+of\\s+(?:the\\s+)?panel)\\b`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanMetadataLine(lines[index]);
    const nextLine = cleanMetadataLine(lines[index + 1] || "");
    const previousLine = cleanMetadataLine(lines[index - 1] || "");
    const inlineMatch = line.match(inlinePanelPattern);
    const roleMatch = line.match(/\b(?:panel\s*(?:chair(?:\s*person|person|man|woman)?|members?|ists?)|(?:chair|member)\s+of\s+(?:the\s+)?panel|chair)\b/i);
    if (panelSectionPattern.test(line)) {
      for (let candidateIndex = index + 1; candidateIndex < lines.length && panelMembers.length < 3; candidateIndex += 1) {
        const candidate = cleanMetadataLine(lines[candidateIndex]);
        if (!candidate || isDocumentHeading(candidate) || isAdviserCaption(candidate)) break;
        if (panelRolePattern.test(candidate) || panelRoleLinePattern.test(candidate)) continue;
        const normalizedCandidate = normalizePersonName(candidate);
        if (isPanelistName(candidate) && !excludedPeople.has(normalizedCandidate)) panelMembers.push(candidate);
      }
      continue;
    }

    const beforeRole = roleMatch ? line.slice(0, roleMatch.index).replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "").trim() : "";
    const afterRole = roleMatch
      ? line.slice(roleMatch.index + roleMatch[0].length).replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "").trim()
      : "";
    const roleName = isPanelistName(afterRole) ? afterRole : isPanelistName(beforeRole) ? beforeRole : "";
    const name = roleName || (panelRoleLinePattern.test(nextLine) ? line
      : (panelRolePattern.test(line) || panelRoleLinePattern.test(line))
        ? isPanelistName(previousLine) ? previousLine : nextLine
        : inlineMatch?.[1] || "");
    if (name && isPanelistName(name) && !excludedPeople.has(normalizePersonName(name))) panelMembers.push(name.trim());
  }

  const uniquePanelMembers = [...new Set(panelMembers)];
  if (uniquePanelMembers.length < 3) {
    const approvalIndex = lines.findIndex((line) => /^approval[\s-]*sheet\b/i.test(cleanMetadataLine(line)));
    if (approvalIndex >= 0) {
      const abstractIndex = findAbstractIndex(lines);
      const approvalEnd = abstractIndex > approvalIndex ? abstractIndex : Math.min(lines.length, approvalIndex + 120);
      const alreadyFound = new Set(uniquePanelMembers.map(normalizePersonName));

      for (let index = approvalIndex + 1; index < approvalEnd && uniquePanelMembers.length < 3; index += 1) {
        const candidate = cleanMetadataLine(lines[index]).replace(/[,;\s]+$/, "").trim();
        if (!isPanelistName(candidate)) continue;
        const normalizedCandidate = normalizePersonName(candidate);
        if (excludedPeople.has(normalizedCandidate) || alreadyFound.has(normalizedCandidate)) continue;

        const adjacentText = `${cleanMetadataLine(lines[index - 1] || "")} ${cleanMetadataLine(lines[index + 1] || "")}`;
        if (/^\s*(?:dean\b|president\b|secretary\b|registrar\b|director\b|thesis\s+advis(?:e|o)r\b|approved\b|accepted\b)/i.test(adjacentText)) continue;

        uniquePanelMembers.push(candidate);
        alreadyFound.add(normalizedCandidate);
      }
    }
  }

  return [...new Map(uniquePanelMembers.map((member) => [normalizePersonName(member), member])).values()].slice(0, 3);
}

function normalizePersonName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:engr|dr|mr|mrs|ms|mit|msit|mep-ece|msce)\b\.?/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function isPanelistName(value) {
  const name = cleanMetadataLine(value).replace(/[,;\s]+$/, "").trim();
  if (!name || name.length > 60 || isInstitutionLine(name)) return false;
  if (/\b(?:adviser|advisor|dean|secretary|approved|accepted|panel|chair(?:person|man|woman)?|member|witness)\b/i.test(name)) return false;
  const words = name.replace(/[,:;]/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  const particles = new Set(["de", "del", "dela", "la", "las", "los", "van", "von", "y", "san", "santa", "di"]);
  return words.every((word) => /^[A-Z][A-Za-z.'-]*$/.test(word) || /^[A-Z]\.$/.test(word) || particles.has(word.toLowerCase()));
}

function isLikelyAuthorLine(line) {
  if (!line || line.length > 50) return false;
  if (/(university|college|institute|campus|bachelor|bs\b|bsc\b|computer science|information technology)/i.test(line)) {
    return false;
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;

  return words.every((word) => {
    const letters = word.replace(/[^A-Za-z]/g, "");
    return (letters.length >= 2 || /^[A-Za-z]\.?$/.test(word)) && /[A-Za-z]{1,}/.test(letters);
  });
}

function isLikelyAuthorOrInstitutionLine(line) {
  if (!line) return false;
  if (/(university|college|institute|campus|bachelor|bs\b|bsc\b|computer science|information technology)/i.test(line)) {
    return true;
  }

  const words = line.split(/\s+/).filter(Boolean);
  return line.length <= 55 && words.length <= 5;
}

function isAdviserCaption(line) {
  const normalized = line.toLowerCase().replace(/[^a-z]/g, "");
  return normalized.includes("thesisadviser")
    || normalized.includes("thesisadvisor")
    || normalized.includes("thesisadviscr")
    || normalized.includes("thesisadviaer");
}

function extractSameLineAdviser(line) {
  const match = line.match(/^(.*?)\bthesis\s+advis(?:er|or|cr|aer)\b\s*[:\-,]?\s*(.*)$/i);
  if (!match) {
    const reversed = line.match(/^\s*thesis\s+advis(?:er|or|cr|aer)\b\s*[:\-,]?\s*(.+)$/i);
    return reversed?.[1]?.trim() || "";
  }
  return (match[1].trim() || match[2].trim()).replace(/[\s,:;-]+$/, "").trim();
}
