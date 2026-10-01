import test from "node:test";
import assert from "node:assert/strict";
import { getSearchMatch, rankSearchResults } from "./searchRanking.js";

test("ranks exact title matches above incidental abstract overlap", () => {
  const results = rankSearchResults("barangay disaster response", [
    { id: "abstract", title: "Community Preparedness", abstract: "A barangay system for disaster response" },
    { id: "title", title: "Barangay Disaster Response System", abstract: "A mobile alert platform" },
  ], []);

  assert.equal(results[0].id, "title");
  assert.equal(results[0].matchConfidence, 95);
  assert.ok(results.every(({ matchConfidence }) => matchConfidence < 100));
});

test("does not assign perfect confidence from a single common token", () => {
  const match = getSearchMatch("mobile", {
    title: "Community Health Information Platform",
    abstract: "A mobile interface is available for users.",
  });

  assert.ok(match.confidence < 60);
  assert.equal(match.relevant, true);
});

test("filters weak semantic-only matches but keeps strong semantic matches", () => {
  const results = rankSearchResults("crop disease detection", [], [
    { id: "weak", title: "Student Attendance System", similarity: 0.48 },
    { id: "strong", title: "Plant Leaf Disease Recognition", similarity: 0.68 },
  ]);

  assert.deepEqual(results.map(({ id }) => id), ["strong"]);
});

test("rejects an incidental single-term match for a multiword query", () => {
  const results = rankSearchResults("mobile application", [], [
    { id: "incidental", title: "Transformer Translation Model", abstract: "A mobile tool for field researchers", similarity: 0.5 },
    { id: "related", title: "Mobile Housing Application", similarity: 0.54 },
  ]);

  assert.deepEqual(results.map(({ id }) => id), ["related"]);
});

test("combines text and semantic copies without duplicating a paper", () => {
  const results = rankSearchResults("flood monitoring", [
    { id: "paper", title: "Flood Monitoring System", similarity: 0 },
  ], [
    { id: "paper", title: "Flood Monitoring System", similarity: 0.72 },
  ]);

  assert.equal(results.length, 1);
  assert.ok(results[0].matchConfidence >= 90);
});
