# CSDRepoAI Genkit Semantic Search Server

Adds Google Genkit-powered semantic search on top of the existing repository.
The React app already knows how to call this (see `src/services/search.js`)
and falls back to Postgres full-text search automatically if this server
isn't running — so this is an additive upgrade, not a required dependency.

## What it does

- Embeds each research paper's title, abstract, keywords, authors, and
  program using Google's `gemini-embedding-001` model (768-dim vectors).
- Stores embeddings in a `vector(768)` column on `research_papers` (added by
  the schema migration below).
- Exposes two HTTP endpoints, wired up via Genkit flows:
  - `POST /search` — embeds the query and finds the closest papers by cosine
    similarity (via the `match_research_papers` Postgres function).
  - `POST /embed` — embeds one paper by id. Called automatically by the
    frontend right after a new submission.
  - `GET /reindex` — Vercel Cron recovery pass for approved archive papers
    that still lack an embedding. It requires `CRON_SECRET`.
- `npm run reindex` — backfills embeddings for any paper that doesn't have
  one yet (e.g. everything submitted before this was added).

## 1. Apply the database migration

Run the updated `supabase/schema.sql` in the Supabase SQL Editor (it's
additive — safe to re-run). It:
- enables the `vector` extension (pgvector, available on all Supabase
  projects),
- adds an `embedding vector(768)` column to `research_papers`,
- adds an `ivfflat` index for fast approximate nearest-neighbor search,
- adds a `match_research_papers(...)` SQL function the search flow calls.

## 2. Configure this server

```bash
cd genkit-server
cp .env.example .env
```

Fill in `.env`:
- `GOOGLE_GENAI_API_KEY` — get one free at https://aistudio.google.com/app/apikey
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Project Settings > API in
  your Supabase dashboard. **Use the service role key here**, not the anon
  key — this server needs to write embeddings and query across all papers.

## 3. Install and run

```bash
npm install
npm run dev        # runs on http://localhost:8787 by default
```

You can also launch it with the Genkit Developer UI for inspecting flow
traces and testing prompts interactively:

```bash
npm run genkit:ui
```

## 4. Point the frontend at it

In the project root `.env`:

```
VITE_GENKIT_SEARCH_URL=http://localhost:8787/search
VITE_GENKIT_EMBED_URL=http://localhost:8787/embed
VITE_GENKIT_METADATA_URL=http://localhost:8787/extract-metadata
```

Restart the Vite dev server after changing `.env`. From here on:
- New submissions are embedded automatically in the background.
- The Search page (`src/pages/Search.jsx`) will use semantic matches first,
  falling back to keyword search if this server is unreachable.

## 5. Backfill existing papers

Any papers submitted before this was set up won't have an embedding yet:

```bash
npm run reindex
```

## Deploying

This is a plain Express app — deploy it anywhere that runs Node (Cloud Run,
Render, Fly.io, a small VM, etc.). Keep the service role key server-side
only; never expose it to the frontend. The root Vercel project also schedules
`/reindex` daily to recover papers whose immediate embedding request failed.
Set `CRON_SECRET` in the Vercel project environment variables to a random
value of at least 16 characters so Vercel can authenticate that request.
