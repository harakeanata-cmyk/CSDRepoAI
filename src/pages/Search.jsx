import { useEffect, useState } from "react";
import { Search as SearchIcon, FileSearch, FolderOpen } from "lucide-react";
import Layout from "../components/Layout";
import { PageHeader, EmptyState } from "../components/ui";
import { searchResearch } from "../services/search";
import { getResearchFileUrls, incrementViewCount } from "../services/research";
import ResearchFileActions from "../components/ResearchFileActions";

const SEARCH_STATE_KEY = "csdrepoai_semantic_search_state";
const RESULTS_PER_PAGE = 5;

function readSearchState() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(SEARCH_STATE_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    return {
      query: typeof saved.query === "string" ? saved.query : "",
      results: Array.isArray(saved.results) ? saved.results : [],
      visibleResultCount: Number.isInteger(saved.visibleResultCount) && saved.visibleResultCount > 0
        ? saved.visibleResultCount
        : RESULTS_PER_PAGE,
      searched: saved.searched === true,
      error: typeof saved.error === "string" ? saved.error : "",
    };
  } catch {
    return null;
  }
}

export default function Search() {
  const [initialState] = useState(readSearchState);
  const [query, setQuery] = useState(() => initialState?.query || "");
  const [results, setResults] = useState(() => initialState?.results || []);
  const [visibleResultCount, setVisibleResultCount] = useState(() => initialState?.visibleResultCount || RESULTS_PER_PAGE);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(() => initialState?.searched || false);
  const [error, setError] = useState(() => initialState?.error || "");

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify({
        query,
        results,
        visibleResultCount,
        searched,
        error,
      }));
    } catch {
      // Search remains usable when browser storage is unavailable or full.
    }
  }, [query, results, visibleResultCount, searched, error]);

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setSearched(true);
    setError("");
    setVisibleResultCount(RESULTS_PER_PAGE);
    try {
      const data = await searchResearch(query);
      setResults(data);
    } catch (searchError) {
      setResults([]);
      setError(searchError.message || "Search is temporarily unavailable. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <PageHeader
        eyebrow="AI-Assisted Retrieval"
        title="Search the Repository"
        description="Search by topic, author, title, abstract, keywords, or OCR-digitized text across the archive."
      />

      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 24, maxWidth: 640 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. mobile app for barangay disaster response"
          className="input"
        />
        <button type="submit" className="btn btn-brass">
          <SearchIcon size={14} /> Search
        </button>
      </form>

      {error && <p className="auth-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>}

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="card">
          <EmptyState icon={FileSearch} title="No matches found">
            No matching research found. Try a broader topic or fewer keywords.
          </EmptyState>
        </div>
      )}

      {!loading && results.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 12 }}>
          {results.length} result{results.length === 1 ? "" : "s"} for "{query}"
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {results.slice(0, visibleResultCount).map((r) => (
          <div key={r.id} className="card card-pad">
            <div className="search-result-heading">
              <h3>{r.title}</h3>
              <div
                className={`search-match-confidence${r.matchConfidence >= 80 ? " is-high" : r.matchConfidence >= 65 ? " is-mid" : " is-low"}`}
                aria-label={`Estimated relevance score ${r.matchConfidence}%`}
                title="Estimated relevance from text and semantic matches. It is not a probability or a certainty score."
              >
                <span>Relevance</span>
                <strong>{r.matchConfidence}%</strong>
                <span className="search-match-track" aria-hidden="true"><span style={{ width: `${r.matchConfidence}%` }} /></span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6 }}>{r.abstract}</p>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {(r.keywords || []).map((k) => (
                <span key={k} className="badge badge-neutral">
                  {k}
                </span>
              ))}
            </div>
            <div className="search-result-files">
              {getResearchFileUrls(r.file_url).length > 0 && (
                <ResearchFileActions
                  paper={r}
                  urls={getResearchFileUrls(r.file_url)}
                  field="file_url"
                  label="manuscript"
                />
              )}
              {getResearchFileUrls(r.source_code_url).length > 0 && (
                <a
                  href={getResearchFileUrls(r.source_code_url)[0]}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => incrementViewCount(r.id)}
                  className="search-file-action"
                >
                  <FolderOpen size={13} /> Open source code
                </a>
              )}
              {getResearchFileUrls(r.ieee_paper_url).length > 0 && (
                <ResearchFileActions paper={r} urls={getResearchFileUrls(r.ieee_paper_url)} field="ieee_paper_url" label="IEEE paper" />
              )}
              {getResearchFileUrls(r.acm_paper_url).length > 0 && (
                <ResearchFileActions paper={r} urls={getResearchFileUrls(r.acm_paper_url)} field="acm_paper_url" label="ACM paper" />
              )}
              {getResearchFileUrls(r.apa_paper_url).length > 0 && (
                <ResearchFileActions paper={r} urls={getResearchFileUrls(r.apa_paper_url)} field="apa_paper_url" label="APA paper" />
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && results.length > visibleResultCount && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setVisibleResultCount((count) => count + RESULTS_PER_PAGE)}
          >
            Show more ({results.length - visibleResultCount} remaining)
          </button>
        </div>
      )}
    </Layout>
  );
}
