const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with",
  "find", "paper", "papers", "research", "study", "studies", "system",
]);

const SEARCH_FIELDS = [
  ["title", 1],
  ["authors", 0.88],
  ["keywords", 0.92],
  ["abstract", 0.76],
  ["ocr_raw_text", 0.5],
];
// Keep useful semantic neighbors even when the wording differs substantially
// from a short natural-language query (for example, "house to sleep" vs.
// research describing homes or sleeping accommodation).
// Keep the semantic neighbors that are meaningfully related while avoiding
// broad, low-confidence matches. The deployed embedding endpoint scored the
// boarding-house result for "house to sleep" at 0.539; unrelated neighbors
// were below 0.47, so this cutoff keeps that result and drops the noise.
const MIN_SEMANTIC_SIMILARITY = 0.52;

export function rankSearchResults(query, textItems, semanticItems) {
  const byId = new Map();
  const fullTextMatchIds = new Set(textItems.map((item) => item?.id).filter(Boolean));

  for (const item of [...textItems, ...semanticItems]) {
    if (!item?.id) continue;

    const existing = byId.get(item.id);
    byId.set(item.id, existing ? { ...existing, ...item } : item);
  }

  return [...byId.values()]
    .map((item) => {
      const match = getSearchMatch(query, item);
      const fullTextMatch = fullTextMatchIds.has(item.id);
      return {
        item,
        confidence: fullTextMatch && !match.relevant ? Math.max(match.confidence, 62) : match.confidence,
        relevant: fullTextMatch || match.relevant,
      };
    })
    .filter(({ relevant }) => relevant)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 30)
    .map(({ item, confidence }) => ({ ...item, matchConfidence: confidence }));
}

export function getSearchMatch(query, item) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = [...new Set(normalizedQuery.split(" ").filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token)))];
  const fields = SEARCH_FIELDS.map(([key, weight]) => [
    key,
    weight,
    normalizeSearchText(Array.isArray(item[key]) ? item[key].join(" ") : item[key]),
  ]).filter(([, , value]) => value);
  const exactPhraseField = tokens.length > 1 && normalizedQuery.length > 2
    ? fields.find(([, , value]) => ` ${value} `.includes(` ${normalizedQuery} `))
    : null;
  const fieldTokenSets = fields.map(([key, weight, value]) => [key, weight, new Set(value.split(" "))]);
  const matchedTokens = tokens.filter((token) => fieldTokenSets.some(([, , values]) => values.has(token)));
  const weightedCoverage = tokens.length
    ? tokens.reduce((total, token) => total + Math.max(0, ...fieldTokenSets.map(([, weight, values]) => values.has(token) ? weight : 0)), 0) / tokens.length
    : 0;
  const bestFieldCoverage = tokens.length
    ? Math.max(0, ...fieldTokenSets.map(([, weight, values]) => {
      const coverage = tokens.filter((token) => values.has(token)).length / tokens.length;
      return coverage * weight;
    }))
    : 0;
  const semanticSimilarity = Math.min(1, Math.max(0, Number(item.similarity) || 0));

  // A full phrase match in the title is an exact lexical match. Other fields
  // receive slightly lower scores because they provide weaker evidence.
  const exactPhraseScore = exactPhraseField
    ? Math.round(100 * exactPhraseField[1])
    : 0;
  const singleTermFactor = tokens.length === 1 ? 0.65 : 1;
  const lexicalScore = Math.round(Math.max(
    bestFieldCoverage * 100 * singleTermFactor,
    weightedCoverage * 88 * singleTermFactor,
    exactPhraseScore,
  ));
  // Cosine similarity is not a probability. Map it to a bounded relevance
  // score and let direct query-term evidence take precedence when stronger.
  const semanticScore = semanticSimilarity > 0
    ? Math.round(Math.min(94, Math.max(0, 55 + ((semanticSimilarity - 0.5) / 0.3) * 39)))
    : 0;
  const confidence = Math.min(100, Math.max(lexicalScore, semanticScore));
  const minimumLexicalCoverage = tokens.length > 1 ? 0.6 : 0.45;
  const relevant = Boolean(exactPhraseField)
    || (tokens.length > 0 && matchedTokens.length > 0 && weightedCoverage >= minimumLexicalCoverage)
    || semanticSimilarity >= MIN_SEMANTIC_SIMILARITY;

  return { confidence, relevant };
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
