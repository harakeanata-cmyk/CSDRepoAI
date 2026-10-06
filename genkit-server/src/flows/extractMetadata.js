import { z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../genkit.config.js";

const outputSchema = z.object({
  title: z.string(),
  authors: z.array(z.string()),
  adviser: z.string(),
  panelMembers: z.array(z.string()),
  abstract: z.string(),
  keywords: z.array(z.string()),
});

export const extractMetadataFlow = ai.defineFlow(
  {
    name: "extractMetadata",
    inputSchema: z.object({ documentText: z.string().min(1) }),
    outputSchema,
  },
  async ({ documentText }) => {
    const safeDocumentText = buildMetadataContext(documentText);
    const prompt = `You are extracting metadata from the supplied research document text for a Philippine university thesis or capstone document.

The OCR may contain spelling mistakes, misplaced line breaks, duplicated lines, and sections that are out of visual order. The OCR is organized below into labeled sections: the document start, an approval-sheet section when found, and an abstract-plus-keywords section when found. These labels are instructions only and must never appear in the extracted output.

These documents follow a consistent structural convention that does NOT use explicit field labels for most fields. Identify fields by their position and role, not by searching for labels such as "Title:" or "Author:".

Structural conventions to expect:

TITLE PAGE (usually page 1):
- The title appears as the main title block near the beginning of the document and often wraps across 2-4 consecutive lines due to page width — this is one continuous title, not separate lines or separate titles. You MUST join every line of this title block into a single string, in reading order, separated by a single space, before the author names begin. Do NOT return only the last line or a fragment of the title.
- Ignore physical-copy labels, scanning labels, cover labels, or repository labels such as "HARDBOUND", "HARDBOUND BAYAD", "HARD BOUND", or similar text. These are NOT part of the research title.
- If a line contains only "HARDBOUND", "HARDBOUND BAYAD", or a similar physical-copy label, skip it and continue looking for the actual research title.
- The actual title may begin with the project or system name followed by a colon, such as "bayad: A Mobile-Based System...".
- Immediately below the title, one or more author names appear, each typically on its own line, with NO "By:" or "Author(s):" prefix.
- Some older cover pages place the authors later under a "Presented by:" caption, after the adviser and panel names. In that layout, take every researcher name under "Presented by" as an author and do not mistake the adviser or panel members above it for authors.
- Below the authors, the university name and degree program usually appear.
- An adviser's name sometimes appears near the bottom of this page, with the role caption "Adviser" or "Thesis Adviser" immediately below it. Panel reviewers may also appear on the cover, with "Panel Member" captions below their names. Extract names paired with these role captions even when there is no separate Approval Sheet.
- If a separate Approval Sheet exists, it remains the authoritative source for adviser and panel identities; otherwise use the role captions on the title page.
- The title MUST be drawn only from the DOCUMENT START section. Never use text from the approval-sheet or abstract sections as the title.
- For DOCX files with no page separators, identify the title page by its sequence: full title block first, researcher names below it, then university/program/submission text. Stop the title before the first author or institution line, even when the title itself spans several paragraphs.
- Never mistake a body-text sentence about weeks, timelines, ethics review, data collection procedures, methodology, or a data collection plan for the title. If the top of the document appears procedural, keep looking earlier in the DOCUMENT START section; if no credible title-page title is present, return an empty title instead of substituting unrelated body text.

APPROVAL SHEET (usually page 2, titled "Approval Sheet"):
- Extract panel names only when the OCR text visibly connects the name to a panel role or panel-members section. Copy each name as printed; do not correct, complete, or infer an unclear third name. Return fewer than three names when the source does not clearly support all three.
- This page lists names followed immediately below (or beside) each name by a role caption, not a label before the name. Use fuzzy OCR-tolerant matching for captions such as "Thesis Adviser", "Thesis Advisor", "Thesis Advis0r", or similar spacing/spelling variants. The name attached to that caption is the adviser, and this section is authoritative over the title page.
- Similarly, a name associated with "Panel Chair", "Panel Chairperson", "Chairperson", "Chairman", "Panel Member", or "Panel of Examiners" identifies a panel member. Approval sheets may place names and role captions in separate columns or put the caption before the name; pair each name with its nearest panel role. The chair is included in the three-person panelMembers list — do NOT confuse the chair with the adviser, authors, dean, or other signatories.

ABSTRACT:
- Usually appears on its own page headed by the standalone word "Abstract" (no colon). The abstract text follows as one or more paragraphs.
- Immediately after the abstract paragraph(s), a line beginning with "Keywords:" lists the keywords, typically separated by semicolons. Also accept OCR variants such as "Key words", a same-line label and list, and italic- or asterisk-wrapped labels such as "*Keywords:*".
- If the OCR repeats or overlaps sentences or paragraphs in the abstract, deduplicate them and return one coherent abstract.

Given the document text below, extract exactly these fields and return ONLY valid JSON matching this shape:
{
  "title": string,
  "authors": string[],
  "adviser": string,
  "panelMembers": string[],
  "abstract": string,
  "keywords": string[]
}

Rules:
- "adviser" must come from the Approval Sheet's "Thesis Adviser" caption if present anywhere in the text — do not guess from the title page alone if the Approval Sheet is available.
- "title" must be the FULL title, reconstructed by concatenating all wrapped lines of the title block into one continuous string (joined with spaces, no line breaks). Never output a partial title consisting of only the final line — check that your extracted title captures the complete first sentence/phrase before the author names appear on the title page.
- Include the Panel Chair in "panelMembers": the chair counts as one of the three panel members, not as a separate fourth role. Treat captions such as "Panel Chairperson", "Chairperson", or "Chairman" as chair roles too. Extract the chair and the other two panel members when all three are shown. A name may appear immediately before or after its role caption, in a separate column beside the caption, or under a "Panelists"/"Panel Members"/"Panel of Examiners" heading. Pair names with the nearest panel-role caption and return each person once. Exclude the adviser, authors, dean, secretary, and other signatories. Never invent a missing name.
- Do not include panel chair or panel members in "authors" or "adviser" — they are separate roles.
- "authors" must include ALL names credited as the researchers/writers of the thesis on the title page, not just the first name — not the adviser, panel, or dean.
- If fields or names are concatenated with only a plain space and no delimiter, split them using the expected structural patterns. For example, split "Chrissandra Marchelle L. Bautista Crislyn Joy D. Delgado" into the two authors "Chrissandra Marchelle L. Bautista" and "Crislyn Joy D. Delgado".
- If a field cannot be confidently identified, return an empty string (or empty array for authors/keywords) rather than guessing or using a filename.
- Extract only information supported by the supplied document context. Never invent, autocomplete, or substitute metadata from general knowledge.
- Split "keywords" on semicolons or commas into an array of individual terms.
- Ignore headers, footers, page numbers, repeated boilerplate, and running text that is not part of the document metadata.
- Output ONLY valid JSON with no commentary.

Document text:
${safeDocumentText}`;

    let response;
    try {
      response = await ai.generate({
        model: googleAI.model("gemini-3.8-flash"),
        prompt,
        output: { schema: outputSchema },
      });
    } catch (error) {
      console.error("[genkit] metadata model failed; returning empty fields for local fallback:", error);
      return { title: "", authors: [], adviser: "", panelMembers: [], abstract: "", keywords: [] };
    }

    let parsed = response.output;
    if (!parsed && typeof response.text === "string") {
      try {
        parsed = JSON.parse(response.text);
      } catch (error) {
        console.error("[genkit] metadata model returned invalid JSON; using local fallback:", error);
      }
    }

    if (!parsed) {
      return { title: "", authors: [], adviser: "", panelMembers: [], abstract: "", keywords: [] };
    }

    return {
      title: String(parsed.title || "").trim(),
      authors: Array.isArray(parsed.authors)
        ? parsed.authors.map((author) => String(author).trim()).filter(Boolean)
        : [],
      adviser: String(parsed.adviser || "").trim(),
      panelMembers: Array.isArray(parsed.panelMembers)
        ? parsed.panelMembers.map((member) => String(member).trim()).filter(Boolean)
        : [],
      abstract: String(parsed.abstract || "").trim(),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 8)
        : [],
    };
  }
);

