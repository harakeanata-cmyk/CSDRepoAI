import { useState } from "react";
import { Search as SearchIcon, FileSearch, FolderOpen, Eye, ExternalLink } from "lucide-react";
import Layout from "../components/Layout";
import { PageHeader, EmptyState } from "../components/ui";
import { searchResearch } from "../services/search";
import { openResearchPreviewInNewTab } from "../services/paperPreview";
import { getApprovedResearchText, getResearchFileUrls, incrementViewCount } from "../services/research";

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");

  async function handlePreview(paper, urls, label) {
    setPreviewError("");
    try {
      await openResearchPreviewInNewTab({
        urls,
        title: paper.title,
        label,
        getDocumentText: () => getApprovedResearchText(paper.id),
      });
      incrementViewCount(paper.id);
    } catch (previewRequestError) {
      setPreviewError(previewRequestError.message || "Could not open the paper preview.");
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setSearched(true);
    setError("");
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
      {previewError && <p className="auth-error" role="alert" style={{ marginBottom: 16 }}>{previewError}</p>}

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
        {results.map((r) => (
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
                  label="manuscript"
                  onPreview={handlePreview}
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
                <ResearchFileActions paper={r} urls={getResearchFileUrls(r.ieee_paper_url)} label="IEEE paper" onPreview={handlePreview} />
              )}
              {getResearchFileUrls(r.acm_paper_url).length > 0 && (
                <ResearchFileActions paper={r} urls={getResearchFileUrls(r.acm_paper_url)} label="ACM paper" onPreview={handlePreview} />
              )}
              {getResearchFileUrls(r.apa_paper_url).length > 0 && (
                <ResearchFileActions paper={r} urls={getResearchFileUrls(r.apa_paper_url)} label="APA paper" onPreview={handlePreview} />
              )}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}

function ResearchFileActions({ paper, urls, label, onPreview }) {
  return (
    <>
      <button
        type="button"
        className="search-file-action search-file-preview"
        onClick={() => onPreview(paper, urls, label)}
        title="Open an inline paper preview in a new browser tab without saving the file."
      >
        <Eye size={13} /> Preview {label}
      </button>
      <a
        href={urls[0]}
        target="_blank"
        rel="noreferrer"
        onClick={() => incrementViewCount(paper.id)}
        className="search-file-action"
      >
        <ExternalLink size={13} /> Open {label}
      </a>
    </>
  );
}
