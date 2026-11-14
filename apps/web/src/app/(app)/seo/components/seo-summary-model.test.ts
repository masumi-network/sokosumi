import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  lastRuleCheck,
  seoDemandAxis,
  seoKeywordDemand,
  seoSummary,
} from "./seo-summary-model";
import { seoTestWorkspace } from "./seo-test-fixture";

type Workspace = ProjectSeoWorkspace;
const CHECK = "962a86bb-5702-4d64-a6c4-15be5bf8ed80";

function check(
  id: string,
  coverage: Workspace["observations"][number]["coverage"],
): Workspace["observations"][number] {
  return {
    id,
    kind: "audit_full",
    source: "seo_coworker",
    observedAt: new Date("2026-01-03T12:00:00Z"),
    pageIds: [],
    scopeVersion: 2,
    sourceTaskId: null,
    countryCode: "US",
    languageCode: "en",
    devices: ["mobile", "desktop"],
    rulebookVersion: "v1",
    artifactHash: "hash",
    issues: 0,
    coverage,
  };
}
function finding(
  id: string,
  severity: Workspace["findings"][number]["severity"],
  device: "mobile" | "desktop" = "desktop",
  rowId = id,
): Workspace["findings"][number] {
  return {
    id,
    severity,
    observationId: CHECK,
    pageUrl: "https://example.com/",
    device,
    rowId,
    title: id,
    evidence: [],
    sourceRef: "html",
    observedAt: new Date("2026-01-03T12:00:00Z"),
  };
}
function keyword(
  name: string,
  patch: Partial<Workspace["keywords"][number]>,
): Workspace["keywords"][number] {
  return {
    id: name,
    keyword: name,
    pageUrl: "https://example.com/",
    targetPageId: null,
    saved: false,
    countryCode: "US",
    languageCode: "en",
    source: "focus",
    volume: null,
    intent: null,
    difficulty: null,
    clicks: null,
    conversion: null,
    feature: null,
    device: "desktop",
    position: null,
    positionStatus: "not_in_range",
    checkedResults: 16,
    observedAt: new Date("2026-01-03T12:00:00Z"),
    observationId: CHECK,
    priority: "medium",
    version: 0,
    ...patch,
  };
}

describe("seoSummary", () => {
  it("has no tile where no saved evidence gives its number", () => {
    // No check and no position read: a zero would say "checked, nothing found".
    expect(seoSummary(seoTestWorkspace())).toEqual({
      issues: null,
      tests: null,
      keywords: null,
      searches: null,
    });
  });

  it("counts issues by severity once per rule and page, worst first", () => {
    const workspace = seoTestWorkspace();
    workspace.observations = [
      check(CHECK, { checked: 201, skipped: 30, failed: 2 }),
    ];
    workspace.findings = [
      finding("minor", "minor"),
      // One rule that fails on both devices is one issue.
      finding("major-mobile", "major", "mobile", "SD-06"),
      finding("major-desktop", "major", "desktop", "SD-06"),
      finding("other-major", "major"),
      // Notes and measurements are no issues.
      finding("note", "note"),
      finding("measure", "measure"),
    ];
    const summary = seoSummary(workspace);
    expect(summary.issues).toEqual({
      total: 3,
      parts: [
        { severity: "major", count: 2 },
        { severity: "minor", count: 1 },
      ],
    });
    // Every test of the check counts: with a result, without one, and not run.
    expect(summary.tests).toEqual({
      total: 233,
      decided: 201,
      undecided: 30,
      unavailable: 2,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      // The tile's date opens the results of this check.
      observationId: CHECK,
    });
  });

  it("reports a clean check as zero issues, not as a missing tile", () => {
    const workspace = seoTestWorkspace();
    workspace.observations = [
      check(CHECK, { checked: 12, skipped: 0, failed: 0 }),
    ];
    expect(seoSummary(workspace).issues).toEqual({ total: 0, parts: [] });
  });

  it("sums the monthly searches of the read keywords and says how many have a number", () => {
    const workspace = seoTestWorkspace();
    workspace.keywords = [
      keyword("found", {
        positionStatus: "ranked",
        position: 4,
        volume: 720,
      }),
      keyword("missed", { volume: 90 }),
      // The same keyword read for a second page is one search term: its searches count once.
      keyword("found", {
        id: "found-pricing",
        pageUrl: "https://example.com/pricing",
        positionStatus: "ranked",
        position: 9,
        volume: 720,
      }),
      keyword("no volume", {}),
      keyword("also no volume", {}),
      // A focus keyword whose position read failed is in the list, but the check read no result for it.
      keyword("read failed", { positionStatus: "unavailable", volume: 300 }),
      // An idea has no position read: its searches are not searches the check looked at.
      keyword("idea", {
        source: "gap",
        positionStatus: "unavailable",
        volume: 5000,
      }),
    ];
    const summary = seoSummary(workspace);
    expect(summary.keywords).toEqual({
      read: 5,
      found: 2,
      firstPage: 2,
      depth: { min: 16, max: 16 },
    });
    // The counts are the rows of the keywords tile; only the sum counts the repeated keyword once.
    expect(summary.searches).toEqual({ total: 810, keywords: 3, of: 5 });
  });

  it("has no tests tile and no issues tile for a check that ran no test", () => {
    // Every part of the check failed before a rule ran: "0 of 0" and "0 issues" would read as results.
    const workspace = seoTestWorkspace();
    workspace.observations = [
      check(CHECK, {
        checked: 0,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 0, failed: 2 },
      }),
    ];
    const summary = seoSummary(workspace);
    expect(summary.tests).toBeNull();
    expect(summary.issues).toBeNull();
  });

  it("has no issues tile when a check found nothing but could not run every test", () => {
    const workspace = seoTestWorkspace();
    workspace.observations = [
      check(CHECK, { checked: 5, skipped: 0, failed: 20 }),
    ];
    const summary = seoSummary(workspace);
    // 20 tests did not run: "0 issues" is not proven. The tests tile says what ran.
    expect(summary.issues).toBeNull();
    expect(summary.tests?.total).toBe(25);
    // A clean newest check with a failed older check in view: the verdict says "incomplete", so no "0 issues".
    workspace.observations = [
      check(CHECK, { checked: 12, skipped: 0, failed: 0 }),
      check("older", { checked: 10, skipped: 0, failed: 3 }),
    ];
    expect(seoSummary(workspace).issues).toBeNull();
    // No test gave a result: nothing is decided.
    workspace.observations = [
      check(CHECK, { checked: 0, skipped: 30, failed: 0 }),
    ];
    expect(seoSummary(workspace).issues).toBeNull();
    // Every rule ran, but a part of the check failed.
    workspace.observations = [
      check(CHECK, {
        checked: 12,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 0, failed: 1 },
      }),
    ];
    expect(seoSummary(workspace).issues).toBeNull();
  });
});

