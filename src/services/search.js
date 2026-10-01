import { supabase } from "../lib/supabaseClient";
import { toGenkitEndpoint } from "../lib/genkitUrl.js";
import { rankSearchResults } from "../lib/searchRanking.js";

const GENKIT_SEARCH_URL = toGenkitEndpoint(import.meta.env.VITE_GENKIT_SEARCH_URL, "search");
const GENKIT_DUPLICATE_URL = toGenkitEndpoint(GENKIT_SEARCH_URL, "check-duplicate");
export async function checkResearchDuplicate({ title, abstract, keywords = [], documentText = "", excludePaperId }) {
  if (!GENKIT_DUPLICATE_URL || GENKIT_DUPLICATE_URL === GENKIT_SEARCH_URL) {
    throw new Error("Topic duplicate checking is not configured. Ask an administrator to enable semantic search before submitting this manuscript.");
  }

  try {
    const response = await fetch(GENKIT_DUPLICATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, abstract, keywords, documentText: String(documentText || "").slice(0, 6000), excludePaperId }),
    });

    if (!response.ok) {
      throw new Error(`Topic duplicate checking is temporarily unavailable (${response.status}). Please try again later.`);
    }

    const result = await response.json();
    if (typeof result.duplicate !== "boolean") {
      throw new Error("Topic duplicate checking returned an invalid response. Please try again later.");
    }
    if (result.duplicate) {
      throw new Error("The duplicate check found research with very similar content. This submission was not saved. Review the existing record before trying again.");
    }

    return false;
  } catch (error) {
    if (error instanceof Error && /Failed to fetch|fetch/i.test(error.message)) {
      throw new Error("Topic duplicate checking is temporarily unavailable. Please try again later.");
    }
    throw error;
  }
}

/**
 * AI-Assisted Search and Retrieval Module
 *
 * The default path uses Postgres full-text search (the `search_vector` column
 * defined in supabase/schema.sql) so search works out of the box with no extra
 * infrastructure. When `VITE_GENKIT_SEARCH_URL` is configured, this service
 * will first try the Google Genkit semantic-search endpoint (see the
 * /genkit-server directory for the actual embedding + search service, built
 * with Google's gemini-embedding-001 model and Supabase pgvector) and falls
 * back cleanly to the existing Supabase text search if that endpoint is
 * unavailable.
 */
export async function searchResearch(query, { sdgFilter, statusFilter = "approved" } = {}) {
  if (!query || !query.trim()) return [];

  const normalizedQuery = query.trim();
  const textSearchPromise = searchByText(normalizedQuery, { sdgFilter, statusFilter });
  const semanticSearchPromise = GENKIT_SEARCH_URL
    ? searchBySemantic(normalizedQuery, { sdgFilter, statusFilter })
    : Promise.resolve([]);

  const [textResult, semanticResult] = await Promise.allSettled([
    textSearchPromise,
    semanticSearchPromise,
  ]);

  const textItems = textResult.status === "fulfilled" ? textResult.value : [];
  const semanticItems = semanticResult.status === "fulfilled" ? semanticResult.value : [];

  if (semanticResult.status === "rejected") {
    console.warn("Genkit semantic search unavailable, using text search results.", semanticResult.reason);
  }
  if (semanticResult.status === "rejected" && textItems.length === 0) {
    throw semanticResult.reason;
  }
  if (textResult.status === "rejected" && semanticItems.length === 0) {
    throw textResult.reason;
  }

  return rankSearchResults(normalizedQuery, textItems, semanticItems);
}

async function searchBySemantic(query, filters) {
  const response = await fetch(GENKIT_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, ...filters }),
  });

  if (!response.ok) {
    throw new Error(`Semantic search failed with status ${response.status}`);
  }

  const payload = await response.json();
  const items = payload.items || payload.results || payload.data || payload.searchResults;
  return Array.isArray(items) ? items : [];
}

async function searchByText(query, { sdgFilter, statusFilter }) {
  let request = supabase
    .from("research_papers")
    .select("*")
    .textSearch("search_vector", formatQuery(query), {
      type: "websearch",
      config: "english",
    });

  if (statusFilter) request = request.eq("status", statusFilter);
  if (sdgFilter) request = request.contains("sdg_tags", [sdgFilter]);

  const { data, error } = await request.limit(30);
  if (error) throw error;
  return data || [];
}

function formatQuery(raw) {
  // websearch_to_tsquery handles natural phrasing like "AI search for thesis papers"
  return raw.trim();
}
