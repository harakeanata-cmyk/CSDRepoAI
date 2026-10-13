import { z } from "genkit";
import { ai, embedder, embedOptions } from "../genkit.config.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { extractEmbeddingValues, toVectorLiteral } from "../embeddingUtils.js";

export const semanticSearchFlow = ai.defineFlow(
  {
    name: "semanticSearch",
    inputSchema: z.object({
      query: z.string().min(1),
      sdgFilter: z.number().int().optional().nullable(),
      statusFilter: z.string().optional().nullable().default("approved"),
      submitterFilter: z.string().uuid().optional().nullable(),
      matchCount: z.number().int().min(1).max(100).optional().default(30),
    }),
    outputSchema: z.object({
      items: z.array(z.any()),
    }),
  },
  async ({ query, sdgFilter, statusFilter, submitterFilter, matchCount }) => {
    const rawQueryEmbedding = await ai.embed({ embedder, content: query, options: embedOptions });
    const queryEmbedding = toVectorLiteral(extractEmbeddingValues(rawQueryEmbedding));

    const { data, error } = await supabaseAdmin.rpc("match_research_papers", {
      query_embedding: queryEmbedding,
      match_count: matchCount ?? 30,
      status_filter: statusFilter === undefined ? "approved" : statusFilter,
      sdg_filter: sdgFilter ?? null,
      submitter_filter: submitterFilter ?? null,
    });

    if (error) throw error;

    return { items: data || [] };
  }
);
