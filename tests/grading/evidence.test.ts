import { test } from "node:test";
import assert from "node:assert/strict";
import { locateQuote, verifyEvidence } from "../../supabase/functions/_shared/grading/evidence.ts";
import type { Turn } from "../../supabase/functions/_shared/grading/types.ts";

const turns: Turn[] = [
  { messageId: "m1", content: "מס פחמן קובע מחיר קבוע לטון פליטה, והכמות נקבעת בשוק.", createdAt: "2026-01-01T00:00:00Z" },
  { messageId: "m2", content: "A carbon tax fixes the price per ton and lets the market set the quantity; cap and trade does the opposite.", createdAt: "2026-01-01T00:01:00Z" },
];

test("a verbatim quote verifies with the message id and character offsets", () => {
  const [v] = verifyEvidence([{ quote: "fixes the price per ton and lets the market set the quantity", criterion: "accuracy" }], turns);
  assert.equal(v.verified, true);
  assert.equal(v.messageId, "m2");
  assert.equal(v.matchRatio, 1);
  assert.equal(turns[1].content.slice(v.start!, v.end!), "fixes the price per ton and lets the market set the quantity");
});

test("Hebrew quotes verify through the normaliser (final letters, clitics, punctuation)", () => {
  const [v] = verifyEvidence([{ quote: "קובע מחיר קבוע לטון פליטה והכמות נקבעת בשוק", criterion: "explanation" }], turns);
  assert.equal(v.verified, true);
  assert.equal(v.messageId, "m1");
});

test("a lightly trimmed quote still verifies; a paraphrase or an invented sentence does not", () => {
  const trimmed = locateQuote("carbon tax fixes the price per ton and lets the market set quantity", turns);
  assert.ok(trimmed.ratio >= 0.8, `ratio ${trimmed.ratio}`);
  const paraphrase = locateQuote("the tax sets a fixed price while the market chooses how much to emit", turns);
  assert.ok(paraphrase.ratio < 0.8, `ratio ${paraphrase.ratio}`);
  const invented = verifyEvidence([{ quote: "I used a regression on household survey data from 2019 to 2023", criterion: "process" }], turns);
  assert.equal(invented[0].verified, false);
  assert.equal(invented[0].messageId, null);
});

test("quotes that are too short to be evidence never verify; host text is not student evidence", () => {
  const [short] = verifyEvidence([{ quote: "carbon tax", criterion: "accuracy" }], turns);
  assert.equal(short.verified, false);
  assert.equal(short.matchRatio, 0);
  const [host] = verifyEvidence([{ quote: "Tell me briefly about your work and why you chose this topic", criterion: "relevance" }], turns);
  assert.equal(host.verified, false);
});

test("empty quotes and empty turns are handled", () => {
  assert.deepEqual(verifyEvidence([], turns), []);
  const [v] = verifyEvidence([{ quote: "   ", criterion: "accuracy" }], turns);
  assert.equal(v.verified, false);
  const [w] = verifyEvidence([{ quote: "fixes the price per ton", criterion: "accuracy" }], []);
  assert.equal(w.verified, false);
});
