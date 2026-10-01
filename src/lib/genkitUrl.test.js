import test from "node:test";
import assert from "node:assert/strict";
import { toGenkitEndpoint } from "./genkitUrl.js";

test("uses the configured separate Vercel semantic project", () => {
  assert.equal(
    toGenkitEndpoint("https://csd-repo-ai-semantic.vercel.app/search", "search"),
    "https://csd-repo-ai-semantic.vercel.app/search",
  );
});

test("derives other Genkit endpoints from the configured project", () => {
  assert.equal(
    toGenkitEndpoint("https://csd-repo-ai-semantic.vercel.app/search", "embed"),
    "https://csd-repo-ai-semantic.vercel.app/embed",
  );
});
