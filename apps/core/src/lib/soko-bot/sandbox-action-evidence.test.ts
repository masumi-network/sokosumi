import { projectSokoBotWebEvidence } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { sandboxActionEvidence } from "./sandbox-action-evidence";

describe("sandboxActionEvidence", () => {
  it("stores the same structured view the model received without double redaction", () => {
    const view = projectSokoBotWebEvidence(
      {
        results: [
          { text: "Public price EUR24." },
          { api_key: "synthetic-test-secret-only" },
        ],
      },
      ["https://example.com/pricing"],
    );
    const saved = sandboxActionEvidence({
      name: "web_search",
      output: JSON.stringify(view),
      sources: view.sources,
    });
    expect(saved.output).toEqual(view);
    expect(JSON.stringify(saved)).not.toContain("synthetic-test-secret-only");
    expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThanOrEqual(
      16_384,
    );
  });

  it("keeps the bounded redacted preview stable across persistence", () => {
    const view = projectSokoBotWebEvidence({
      api_key: "synthetic-test-secret-only",
      text: "a".repeat(20_000),
    });
    expect(
      sandboxActionEvidence({ name: "web_fetch", output: JSON.stringify(view) })
        .output,
    ).toEqual(view);
  });

  it("preserves the same depth boundary as the model instead of counting envelope nesting", () => {
    let nested: unknown = { price: "EUR24" };
    for (let depth = 0; depth < 7; depth++) nested = { nested };
    const view = projectSokoBotWebEvidence(nested);
    expect(JSON.stringify(view)).toContain("EUR24");
    expect(
      sandboxActionEvidence({ name: "web_fetch", output: JSON.stringify(view) })
        .output,
    ).toEqual(view);
  });

  it("marks legacy clipped or redacted web output as incomplete", () => {
    expect(
      sandboxActionEvidence({ name: "web_fetch", output: '{"text":"cut' }),
    ).toMatchObject({
      output: '{"text":"cut',
      evidenceVisibility: { complete: false, reasons: ["legacy_web_output"] },
    });
  });

  it("does not change non-web local-tool output contracts", () => {
    expect(
      sandboxActionEvidence({ name: "bash", output: '{"stdout":"done"}' }),
    ).toEqual({
      output: '{"stdout":"done"}',
      sources: [],
    });
  });
});
