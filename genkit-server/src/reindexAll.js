import "dotenv/config";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { embedPaperFlow } from "./flows/embedPaper.js";

/** Run with: npm run reindex
 *  Add `-- --force` to replace the existing embedding on every paper. */
async function main() {
  const force = process.argv.includes("--force");
  const papers = [];
  const pageSize = 500;
  let lastId = "";

  while (true) {
    let query = supabaseAdmin
      .from("research_papers")
      .select("id, title")
      .order("id")
      .limit(pageSize);
    if (!force) query = query.is("embedding", null);
    if (lastId) query = query.gt("id", lastId);

    const { data: page, error } = await query;
    if (error) {
      console.error("Failed to load papers:", error.message);
      process.exit(1);
    }
    if (!page.length) break;
    papers.push(...page);
    lastId = page[page.length - 1].id;
    if (page.length < pageSize) break;
  }

  if (!papers.length) {
    console.log("Nothing to reindex — every paper already has an embedding.");
    return;
  }

  console.log(`${force ? "Re-embedding" : "Embedding missing vectors for"} ${papers.length} paper(s)...`);

  let done = 0;
  let failed = 0;
  for (const [index, paper] of papers.entries()) {
    try {
      await embedPaperFlow({ paperId: paper.id, force });
      done += 1;
      console.log(`  [${index + 1}/${papers.length}] embedded`);
    } catch (err) {
      failed += 1;
      console.error(`  [${index + 1}/${papers.length}] failed:`, err.message);
    }
  }

  console.log(`Done. Embedded ${done}/${papers.length} paper(s); ${failed} failed.`);
}

main();
