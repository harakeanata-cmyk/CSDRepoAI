const MINIMUM_WORDS = 55;
const MINIMUM_LETTERS = 280;
const STOP_WORDS = new Set([
  "about", "after", "also", "among", "and", "are", "been", "between", "chapter", "from", "have", "into", "more", "not", "of", "our", "that", "the", "their", "this", "through", "was", "were", "which", "with",
]);
const SDG_EVIDENCE = {
  1: ["poverty", "income", "livelihood", "employment", "economic"],
  2: ["food", "hunger", "nutrition", "agriculture", "crop", "farm"],
  3: ["health", "medical", "patient", "disease", "hospital", "clinic"],
  4: ["education", "learning", "student", "school", "teaching", "academic"],
  5: ["gender", "women", "woman", "equality", "female", "empowerment"],
  6: ["water", "sanitation", "wastewater", "hygiene", "drinking"],
  7: ["energy", "renewable", "solar", "electricity", "power"],
  8: ["work", "employment", "worker", "economic", "business", "productivity"],
  9: ["industry", "innovation", "infrastructure", "technology", "manufacturing", "engineering", "system", "software", "computer", "digital", "artificial intelligence"],
  10: ["inequality", "inclusion", "accessibility", "disability", "discrimination", "marginalized"],
  11: ["city", "urban", "community", "transport", "housing", "disaster", "sustainable"],
  12: ["consumption", "production", "waste", "recycling", "resource"],
  13: ["climate", "carbon", "emission", "weather", "warming", "environment", "pollution"],
  16: ["peace", "justice", "institution", "governance", "legal", "crime", "security"],
};

function cleanText(value) {
  return String(value ?? "")
    .replace(/__DOCX_(?:BOLD|ITALIC)__/g, " ")
    .replace(/---\s*page\s+\d+\s*---/gi, " ")
    .normalize("NFKC")
    .toLocaleLowerCase();
}

function getTokens(value) {
  return cleanText(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function getMeaningfulTokens(value) {
  return getTokens(value).filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function overlapsDocument(value, documentTokens, minimumMatches = 1) {
  const tokens = [...new Set(getMeaningfulTokens(value))];
  const matches = tokens.filter((token) => documentTokens.has(token));
  return matches.length >= minimumMatches;
}

function validateDocumentText(ocrText) {
  const text = cleanText(ocrText);
  const tokens = getTokens(text);
  const letters = (text.match(/[\p{L}]/gu) || []).length;

  if (tokens.length < MINIMUM_WORDS || letters < MINIMUM_LETTERS) {
    return {
      ok: false,
      message: "This upload does not contain enough readable text to verify it as a research paper. Please upload clear pages from the complete paper and run OCR again.",
    };
  }

  const hasPaperSection = /\b(?:abstract|introduction|methodology|methods|results|discussion|conclusion|references|bibliography|review of related literature|literature review)\b/i.test(text);
  const hasResearchContent = /\b(?:research|study|studies|thesis|dissertation|methodology|participants|survey|experiment|findings|hypothesis|data analysis|research design)\b/i.test(text);
  if (!hasPaperSection || !hasResearchContent) {
    return {
      ok: false,
      message: "The extracted text does not look like research-paper content. Check that you uploaded a research paper, or use clearer images and scan the paper pages again.",
    };
  }

  const contentTokens = tokens.filter((token) => token.length >= 3);
  const uniqueRatio = new Set(contentTokens).size / Math.max(contentTokens.length, 1);
  if (uniqueRatio < 0.2) {
    return {
      ok: false,
      message: "The OCR text appears too repetitive or garbled to verify this as a research paper. Please upload clearer images and scan again.",
    };
  }

  return { ok: true, message: "" };
}

export function validateOcrResearchRecord({ ocrText, title, authors, adviser, panelMembers, abstract, keywords, sdgTags = [] }) {
  const documentCheck = validateDocumentText(ocrText);
  if (!documentCheck.ok) return documentCheck;

  const documentTokens = new Set(getMeaningfulTokens(ocrText));
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) return { ok: false, message: "Enter a research title before archiving." };
  const titleTokens = [...new Set(getMeaningfulTokens(cleanTitle))];
  const titleWordCount = titleTokens.filter((token) => /\p{L}/u.test(token)).length;
  if (titleWordCount < 2 || !overlapsDocument(cleanTitle, documentTokens, Math.min(2, titleTokens.length))) {
    return { ok: false, message: "The title does not match the extracted paper text. Check the title and OCR text before archiving." };
  }

  const authorNames = Array.isArray(authors) ? authors : String(authors ?? "").split(",");
  if (!authorNames.length || authorNames.some((name) => /[^\p{L} .'-]/u.test(String(name)) || !overlapsDocument(name, documentTokens, 1))) {
    return { ok: false, message: "One or more author names are invalid or do not match the extracted paper text. Check the author names and OCR text before archiving." };
  }

  if (String(adviser ?? "").trim() && (/[^\p{L} .'-]/u.test(String(adviser)) || !overlapsDocument(adviser, documentTokens, 1))) {
    return { ok: false, message: "The adviser name could not be matched to the extracted paper text. Check the name and OCR text before archiving." };
  }

  const panelNames = Array.isArray(panelMembers) ? panelMembers : String(panelMembers ?? "").split(",");
  if (panelNames.some((name) => /[^\p{L} .'-]/u.test(String(name)) || !overlapsDocument(name, documentTokens, 1))) {
    return { ok: false, message: "One or more panel-member names could not be matched to the extracted paper text. Check the names and OCR text before archiving." };
  }

  const cleanAbstract = String(abstract ?? "").trim();
  if (cleanAbstract) {
    const abstractTokens = getMeaningfulTokens(cleanAbstract);
    if (abstractTokens.length < 20 || !overlapsDocument(cleanAbstract, documentTokens, 5)) {
      return { ok: false, message: "The abstract is too short or does not match the extracted paper text. Check it before archiving." };
    }
  }

  const keywordTerms = Array.isArray(keywords) ? keywords : String(keywords ?? "").split(/[;,]/);
  const meaningfulKeywords = keywordTerms.filter((keyword) => String(keyword).trim());
  const matchedKeywordCount = meaningfulKeywords.filter((keyword) => /\p{L}/u.test(String(keyword)) && overlapsDocument(keyword, documentTokens, 1)).length;
  if (meaningfulKeywords.some((keyword) => !/\p{L}/u.test(String(keyword))) || (meaningfulKeywords.length > 0 && matchedKeywordCount / meaningfulKeywords.length < 0.5)) {
    return { ok: false, message: "One or more keywords could not be matched to the extracted paper text. Check the keywords before archiving." };
  }

  const sdgEvidenceTokens = new Set(getMeaningfulTokens(`${title ?? ""} ${abstract ?? ""} ${Array.isArray(keywords) ? keywords.join(" ") : keywords ?? ""} ${ocrText ?? ""}`));
  const unrelatedSdg = (sdgTags || []).find((id) => !(SDG_EVIDENCE[id] || []).some((term) => sdgEvidenceTokens.has(term)));
  if (unrelatedSdg) {
    return { ok: false, message: `SDG ${unrelatedSdg} is not supported by the extracted text. Review the selected SDG alignment before archiving.` };
  }

  return { ok: true, message: "" };
}
