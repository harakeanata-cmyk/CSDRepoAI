import { z } from "genkit";
import { createHash } from "node:crypto";
import { ai, embedder, embedOptions } from "../genkit.config.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { extractEmbeddingValues, toVectorLiteral } from "../embeddingUtils.js";

const MAX_DOCUMENT_TEXT_CHARS = 5000;

/** Builds the text blob that gets embedded for a paper. Mirrors the
 *  fields already weighted into the Postgres full-text `search_vector`
 *  column, so semantic and keyword search stay conceptually aligned. */
function buildEmbeddingText(paper) {
  return [
    paper.title,
    paper.abstract,
    (paper.keywords || []).join(", "),
    String(paper.ocr_raw_text || "").slice(0, MAX_DOCUMENT_TEXT_CHARS),
    (paper.authors || []).join(", "),
    paper.program,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getPaperFileUrls(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [value];
  } catch {
    return [value];
  }
}

async function hashPaperFiles(urls) {
  const fileHashes = [];
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Could not read manuscript file for duplicate detection (${response.status || "no response body"}).`);
    }
    const fileHash = createHash("sha256");
    for await (const chunk of response.body) fileHash.update(chunk);
    fileHashes.push(fileHash.digest("hex"));
  }

  if (fileHashes.length === 1) return fileHashes[0];
  return createHash("sha256").update(fileHashes.join("\n")).digest("hex");
}

export const embedPaperFlow = ai.defineFlow(
  {
    name: "embedPaper",
    inputSchema: z.object({ paperId: z.string().uuid() }),
    outputSchema: z.object({ paperId: z.string(), embedded: z.boolean() }),
  },
  async ({ paperId }) => {
    const { data: paper, error } = await supabaseAdmin
      .from("research_papers")
      .select("id, title, abstract, keywords, authors, program, ocr_raw_text, file_url, manuscript_sha256, embedding")
      .eq("id", paperId)
      .single();

    if (error || !paper) {
      throw new Error(`Paper ${paperId} not found: ${error?.message || "no row"}`);
    }

    const updates = {};
    const text = buildEmbeddingText(paper);
    if (!paper.embedding && text.trim()) {
      const rawEmbedding = await ai.embed({ embedder, content: text, options: embedOptions });
      updates.embedding = toVectorLiteral(extractEmbeddingValues(rawEmbedding));
    }

    const fileUrls = getPaperFileUrls(paper.file_url);
    if (!paper.manuscript_sha256 && fileUrls.length) {
      updates.manuscript_sha256 = await hashPaperFiles(fileUrls);
    }

    if (Object.keys(updates).length) {
      let { error: updateError } = await supabaseAdmin
        .from("research_papers")
        .update(updates)
        .eq("id", paperId);

      if (updateError?.code === "23505" && updates.embedding && updates.manuscript_sha256) {
        console.warn("Manuscript fingerprint already exists; saving the semantic embedding without it.");
        const { error: embeddingError } = await supabaseAdmin
          .from("research_papers")
          .update({ embedding: updates.embedding })
          .eq("id", paperId);
        updateError = embeddingError;
      }

      if (updateError) throw updateError;
    }

    return { paperId, embedded: Boolean(paper.embedding || updates.embedding) };
  }
);

export { buildEmbeddingText };
