import { describe, expect, it } from "vitest";

import { focusedReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import { parsePublicSeoArtifact } from "./project-seo-report";

function actionableReport() {
  const base = focusedReport();
  const source = {
    sourceRef: `${"a".repeat(64)}:${"b".repeat(64)}`,
    observedAt: base.observedAt,
  };
  return {
    ...base,
    scope: { ...base.scope, devices: ["desktop", "mobile"] },
    checks: ["desktop", "mobile"].map((device) => ({
      id: `finding-${device}`,
      rowId: "SD-01",
      pageUrl: SEO_TEST_PAGE,
      device,
      analysis: "page.inspect",
      result: "fired",
      level: "major",
      evidence: ["One captured JSON-LD block does not parse"],
      ...source,
    })),
    findings: ["desktop", "mobile"].map((device) => ({
      id: `finding-${device}`,
      rowId: "SD-01",
      pageUrl: SEO_TEST_PAGE,
      device,
      title: "Structured data does not parse",
      severity: "major",
      evidence: ["One captured JSON-LD block does not parse"],
      ...source,
    })),
    actions: [
      {
        id: "fix-json",
        pageUrl: SEO_TEST_PAGE,
        findingIds: ["finding-desktop", "finding-mobile"],
        title: "Fix invalid structured data",
        why: "The captured JSON-LD does not parse.",
        effort: "low",
        expectedEffect:
          "The block can be parsed. Rich results are not guaranteed.",
        edit: null,
      },
    ],
  };
}

describe("focused SEO action evidence boundary", () => {
  it("accepts recommendations only with exact confirmed page, device and source joins", () => {
    const raw = actionableReport();
    const result = parsePublicSeoArtifact(raw);
    expect(result.actions).toEqual(raw.actions);
    expect(result.findings.map((finding) => finding.id)).toEqual(
      raw.actions[0].findingIds,
    );
    expect(parsePublicSeoArtifact(focusedReport()).actions).toEqual([]);
  });

  it("rejects unknown, duplicate and empty action or evidence identities", () => {
    const cases: Array<(raw: ReturnType<typeof actionableReport>) => void> = [
      (raw) => {
        raw.actions[0].findingIds = ["unknown"];
      },
      (raw) => {
        raw.actions[0].findingIds = [];
      },
      (raw) => {
        raw.actions[0].findingIds = [" "];
      },
      (raw) => {
        raw.actions[0].findingIds = ["finding-desktop", "finding-desktop"];
      },
      (raw) => {
        raw.actions[0].id = " ";
      },
      (raw) => {
        raw.actions.push({ ...raw.actions[0] });
      },
      (raw) => {
        raw.findings[1].id = raw.findings[0].id;
      },
      (raw) => {
        raw.findings[0].id = "";
      },
      (raw) => {
        raw.checks[1].id = raw.checks[0].id;
      },
      (raw) => {
        raw.checks[0].id = "";
      },
    ];
    for (const mutate of cases) {
      const raw = actionableReport();
      mutate(raw);
      expect(() => parsePublicSeoArtifact(raw)).toThrow();
    }
  });

  it("rejects neutral, passing, unchecked or mismatched evidence", () => {
    const cases: Array<(raw: ReturnType<typeof actionableReport>) => void> = [
      (raw) => {
        raw.checks[0].result = "pass";
      },
      (raw) => {
        raw.checks[0].result = "blocked";
      },
      (raw) => {
        raw.checks[0].result = "not_checked";
      },
      (raw) => {
        raw.checks[0].level = "minor";
      },
      (raw) => {
        raw.findings[0].severity = raw.checks[0].level = "measure";
      },
      (raw) => {
        raw.findings[0].severity = raw.checks[0].level = "note";
      },
      (raw) => {
        raw.findings[0].severity = raw.checks[0].level = "test";
      },
      (raw) => {
        raw.checks[0].device = "mobile";
      },
      (raw) => {
        raw.checks[0].rowId = "AC-05";
      },
      (raw) => {
        raw.checks[0].analysis = "keyword.refresh";
      },
      (raw) => {
        raw.checks[0].sourceRef = "another-capture:another-record";
      },
      (raw) => {
        raw.checks[0].observedAt = "2026-11-02T12:00:00.000Z";
      },
      (raw) => {
        raw.checks[0].evidence = ["Different evidence"];
      },
      (raw) => {
        raw.findings[0].evidence = raw.checks[0].evidence = [];
      },
      (raw) => {
        raw.findings[0].sourceRef = raw.checks[0].sourceRef = " ";
      },
      (raw) => {
        raw.scope.devices = ["mobile"];
      },
    ];
    for (const mutate of cases) {
      const raw = actionableReport();
      mutate(raw);
      expect(() => parsePublicSeoArtifact(raw)).toThrow();
    }
  });

  it("rejects references borrowed from a different page, including another selected page", () => {
    const foreign = "https://example.test/another-page";
    for (const includeInScope of [false, true]) {
      const raw = actionableReport();
      raw.findings[0].pageUrl = raw.checks[0].pageUrl = foreign;
      if (includeInScope) raw.scope.pageUrls.push(foreign);
      expect(() => parsePublicSeoArtifact(raw)).toThrow();
    }
    const raw = actionableReport();
    raw.actions[0].pageUrl = foreign;
    expect(() => parsePublicSeoArtifact(raw)).toThrow();
  });

  it("keeps the existing 100-action bound for valid partial recommendations", () => {
    const raw = actionableReport();
    raw.actions = Array.from({ length: 100 }, (_, index) => ({
      ...raw.actions[0],
      id: `action-${index}`,
    }));
    expect(parsePublicSeoArtifact(raw).actions).toHaveLength(100);
    raw.actions.push({ ...raw.actions[0], id: "action-101" });
    expect(() => parsePublicSeoArtifact(raw)).toThrow();
  });
});
