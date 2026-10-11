# CSDRepoAI

Working codebase for the CSDRepoAI capstone system: an AI-assisted research
repository for the Computer Studies Department of NDMU. Built with
React.js + Supabase + PaddleOCR.js, matching the OCR engine used by the app.

## Design

The UI follows an "institutional archive" direction rather than a generic
SaaS look: deep navy + brass palette, a serif display face (Source Serif 4)
paired with Inter for UI text, tabular tabular-figure stats, and a sidebar
styled like a library catalog rather than a default dashboard template. All
tokens live in `src/index.css`; shared components are in `src/components/ui.jsx`.

## What's implemented (mapped to the paper's modules)

| Module (from the paper)                  | Where it lives                              |
|-------------------------------------------|----------------------------------------------|
| Login Module                              | `src/pages/Login.jsx`, `src/context/AuthContext.jsx` |
| Admin Dashboard Module                    | `src/pages/admin/Dashboard.jsx`               |
| User Management Module                    | `src/pages/admin/UserManagement.jsx` — view, assign roles, activate/deactivate, **delete** |
| Research Submission Module                | `src/pages/student/Submit.jsx` — manuscript + source code + IEEE paper upload |
| Research Archive and Repository Module    | `src/pages/Archive.jsx` — **shared across Student, Faculty, and Admin** (was admin-only before), filterable by year/title/author/keyword |
| OCR Digitization Module                   | `src/pages/admin/OCRScan.jsx`, `src/services/ocr.js` — PaddleOCR.js scan **plus auto-extraction of title, authors, adviser, abstract, and keywords** from the scanned text, editable before archiving |
| AI-Assisted Search and Retrieval Module   | `src/pages/Search.jsx`, `src/services/search.js` — natural-language search over title/abstract/keywords/OCR text; **also surfaces related existing studies live while a student types a submission title**, to flag possible topic duplication (`student/Submit.jsx`) |
| Submission Review and Approval Module     | `src/pages/admin/ReviewApproval.jsx`          |
| Research Analytics Dashboard Module       | `src/pages/Analytics.jsx` — year/program/SDG charts **plus a CSV report export** |
| Profile Management Module                 | `src/pages/Profile.jsx`                       |
| SDG Classification Module                 | tagging UI in `src/pages/student/Submit.jsx` (all 17 SDGs), `sdg_list` table in schema |

All three roles (Student, Faculty, Admin) have separate dashboards and
route access, enforced both client-side (`ProtectedRoute.jsx`) and at the
database level (Supabase Row Level Security policies in `supabase/schema.sql`).

### Changes made in this pass (fixing gaps vs. the paper)

1. **Research Archive is now shared** — the paper says the archive should be
   browsable by administrators, faculty, *and* students. It was admin-only
   before; it's now one shared page routed for all three roles.
2. **OCR now auto-extracts metadata** — the paper specifically says OCR
   "automatically extracts key metadata such as title, abstract, keywords,
   authors, adviser, and panel members." The scan page now runs a heuristic
   parser (`extractMetadata` in `services/ocr.js`) over the OCR text and
   pre-fills the archive form, which the admin reviews and corrects.
3. **AI search now flags possible duplicate topics** — the paper says the
   search module "suggests related studies to help users avoid repeating
   research topics." The submission form now live-searches the student's
   typed title against the archive and shows similar existing studies.
4. **User Management now supports delete**, not just deactivate, per the
   paper's description of that module.
5. **Analytics now has a CSV export**, addressing the paper's "generate
   reports" line for the Research Analytics Dashboard Module.

## 1. Set up Supabase

1. Create a free project at https://supabase.com.
2. Go to **SQL Editor > New Query**, paste the entire contents of
   `supabase/schema.sql`, and run it. This creates all tables, the
   auto-profile trigger, RLS policies, and the storage bucket.
3. Go to **Project Settings > API** and copy your **Project URL** and
   **anon public key**.

## 2. Configure the app

```bash
cp .env.example .env
```

Open `.env` and paste in your Supabase URL and anon key.

