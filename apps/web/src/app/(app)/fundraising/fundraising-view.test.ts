import type { FundraisingProspect } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { countByStage, parseUsd, sortProspects } from "./fundraising-view";

function prospect(
  name: string,
  stage: FundraisingProspect["stage"],
  lastContactAt: string | null,
): FundraisingProspect {
  return {
    stage,
    contact: { name, lastContactAt },
  } as unknown as FundraisingProspect;
}

describe("sortProspects", () => {
  it("orders by stage, then latest touch, then name", () => {
    const sorted = sortProspects([
      prospect("Zed", "TO_RESEARCH", null),
      prospect("Amy", "PASSED", "2026-11-20T00:00:00Z"),
      prospect("Bob", "MEETING", "2026-11-01T00:00:00Z"),
      prospect("Cat", "MEETING", "2026-11-10T00:00:00Z"),
      prospect("Ann", "TO_RESEARCH", null),
    ]).map((p) => p.contact.name);
    expect(sorted).toEqual(["Ann", "Zed", "Cat", "Bob", "Amy"]);
  });
});

describe("countByStage", () => {
  it("counts every stage, zero included", () => {
    const counts = countByStage([
      prospect("A", "MEETING", null),
      prospect("B", "MEETING", null),
      prospect("C", "PASSED", null),
    ]);
    expect(counts.MEETING).toBe(2);
    expect(counts.PASSED).toBe(1);
    expect(counts.TO_RESEARCH).toBe(0);
  });
});

describe("parseUsd", () => {
  it("reads k and m shorthands and plain dollars", () => {
    expect(parseUsd("$1,000,000")).toBe(1_000_000);
    expect(parseUsd("250k")).toBe(250_000);
    expect(parseUsd("1.5 M")).toBe(1_500_000);
    expect(parseUsd("  ")).toBeNull();
    expect(parseUsd("a lot")).toBeUndefined();
  });
});
