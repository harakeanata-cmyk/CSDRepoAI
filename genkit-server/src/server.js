import "dotenv/config";
import express from "express";
import cors from "cors";
import { semanticSearchFlow } from "./flows/semanticSearch.js";
import { embedPaperFlow } from "./flows/embedPaper.js";
import { metadataAnalysisFlow } from "./flows/metadataAnalysis.js";
import { extractMetadataFlow } from "./flows/extractMetadata.js";
import { formatReviewFlow } from "./flows/formatReview.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const app = express();
const allowedOrigins = [
  "https://csd-repo-ai.vercel.app",
  "https://csd-repo-ai-three.vercel.app",
  "https://csd-repo-ai-semantic.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8787",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8787",
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || /^https?:\/\/localhost(?::\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

app.get("/api/admin/users", async (req, res) => {
  const accessToken = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return res.status(401).json({ error: "Authentication is required." });

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
    }

    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();
    if (profileError) throw profileError;
    if (callerProfile.role !== "admin") return res.status(403).json({ error: "Admin access is required." });

    const role = typeof req.query.role === "string" ? req.query.role : null;
    if (role && !["student", "faculty", "admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role filter." });
    }

    let profileQuery = supabaseAdmin.from("profiles").select("*").order("created_at", { ascending: false });
    if (role) profileQuery = profileQuery.eq("role", role);
    const { data: profiles, error: profilesError } = await profileQuery;
    if (profilesError) throw profilesError;

    const authUsers = [];
    const perPage = 1000;
    for (let page = 1; ; page += 1) {
      const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (usersError) throw usersError;
      const batch = usersPage?.users || [];
      authUsers.push(...batch);
      if (batch.length < perPage) break;
    }

    const emailById = new Map(authUsers.map((user) => [user.id, user.email || null]));
    return res.json({ users: (profiles || []).map((profile) => ({ ...profile, email: emailById.get(profile.id) || null })) });
  } catch (error) {
    console.error("[admin/users] Failed to load directory:", error);
    return res.status(500).json({ error: "Unable to load user accounts. Check the server Supabase configuration." });
  }
});

app.post("/api/admin/users", async (req, res) => {
  const accessToken = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return res.status(401).json({ error: "Authentication is required." });

  try {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
    }

    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();
    if (profileError) throw profileError;
    if (callerProfile.role !== "admin") return res.status(403).json({ error: "Admin access is required." });

    const { email, password, first_name, middle_name, last_name, suffix, role, student_number, faculty_number, program } = req.body || {};
    if (!email || !["student", "faculty", "admin"].includes(role)) {
      return res.status(400).json({ error: "A valid email and role are required." });
    }
    const full_name = [first_name, middle_name, last_name, suffix].filter(Boolean).join(" ").trim();
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: password || undefined,
      email_confirm: true,
      user_metadata: { full_name, first_name, middle_name, last_name, suffix, role, student_number, faculty_number, program },
    });
    if (error) throw error;
    return res.status(201).json({ user: data.user });
  } catch (error) {
    console.error("[admin/users] Failed to create account:", error);
    return res.status(500).json({ error: error.message || "Unable to create the account." });
  }
});

const DUPLICATE_SIMILARITY_THRESHOLD = 0.92;
// gemini-embedding-001 accepts at most 2,048 tokens. Keep the request bounded
// to roughly 1,500 English tokens, leaving room for tokenization variance.
const MAX_DUPLICATE_QUERY_CHARS = 6000;
const DUPLICATE_STOP_WORDS = new Set([
  "about", "after", "also", "among", "and", "are", "based", "been", "between", "both", "can", "could",
  "each", "for", "from", "have", "into", "its", "more", "most", "not", "our", "over", "research", "study",
  "such", "than", "that", "the", "their", "these", "this", "through", "using", "was", "were", "with", "within",
]);

/**
 * POST /search
 * Body: { query, sdgFilter?, statusFilter? }
 * Matches the shape src/services/search.js already sends when
 * VITE_GENKIT_SEARCH_URL is configured on the frontend.
 */
