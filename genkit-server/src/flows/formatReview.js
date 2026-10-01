import { z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../genkit.config.js";

const formatReviewSchema = z.object({ message: z.string() });

export const formatReviewFlow = ai.defineFlow(
  {
    name: "paperFormatReview",
    inputSchema: z.object({
      candidateSections: z.array(z.string()),
      commonSections: z.array(z.string()),
      missingSections: z.array(z.string()),
      unusualSections: z.array(z.string()),
      comparedPapers: z.number().int().min(1),
    }),
    outputSchema: formatReviewSchema,
  },
  async ({ candidateSections, commonSections, missingSections, unusualSections, comparedPapers }) => {
    const prompt = `Write a brief, friendly review note for an administrator checking an OCR scan of a research paper.

The detected section headings are compared with ${comparedPapers} archived papers. Do not claim the manuscript violates a formal rule or is invalid. Explain only the supplied comparison and ask the reviewer to verify the scan because OCR can miss headings.

Detected in this scan: ${candidateSections.join(", ") || "none"}
Common in the archive: ${commonSections.join(", ") || "none"}
Common headings not detected: ${missingSections.join(", ") || "none"}
Headings detected that are uncommon in the archive: ${unusualSections.join(", ") || "none"}

Return one or two short sentences. Explicitly say the format differs from the archived papers and name the most relevant detected difference. Do not invent sections.`;

    const response = await ai.generate({
      model: googleAI.model("gemini-3.8-flash"),
      prompt,
      output: { schema: formatReviewSchema },
    });

    return { message: String(response.output?.message || "").trim() };
  }
);
