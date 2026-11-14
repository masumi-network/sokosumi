import { projectSokoBotWebEvidence } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { judgeEvidenceVisibility } from "./soko-bot-lab-judge-evidence";

describe("judgeEvidenceVisibility", () => {
  it("recognizes the complete new web representation", () => {
    const value = {
      output: projectSokoBotWebEvidence({ text: "Price EUR24." }),
      sources: [],
    };
    expect(
      judgeEvidenceVisibility("web_fetch", value, JSON.stringify(value)),
    ).toEqual({ complete: true, matchesModelView: true, reasons: [] });
  });
  it("marks redaction and projection limits without interpreting omitted facts", () => {
    const value = {
      output: projectSokoBotWebEvidence({
        api_key: "synthetic-test-secret-only",
        text: "a".repeat(20_000),
      }),
    };
    expect(
      judgeEvidenceVisibility("web_fetch", value, JSON.stringify(value)),
    ).toMatchObject({
      complete: false,
      matchesModelView: true,
      reasons: expect.arrayContaining([
        "redacted_web_output",
        "truncated_web_output",
      ]),
    });
  });
  it("reports clipping added by the judge's shared budget", () => {
    const value = {
      output: projectSokoBotWebEvidence({ text: "Price EUR24." }),
    };
    expect(
      judgeEvidenceVisibility(
        "web_fetch",
        value,
        JSON.stringify(value).slice(0, 20),
      ),
    ).toEqual({
      complete: false,
      matchesModelView: false,
      reasons: ["judge_budget_clipped"],
    });
  });
  it("does not claim that an old web log is complete", () => {
    const value = {
      output: "[Sensitive value removed]",
      sources: ["https://example.com/"],
    };
    expect(
      judgeEvidenceVisibility("web_fetch", value, JSON.stringify(value)),
    ).toMatchObject({
      complete: false,
      matchesModelView: false,
      reasons: expect.arrayContaining(["legacy_web_output", "redacted_value"]),
    });
  });
});