app.post("/search", async (req, res) => {
  const { query, sdgFilter, statusFilter } = req.body || {};

  if (!query || !query.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    const result = await semanticSearchFlow({
      query,
      sdgFilter: sdgFilter ?? null,
      statusFilter: statusFilter ?? "approved",
    });
    res.json(result);
  } catch (error) {
    console.error("[genkit] /search failed:", error);
    res.status(500).json({ error: error.message || "semantic search failed" });
  }
});

/**
 * POST /check-duplicate
 * Compares title-independent manuscript context with embeddings for all submissions.
 * Returns only a boolean so unpublished paper details are not exposed.
 */
app.post("/check-duplicate", async (req, res) => {
  const { title, abstract, keywords, documentText, excludePaperId } = req.body || {};
  if (
    (title !== undefined && typeof title !== "string") ||
    (abstract !== undefined && typeof abstract !== "string") ||
    (documentText !== undefined && typeof documentText !== "string") ||
    (keywords !== undefined && typeof keywords !== "string" && !Array.isArray(keywords)) ||
    (Array.isArray(keywords) && keywords.some((keyword) => typeof keyword !== "string"))
  ) {
    return res.status(400).json({ error: "title, abstract, documentText, and keywords must be text" });
  }

  const metadataQuery = [
    String(title || "").trim(),
    String(abstract || "").trim(),
    Array.isArray(keywords) ? keywords.join(", ") : String(keywords || "").trim(),
  ].filter(Boolean).join("\n\n");
  const metadataContext = [title, abstract, Array.isArray(keywords) ? keywords.join(" ") : keywords]
    .filter(Boolean)
    .join(" ");
  // Metadata is editable and often differs between duplicate uploads. Use the
  // manuscript body first so title/abstract/keyword edits cannot hide a copy.
  const manuscriptContext = String(documentText || "").trim();
  const query = manuscriptContext || metadataQuery;

  if (!query) {
    return res.status(400).json({ error: "manuscript context is required" });
  }
  if (query.length > MAX_DUPLICATE_QUERY_CHARS || metadataQuery.length > MAX_DUPLICATE_QUERY_CHARS) {
    return res.status(400).json({
      error: `manuscript context must be ${MAX_DUPLICATE_QUERY_CHARS} characters or fewer`,
    });
  }

  try {
    // The count and remote embedding/vector search are independent; overlap
    // them to avoid adding their network latency together on every request.
    const [indexCountResult, result] = await Promise.all([
      supabaseAdmin
        .from("research_papers")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .is("embedding", null),
      semanticSearchFlow({
        query,
        statusFilter: null,
        matchCount: 100,
      }),
    ]);

    const { count: unindexedCount, error: indexError } = indexCountResult;

    if (indexError) throw indexError;

    // OCR archived papers and older records may not have embeddings yet.
    // Check those records using their stored text and metadata instead of
    // disabling topic checks for every submission until a full reindex ends.
    const unindexedPapers = [];
    if (unindexedCount > 0) {
      const pageSize = 500;
      for (let offset = 0; offset < unindexedCount; offset += pageSize) {
        const { data, error } = await supabaseAdmin
          .from("research_papers")
          .select("id, title, abstract, keywords, ocr_raw_text")
          .eq("status", "approved")
          .is("embedding", null)
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        unindexedPapers.push(...(data || []));
      }
    }

    const candidates = result.items
      .filter((item) => item.status !== "rejected" && item.id !== excludePaperId && Number(item.similarity) >= DUPLICATE_SIMILARITY_THRESHOLD)
      .slice(0, 12);

    const fallbackDuplicate = unindexedPapers.some((paper) => {
      if (paper.id === excludePaperId) return false;
      const candidateMetadata = [paper.title, paper.abstract, ...(Array.isArray(paper.keywords) ? paper.keywords : [paper.keywords])]
        .filter(Boolean)
        .join(" ");
      const documentOverlap = getContentOverlap(manuscriptContext, paper.ocr_raw_text);
      const metadataOverlap = getContentOverlap(metadataContext, candidateMetadata);
      return documentOverlap >= 0.35 || metadataOverlap >= 0.75;
    });

    if (!candidates.length) return res.json({ duplicate: fallbackDuplicate });

    const { data: candidateDocuments, error: candidateError } = await supabaseAdmin
      .from("research_papers")
      .select("id, ocr_raw_text")
      .in("id", candidates.map((item) => item.id));

    if (candidateError) throw candidateError;
    const documentTextById = new Map((candidateDocuments || []).map((paper) => [paper.id, paper.ocr_raw_text || ""]));
    const duplicate = fallbackDuplicate || candidates.some((item) => {
      const candidateDocument = documentTextById.get(item.id);
      const candidateMetadata = [item.title, item.abstract, ...(item.keywords || [])].filter(Boolean).join(" ");
      const documentOverlap = getContentOverlap(manuscriptContext, candidateDocument);
      const metadataOverlap = getContentOverlap(metadataContext, candidateMetadata);
      return documentOverlap >= 0.35 || metadataOverlap >= 0.75;
    });

    res.json({ duplicate });
  } catch (error) {
    console.error("[genkit] /check-duplicate failed:", error?.stack || error);
    res.status(500).json({ error: "manuscript similarity check failed" });
  }
});

