import { describe, expect, it } from "vitest";
import {
  projectSokoBotWebEvidence,
  SOKO_BOT_WEB_EVIDENCE_MAX_BYTES,
} from "../web-evidence.js";

describe("web evidence projection", () => {
  it("redacts a nested secret without discarding unrelated public source entries", () => {
    const result = projectSokoBotWebEvidence(
      {
        results: [
          { text: "Starter costs EUR24/month." },
          {
            api_key: "synthetic-test-secret-only",
            text: "Ordinary source prose.",
          },
        ],
      },
      ["https://example.com/pricing"],
    );
    expect(result.data).toEqual({
      results: [
        { text: "Starter costs EUR24/month." },
        {
          api_key: "[Sensitive value removed]",
          text: "Ordinary source prose.",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-test-secret-only");
    expect(result.evidence).toMatchObject({ redacted: true, truncated: false });
  });

  it("keeps whole-value redaction for a source string containing a secret", () => {
    const result = projectSokoBotWebEvidence({
      text: "Price EUR24; password=synthetic-test-secret-only",
    });
    expect(result.data).toEqual({ text: "[Sensitive value removed]" });
    expect(result.evidence.redacted).toBe(true);
  });

  it("does not expose a trailing price that the bounded audit cannot store", () => {
    const result = projectSokoBotWebEvidence({
      text: `${"a".repeat(9000)} Price EUR24/month.`,
    });
    expect(result.evidence.truncated).toBe(true);
    const serialized = JSON.stringify(result);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      SOKO_BOT_WEB_EVIDENCE_MAX_BYTES,
    );
    expect(serialized).not.toContain("EUR24");
    expect(JSON.parse(serialized)).toEqual(result);
  });

  it("bounds UTF-8 and JSON escaping while retaining valid JSON", () => {
    const result = projectSokoBotWebEvidence({
      text: `${'"\\😀'.repeat(6000)}`,
    });
    expect(
      new TextEncoder().encode(JSON.stringify(result)).byteLength,
    ).toBeLessThanOrEqual(SOKO_BOT_WEB_EVIDENCE_MAX_BYTES);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(projectSokoBotWebEvidence(result)).toEqual(result);
  });

  it("omits credential-bearing source URLs and bounds the source list", () => {
    const result = projectSokoBotWebEvidence({}, [
      "https://user:synthetic-test-secret-only@example.com/",
      ...Array.from(
        { length: 100 },
        (_, index) => `https://example.com/${index}/${"a".repeat(100)}`,
      ),
    ]);
    expect(
      result.sources.some((url) => url.includes("synthetic-test-secret-only")),
    ).toBe(false);
    expect(result.evidence).toMatchObject({ redacted: true, truncated: true });
    expect(
      new TextEncoder().encode(JSON.stringify(result)).byteLength,
    ).toBeLessThanOrEqual(SOKO_BOT_WEB_EVIDENCE_MAX_BYTES);
  });

  it("keeps source URLs storable as JSONB without NUL or lone surrogates", () => {
    const result = projectSokoBotWebEvidence({}, [
      "https://example.com/a\u0000b\ud800",
    ]);
    expect(result.sources).toEqual(["https://example.com/ab\ufffd"]);
    expect(JSON.stringify(result)).not.toContain("\\u0000");
    expect(JSON.stringify(result)).not.toContain("\\ud800");
  });
});