The real `.env` file is intentionally excluded from Git. For the main Vercel
deployment, add the values from `.env.example` in the Vercel project's
**Settings > Environment Variables** and redeploy. Keep
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_GENAI_API_KEY`, and `CRON_SECRET`
server-side; only the `VITE_` variables are available to browser code. The
`.vercel` folder is local Vercel project metadata created by `vercel link` or
`vercel env pull`; it does not belong in Git or in `public/`.

## 3. Run it in VS Code

```bash
npm install
npm run dev
```

Open http://localhost:5173. Click "Need an account? Sign up" to create your
first user — pick "Admin" as the role for your own test account so you can
see the review/OCR/user-management screens.

## 4. How the AI search actually works right now

`src/services/search.js` uses Postgres full-text search by default (via the
`search_vector` column in the schema) — no extra setup needed, and it
already searches OCR-extracted text too.

Real semantic search (Google Genkit + embeddings) is now included in
`/genkit-server` — a small Node service that embeds papers with Google's
gemini-embedding-001 model and matches queries via Supabase pgvector cosine
similarity. It's opt-in: set `VITE_GENKIT_SEARCH_URL` / `VITE_GENKIT_EMBED_URL`
in `.env` to turn it on (see `genkit-server/README.md` for setup); without
it, the app keeps using keyword search automatically.

## 5. Notes on OCR

`src/services/ocr.js` runs PaddleOCR.js **in a browser worker**, so there's no
separate OCR server to deploy. The PP-OCRv5 models are downloaded by the browser
when OCR is first used. Admins upload (or, on a phone, photograph
directly via camera capture) a scan of a hardbound document, text is
extracted client-side, metadata is auto-suggested, they correct any
misreads, and it's saved to the archive with the raw text stored for search.

## Project structure

```
src/
  index.css       design tokens + all component styles
  components/     Layout, ProtectedRoute, ui.jsx (shared UI kit)
  context/        AuthContext (session + role)
  services/       research.js, search.js, ocr.js, users.js, analytics.js
  pages/
    student/      Dashboard, Submit, MySubmissions
    faculty/      Dashboard
    admin/        Dashboard, UserManagement, OCRScan, ReviewApproval
    Search.jsx, Profile.jsx, Analytics.jsx, Archive.jsx   (shared across roles)
supabase/
  schema.sql      full DB schema + RLS policies + storage bucket
```


1. Create a free project at https://supabase.com.
2. Go to **SQL Editor > New Query**, paste the entire contents of
   `supabase/schema.sql`, and run it. This creates all tables, the
   auto-profile trigger, RLS policies, and the storage bucket.
3. Go to **Project Settings > API** and copy your **Project URL** and
   **anon public key**.

## 2. Configure the app

```bash
cp .env.example .env
```

Open `.env` and paste in your Supabase URL and anon key.

## 3. Run it in VS Code

```bash
npm install
npm run dev
```

Open http://localhost:5173. Click "Need an account? Sign up" to create your
first user — pick "Admin" as the role for your own test account so you can
see the review/OCR/user-management screens.

## 4. How the AI search actually works right now

`src/services/search.js` uses Postgres full-text search by default (via the
`search_vector` column in the schema) — no extra setup needed, and it
already searches OCR-extracted text too.

Real semantic search (Google Genkit + embeddings) is now included in
`/genkit-server` — a small Node service that embeds papers with Google's
gemini-embedding-001 model and matches queries via Supabase pgvector cosine
similarity. It's opt-in: set `VITE_GENKIT_SEARCH_URL` / `VITE_GENKIT_EMBED_URL`
in `.env` to turn it on (see `genkit-server/README.md` for setup); without
it, the app keeps using keyword search automatically.

## 5. Notes on OCR

`src/services/ocr.js` runs PaddleOCR.js **in a browser worker**, so there's no
separate OCR server to deploy. The PP-OCRv5 models are downloaded by the browser
when OCR is first used. Admins upload a photo/scan of a hardbound
document on the OCR Digitization page, the text is extracted client-side,
they can correct any misreads, and it gets saved to the archive with the
raw text stored for search.

## Project structure

```
src/
  components/     Layout, ProtectedRoute
  context/        AuthContext (session + role)
  services/       research.js, search.js, ocr.js, users.js, analytics.js
  pages/
    student/      Dashboard, Submit, MySubmissions
    faculty/      Dashboard
    admin/        Dashboard, UserManagement, OCRScan, ReviewApproval, Archive
    Search.jsx, Profile.jsx, Analytics.jsx   (shared across roles)
supabase/
  schema.sql      full DB schema + RLS policies + storage bucket
```
