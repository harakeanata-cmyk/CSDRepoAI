const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with",
  "find", "paper", "papers", "research", "study", "studies", "system",
]);

const SEARCH_FIELDS = [
  ["title", 3],
  ["authors", 2.6],
  ["keywords", 2.4],
  ["abstract", 1.3],
  ["ocr_raw_text", 0.5],
];
const MIN_SEMANTIC_SIMILARITY = 0.53;

export function rankSearchResults(query, textItems, semanticItems) {
  const byId = new Map();

  for (const item of [...textItems, ...semanticItems]) {
    if (!item?.id) continue;

    const existing = byId.get(item.id);
    byId.set(item.id, existing ? { ...existing, ...item } : item);
  }

  return [...byId.values()]
    .map((item) => ({ item, ...getSearchMatch(query, item) }))
    .filter(({ relevant }) => relevant)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 30)
    .map(({ item, confidence }) => ({ ...item, matchConfidence: confidence }));
}

export function getSearchMatch(query, item) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = [...new Set(normalizedQuery.split(" ").filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token)))];
  const fields = SEARCH_FIELDS.map(([key, weight]) => [
    weight,
    normalizeSearchText(Array.isArray(item[key]) ? item[key].join(" ") : item[key]),
  ]).filter(([, value]) => value);
  const exactField = normalizedQuery.length > 2
    ? fields.find(([, value]) => value.includes(normalizedQuery))
    : null;
  const fieldTokenSets = fields.map(([weight, value]) => [weight, new Set(value.split(" "))]);
  const weightedCoverage = tokens.length
    ? tokens.reduce((total, token) => total + Math.max(0, ...fieldTokenSets.map(([weight, values]) => values.has(token) ? weight : 0)), 0)
      / (tokens.length * SEARCH_FIELDS[0][1])
    : 0;
  const semanticSimilarity = Math.min(1, Math.max(0, Number(item.similarity) || 0));
  const semanticEvidence = Math.min(1, Math.max(0, (semanticSimilarity - 0.35) / 0.4));

  let lexicalScore = Math.round(weightedCoverage * 100);
  if (exactField) {
    const fieldWeight = exactField[0];
    lexicalScore = Math.max(lexicalScore, fieldWeight >= 3 ? 100 : fieldWeight >= 2.4 ? 88 : fieldWeight >= 2 ? 84 : fieldWeight >= 1 ? 72 : 55);
  }

  const confidence = Math.min(95, lexicalScore === 100
    ? 95
    : Math.round(lexicalScore * 0.65 + semanticEvidence * 35));
  const minimumLexicalCoverage = tokens.length > 1 ? 0.6 : 0.45;
  const relevant = Boolean(exactField)
    || semanticSimilarity >= MIN_SEMANTIC_SIMILARITY
    || (tokens.length > 0 && weightedCoverage >= minimumLexicalCoverage);
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
