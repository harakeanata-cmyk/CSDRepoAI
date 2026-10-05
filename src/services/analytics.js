import { supabase } from "../lib/supabaseClient";
import { normalizeProgram } from "../lib/programs";

/**
 * Research Analytics Dashboard Module
 * Pulls raw rows and aggregates client-side, which is fine at capstone-repo
 * scale (hundreds to a few thousand papers). For a much larger dataset you'd
 * move these aggregations into Postgres views/RPC functions instead.
 */
export async function getAnalyticsSummary() {
  const pageSize = 1000;
  const loadPapers = async (includeActive) => {
    const papers = [];
    for (let from = 0; ; from += pageSize) {
      const fields = "id, title, status, academic_year, sdg_tags, program, keywords, view_count, download_count, created_at";
      const { data, error } = await supabase
        .from("research_papers")
        .select(includeActive ? `${fields}, is_active` : fields)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      papers.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return includeActive ? papers.filter((paper) => paper.is_active !== false) : papers;
  };

  let papers;
  try {
    papers = await loadPapers(true);
  } catch (error) {
    if (!isMissingResearchActiveColumn(error)) throw error;
    papers = await loadPapers(false);
  }

  return summarizeAnalytics(papers.map((paper) => ({
    ...paper,
    program: normalizeProgram(paper.program),
  })));
}

function isMissingResearchActiveColumn(error) {
  return error?.code === "42703"
    || error?.code === "PGRST204"
    || /is_active.*(column|schema cache)|column.*is_active/i.test(error?.message || "");
}

export function summarizeAnalytics(papers = []) {
  papers = papers.filter((paper) => paper.is_active !== false);
  const totalSubmissions = papers.length;
  const approved = papers.filter((p) => p.status === "approved").length;
  const pending = papers.filter((p) => ["pending", "under_review", "student_editing"].includes(p.status)).length;
  const rejected = papers.filter((p) => p.status === "rejected").length;

  // (a) Published (approved) per year + (b) Total submitted per school year,
  // combined into one grouped-bar dataset
  const years = Array.from(new Set(papers.map((p) => p.academic_year || "Unknown"))).sort();
  const byYear = years.map((year) => ({
    name: year,
    total: papers.filter((p) => (p.academic_year || "Unknown") === year).length,
    published: papers.filter((p) => (p.academic_year || "Unknown") === year && p.status === "approved").length,
  }));

  // (c) Research per program
  const byProgram = toChartArray(groupCount(papers, (p) => p.program || "Unknown"));
  const titlesByProgram = groupTitlesByProgram(papers);

  // (d) Most viewed / most downloaded
  const mostViewed = [...papers]
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 5)
    .filter((p) => (p.view_count || 0) > 0);
  const mostDownloaded = [...papers]
    .sort((a, b) => (b.download_count || 0) - (a.download_count || 0))
    .slice(0, 5)
    .filter((p) => (p.download_count || 0) > 0);

  // (e) Research by keyword
  const keywordCounts = {};
  papers.forEach((p) => {
    (p.keywords || []).forEach((k) => {
      const key = k.trim().toLowerCase();
      if (!key) return;
      keywordCounts[key] = (keywordCounts[key] || 0) + 1;
    });
  });
  const byKeyword = Object.entries(keywordCounts)
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // (g) SDG alignment
  const sdgCounts = {};
  papers.forEach((p) => {
    (p.sdg_tags || []).forEach((sdg) => {
      sdgCounts[sdg] = (sdgCounts[sdg] || 0) + 1;
    });
  });

  return {
    totalSubmissions,
    approved,
    pending,
    rejected,
    byYear,
    byProgram,
    titlesByProgram,
    mostViewed,
    mostDownloaded,
    byKeyword,
    sdgCounts: Object.entries(sdgCounts)
      .map(([sdg, count]) => ({ sdg: `SDG ${sdg}`, count }))
      .sort((a, b) => b.count - a.count),
    rawPapers: papers,
  };
}

/** (f) User Analytics: counts by role and account status */
export async function getUserAnalytics() {
  const { data: users, error } = await supabase.from("profiles").select("role, is_active, created_at");
  if (error) throw error;

  const byRole = { student: 0, faculty: 0, admin: 0 };
  let active = 0;
  let inactive = 0;
  users.forEach((u) => {
    byRole[u.role] = (byRole[u.role] || 0) + 1;
    if (u.is_active) active += 1;
    else inactive += 1;
  });

  return {
    total: users.length,
    byRole,
    active,
    inactive,
  };
}

function groupCount(rows, keyFn) {
  const map = {};
  rows.forEach((r) => {
    const k = keyFn(r);
    map[k] = (map[k] || 0) + 1;
  });
  return map;
}

function toChartArray(map) {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

function groupTitlesByProgram(papers) {
  const grouped = {};
  papers
    .filter((paper) => paper.status !== "rejected")
    .forEach((paper) => {
      const program = paper.program || "Unknown";
      if (!grouped[program]) grouped[program] = [];
      grouped[program].push({ id: paper.id, title: paper.title, status: paper.status });
    });

  return Object.entries(grouped)
    .map(([program, titles]) => ({
      program,
      titles: titles.sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.program.localeCompare(b.program));
}

/** Research Analytics Dashboard Module: export a CSV report of submissions */
export function exportSummaryCsv(papers) {
  const header = ["Title", "Status", "Academic Year", "Program", "SDG Tags", "Views", "Downloads", "Date Submitted"];
  const rows = papers.map((p) => [
    csvSafe(p.title),
    p.status,
    p.academic_year || "",
    p.program || "",
    (p.sdg_tags || []).join("; "),
    p.view_count || 0,
    p.download_count || 0,
    new Date(p.created_at).toLocaleDateString(),
  ]);

  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `csdrepoai-research-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvSafe(value) {
  const str = String(value ?? "");
  return str.includes(",") ? `"${str.replace(/"/g, '""')}"` : str;
}