describe("seoKeywordDemand", () => {
  it("lists the most searched checked keywords once each, largest first", () => {
    const workspace = seoTestWorkspace();
    const market = { countryCode: "US", languageCode: "en" };
    workspace.keywords = [
      keyword("battery app", { volume: 50 }),
      keyword("macbook battery", {
        volume: 720,
        position: 9,
        positionStatus: "ranked",
      }),
      // The same keyword read for a second page: one row, with the better position.
      keyword("Macbook  Battery", {
        volume: 720,
        position: 4,
        positionStatus: "ranked",
        pageUrl: "https://example.com/guide",
      }),
      keyword("battery widget", { volume: 320 }),
      // No known count and no searches: no bar.
      keyword("battery test", { volume: null }),
      keyword("battery zero", { volume: 0 }),
      // A read that failed is no checked keyword of the picture.
      keyword("battery fail", { volume: 9000, positionStatus: "unavailable" }),
    ];
    expect(seoKeywordDemand(workspace, 5)).toEqual({
      rows: [
        // The page with the better position leads its keyword.
        { keyword: "Macbook  Battery", ...market, volume: 720, best: 4 },
        { keyword: "battery widget", ...market, volume: 320, best: null },
        { keyword: "battery app", ...market, volume: 50, best: null },
      ],
      max: 720,
      manyMarkets: false,
    });
    // The same keyword in a second market is a row of its own, and the rows name their markets.
    workspace.keywords.push(
      keyword("battery app", {
        volume: 90,
        countryCode: "DE",
        languageCode: "de",
      }),
    );
    const markets = seoKeywordDemand(workspace, 5);
    expect(markets.manyMarkets).toBe(true);
    expect(
      markets.rows
        .filter((row) => row.keyword === "battery app")
        .map((row) => [row.countryCode, row.volume]),
    ).toEqual([
      ["DE", 90],
      ["US", 50],
    ]);
    workspace.keywords.pop();
    expect(
      seoKeywordDemand(workspace, 2).rows.map((row) => row.keyword),
    ).toEqual(["Macbook  Battery", "battery widget"]);
    // One bar is no comparison.
    workspace.keywords = [keyword("battery app", { volume: 50 })];
    expect(seoKeywordDemand(workspace, 5)).toEqual({
      rows: [],
      max: 0,
      manyMarkets: false,
    });
  });
});

describe("seoDemandAxis", () => {
  it("ends on a round step at or above the largest count", () => {
    expect(seoDemandAxis(2400)).toEqual({
      top: 3000,
      ticks: [0, 1000, 2000, 3000],
    });
    expect(seoDemandAxis(720)).toEqual({
      top: 800,
      ticks: [0, 200, 400, 600, 800],
    });
    // A count on a step is the end of the axis.
    expect(seoDemandAxis(1000).ticks).toEqual([0, 500, 1000]);
    // Whole searches only: no step under one.
    expect(seoDemandAxis(3).ticks).toEqual([0, 1, 2, 3]);
    expect(seoDemandAxis(1).ticks).toEqual([0, 1]);
    // No count is still an axis with a length, so a bar's share stays a number.
    expect(seoDemandAxis(0)).toEqual({ top: 1, ticks: [0, 1] });
  });
});

describe("lastRuleCheck", () => {
  it("skips a newer read that asked for no rule checks", () => {
    const workspace = seoTestWorkspace();
    workspace.observations = [
      check("rankings-read", { checked: 0, skipped: 0, failed: 0 }),
      check(CHECK, { checked: 12, skipped: 0, failed: 0 }),
    ];
    expect(lastRuleCheck(workspace)?.id).toBe(CHECK);
    workspace.observations = [workspace.observations[0]];
    expect(lastRuleCheck(workspace)).toBeNull();
  });
});