function getContentOverlap(left, right) {
  const leftTerms = getContentTerms(left);
  const rightTerms = getContentTerms(right);
  const smallestSetSize = Math.min(leftTerms.size, rightTerms.size);
  if (smallestSetSize < 10) return 0;

  let sharedTerms = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) sharedTerms += 1;
  }
  return sharedTerms / smallestSetSize;
}

function getContentTerms(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3 && !DUPLICATE_STOP_WORDS.has(term))
  );
}

/**
 * POST /embed
 * Body: { paperId }
 * Called by the frontend (fire-and-forget) right after a paper is
 * submitted, so it becomes semantically searchable without a manual
 * reindex step.
 */
app.post("/embed", async (req, res) => {
  const { paperId } = req.body || {};

  if (!paperId) {
    return res.status(400).json({ error: "paperId is required" });
  }

  try {
    const result = await embedPaperFlow({ paperId });
    res.json(result);
  } catch (error) {
    console.error("[genkit] /embed failed:", error);
    res.status(500).json({ error: error.message || "embedding failed" });
  }
});

/**
 * POST /metadata
 * Body: { title, abstract, keywords, text }
 * Uses Google Genkit + Gemini to generate research metadata for the
 * student submission flow. Falls back to the existing local heuristic
 * analysis if the Genkit endpoint is unavailable.
 */
app.post("/metadata", async (req, res) => {
  const { title, abstract, keywords, text } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  try {
    const result = await metadataAnalysisFlow({
      title: title || "",
      abstract: abstract || "",
      keywords: keywords || "",
      text,
    });
    res.json(result);
  } catch (error) {
    console.error("[genkit] /metadata failed:", error);
    res.status(500).json({ error: error.message || "metadata analysis failed" });
  }
});

app.post("/extract-metadata", async (req, res) => {
  const { documentText } = req.body || {};

  if (!documentText || !documentText.trim()) {
    return res.status(400).json({ error: "documentText is required" });
  }

  try {
    const result = await extractMetadataFlow({ documentText });
    res.json(result);
  } catch (error) {
    console.error("[genkit] /extract-metadata failed:", error);
    res.status(500).json({ error: error.message || "metadata extraction failed" });
  }
});

app.post("/format-review", async (req, res) => {
  try {
    const result = await formatReviewFlow(req.body || {});
    res.json(result);
  } catch (error) {
    console.error("[genkit] /format-review failed:", error);
    res.status(500).json({ error: error.message || "paper format review failed" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

if (!process.env.VERCEL) {
  const port = process.env.PORT || 8787;
  app.listen(port, () => {
    console.log(`[genkit] CSDRepoAI semantic search server listening on http://localhost:${port}`);
    console.log(`[genkit] Point the frontend at it via VITE_GENKIT_SEARCH_URL=http://localhost:${port}/search`);
  });
}

export default app;
