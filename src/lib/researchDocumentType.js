export const DOCUMENT_CONFIDENCE = { high: 0.9, medium: 0.7, rejectMismatch: 0.5 };

const EXPECTED_DOCUMENT_TYPE = {
  manuscript: "Full Research Manuscript",
  ieee: "IEEE Short Paper",
  acm: "ACM Style Paper",
  apa: "APA Style Paper",
};

function countMatches(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function getExpectedDocumentType(slot) {
  return EXPECTED_DOCUMENT_TYPE[slot] || "ZIP source-code archive";
}

export function getDocumentTypeMismatchError(detection, slot) {
  if (!detection?.type || detection.type === getExpectedDocumentType(slot)) return null;
  if ((Number(detection.confidence) || 0) < DOCUMENT_CONFIDENCE.rejectMismatch) return null;
  return `This file appears to be a ${detection.type} (${Math.round(detection.confidence * 100)}% confidence). The ${slot === "manuscript" ? "Manuscript" : slot.toUpperCase()} field requires ${getExpectedDocumentType(slot)}.`;
}

// Content-based signals are intentionally conservative. A score is a calibrated
// evidence band, not an AI probability or a claim of certainty.
export function classifyResearchDocument(documentText = "") {
  const text = String(documentText).toLowerCase().replace(/\s+/g, " ");
  const ieeeSignals = countMatches(text, [/ieee\s+(?:conference|transactions|journal|proceedings)/, /ieeetran/, /index terms\s*—?\s*|index terms:/, /\b978[-–]\d{1,5}[-–]/]);
  const acmSignals = countMatches(text, [/acm reference format/, /ccs concepts/, /acm computing classification/, /\b10\.1145\//, /permission to make digital or hard copies/]);
  const apaSignals = countMatches(text, [/\bapa(?:\s+7(?:th)?\s+edition)?\b/, /\(\w[\w'’-]+(?:\s+et al\.)?,?\s+\d{4}[a-z]?\)/, /references\s+(?:\(apa|style\))/]);

  const signals = [
    { type: "IEEE Short Paper", count: ieeeSignals },
    { type: "ACM Style Paper", count: acmSignals },
    { type: "APA Style Paper", count: apaSignals },
  ].sort((left, right) => right.count - left.count);
  if (signals[0].count >= 2 && signals[0].count > signals[1].count) {
    return { type: signals[0].type, confidence: signals[0].count >= 3 ? 0.94 : 0.9, evidence: signals[0].count };
  }

  const sections = [
    /\babstract\b/, /\bintroduction\b/, /\b(?:methodology|methods)\b/,
    /\b(?:results|findings)\b/, /\b(?:discussion|analysis)\b/,
    /\b(?:conclusion|conclusions)\b/, /\breferences\b|\bbibliography\b/,
  ];
  const sectionCount = countMatches(text, sections);
  const longForm = text.length >= 18000;
  const substantial = text.length >= 9000;
  if (sectionCount >= 6 && longForm) return { type: "Full Research Manuscript", confidence: 0.94, evidence: sectionCount };
  if (sectionCount >= 5 && substantial) return { type: "Full Research Manuscript", confidence: 0.88, evidence: sectionCount };
  if (sectionCount >= 4 && substantial) return { type: "Full Research Manuscript", confidence: 0.76, evidence: sectionCount };

  if (signals[0].count > 0 && signals[0].count >= signals[1].count) {
    return { type: signals[0].type, confidence: signals[0].count === 1 ? 0.68 : 0.72, evidence: signals[0].count };
  }
  if (sectionCount >= 3) return { type: "Full Research Manuscript", confidence: 0.68, evidence: sectionCount };
  return { type: "Unknown / Cannot Determine", confidence: 0.45, evidence: sectionCount };
}

export function getDocumentConfidenceLabel(confidence) {
  if (confidence >= DOCUMENT_CONFIDENCE.high) return "High confidence";
  if (confidence >= DOCUMENT_CONFIDENCE.medium) return "Medium confidence";
  return "Low confidence";
}
