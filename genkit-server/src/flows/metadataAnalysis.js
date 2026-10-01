import { z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../genkit.config.js";

const metadataSchema = z.object({
  category: z.string(),
  keywords: z.array(z.string()),
  sdgTags: z.array(z.number().int()),
  sdgNames: z.array(z.string()),
});

export const metadataAnalysisFlow = ai.defineFlow(
  {
    name: "metadataAnalysis",
    inputSchema: z.object({
      title: z.string().optional().default(""),
      abstract: z.string().optional().default(""),
      keywords: z.string().optional().default(""),
      text: z.string().min(1),
    }),
    outputSchema: metadataSchema,
  },
  async ({ title, abstract, keywords, text }) => {
    const prompt = `You are helping extract metadata for a research submission.

Analyze the manuscript text below and return JSON with exactly these keys:
- category: the best matching research category
- keywords: an array of up to 8 relevant keywords
- sdgTags: an array of SDG numeric ids that best apply (for example [4,9,13])
- sdgNames: an array of matching SDG titles

Use the title, abstract, current keywords, and manuscript text as input.

Title:
${title || ""}

Abstract:
${abstract || ""}

Existing keywords:
${keywords || ""}

Manuscript text:
${text}

Return only valid JSON.`;

    const response = await ai.generate({
      model: googleAI.model("gemini-3.8-flash"),
      prompt,
    });

    const parsed = parseMetadataResponse(response.text);
    return {
      category: parsed.category || "Computer Studies",
      keywords: parsed.keywords || [],
      sdgTags: parsed.sdgTags || [],
      sdgNames: parsed.sdgNames || [],
    };
  }
);

function parseMetadataResponse(rawText) {
  const cleaned = String(rawText || "").trim();
  const jsonText = cleaned.startsWith("```")
    ? cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
    : cleaned;

  const parsed = JSON.parse(jsonText);
  return {
    category: String(parsed.category || "Computer Studies").trim(),
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 8)
      : [],
    sdgTags: Array.isArray(parsed.sdgTags)
      ? parsed.sdgTags.map((tag) => Number(tag)).filter((tag) => Number.isInteger(tag))
      : [],
    sdgNames: Array.isArray(parsed.sdgNames)
      ? parsed.sdgNames.map((name) => String(name).trim()).filter(Boolean)
      : [],
  };
}