export function buildMetadataContext(documentText) {
  const text = String(documentText || "");
  const sections = [`[DOCUMENT START]\n${text.slice(0, 12000)}`];
  appendContextWindows(sections, text, "APPROVAL SHEET SECTION", /approval\s+sheet|thesis\s+advis(?:e|o)r/gi, 500, 5000, 3);
  appendContextWindows(sections, text, "PANEL MEMBERS SECTION", /panel\s*(?:chair(?:\s*(?:person|man|woman))?|members?|ists?|of\s+examiners)|(?:chair(?:person|man|woman)?|member)\s+of\s+(?:the\s+)?panel|(?:chairperson|chairman|chairwoman)\b|composition\s+of\s+(?:the\s+)?panel|board\s+of\s+examiners/gi, 500, 1800, 8);
  appendContextWindows(sections, text, "ABSTRACT + KEYWORDS SECTION", /(?:^|\n)\s*abstrac?t\b/gi, 0, 7000, 3);
  appendContextWindows(sections, text, "KEYWORDS SECTION", /(?:^|\n)\s*\*?\s*key\s*words?\s*\*?\s*:/gi, 0, 2500, 3);

  return [...new Set(sections)].join("\n\n").slice(0, 30000);
}

function appendContextWindows(sections, text, label, pattern, before, after, limit) {
  let match;
  let count = 0;
  while (count < limit && (match = pattern.exec(text)) !== null) {
    const start = Math.max(0, match.index - before);
    const end = Math.min(text.length, match.index + match[0].length + after);
    sections.push(`[${label}]\n${text.slice(start, end)}`);
    count += 1;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
}

export async function extractMetadata(documentText) {
  return extractMetadataFlow({ documentText });
}
