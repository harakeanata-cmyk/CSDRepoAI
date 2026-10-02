import test from "node:test";
import assert from "node:assert/strict";
import { classifyResearchDocument, getDocumentConfidenceLabel, getExpectedDocumentType } from "./researchDocumentType.js";

test("recognizes strong IEEE and ACM content indicators", () => {
  assert.deepEqual(classifyResearchDocument("IEEE conference proceedings. Index Terms: research. ISBN 978-1-2345"), {
    type: "IEEE Short Paper", confidence: 0.94, evidence: 3,
  });
  assert.equal(classifyResearchDocument("ACM Reference Format. CCS Concepts. DOI 10.1145/123").type, "ACM Style Paper");
});

test("recognizes a substantial full manuscript from extracted structure", () => {
  const text = `${"research body ".repeat(1400)} Abstract Introduction Methodology Results Discussion Conclusion References`;
  assert.equal(classifyResearchDocument(text).type, "Full Research Manuscript");
  assert.equal(classifyResearchDocument(text).confidence, 0.94);
});

test("keeps uncertain documents low-confidence and maps expected slot types", () => {
  assert.equal(classifyResearchDocument("A short title and unrelated text").type, "Unknown / Cannot Determine");
  assert.equal(getDocumentConfidenceLabel(0.68), "Low confidence");
  assert.equal(getDocumentConfidenceLabel(0.76), "Medium confidence");
  assert.equal(getDocumentConfidenceLabel(0.94), "High confidence");
  assert.equal(getExpectedDocumentType("ieee"), "IEEE Short Paper");
  assert.equal(getExpectedDocumentType("sourceCode"), "ZIP source-code archive");
});
