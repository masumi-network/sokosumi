import type {
  FundraisingPath,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  countByStage,
  introAction,
  parseUsd,
  pathConnector,
  sortProspects,
} from "./fundraising-view";

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

describe("introAction", () => {
  const me = "me";
  const path = (over: Partial<FundraisingPath>): FundraisingPath => ({
    kind: "direct",
    via: { id: me, name: "Me", image: null },
    linkedIn: false,
    through: null,
    company: null,
    strength: 50,
    touches: 3,
    lastTouchAt: null,
    ...over,
  });
  const prospect = (over: {
    intro?: Partial<FundraisingProspect["intro"]>;
    bestPath?: FundraisingPath | null;
  }): FundraisingProspect =>
    ({
      intro: {
        via: null,
        askedAt: null,
        madeAt: null,
        declinedAt: null,
        ...over.intro,
      },
      bestPath: over.bestPath ?? null,
    }) as FundraisingProspect;
  const fay = {
    id: "fay",
    name: "Fay Founder",
    role: "CEO",
    organization: "AgentPay",
    avatarUrl: null,
    email: "fay@agentpay.com",
  };

  it("asks the contact a portfolio path runs through, naming the teammate who knows them", () => {
    const action = introAction(
      prospect({
        bestPath: path({
          kind: "portfolio",
          via: { id: "bob", name: "Bob", image: null },
          through: fay,
          company: { name: "AgentPay", round: "Seed", date: "2026-03" },
        }),
      }),
      me,
    );
    expect(action).toMatchObject({
      kind: "ask",
      connector: { kind: "contact", id: "fay", email: "fay@agentpay.com" },
      viaName: "Bob",
    });
  });

  it("asks a teammate who knows the investor, and writes directly when the viewer does", () => {
    expect(
      introAction(
        prospect({
          bestPath: path({ via: { id: "bob", name: "Bob", image: null } }),
        }),
        me,
      ),
    ).toMatchObject({
      kind: "ask",
      connector: { kind: "teammate", id: "bob" },
    });
    expect(introAction(prospect({ bestPath: path({}) }), me)).toMatchObject({
      kind: "write",
    });
    expect(pathConnector(path({}), me)).toBeNull();
  });

  it("shows the intro in flight before any path, and skips a connector who declined", () => {
    const via = {
      kind: "contact" as const,
      id: "fay",
      name: "Fay Founder",
      image: null,
      email: null,
    };
    expect(
      introAction(
        prospect({ intro: { via, askedAt: new Date("2026-11-20T00:00:00Z") } }),
        me,
      ),
    ).toMatchObject({ kind: "asked", via: { id: "fay" } });
    expect(
      introAction(
        prospect({
          intro: {
            via,
            askedAt: new Date("2026-11-20T00:00:00Z"),
            madeAt: new Date("2026-11-22T00:00:00Z"),
          },
        }),
        me,
      ),
    ).toMatchObject({ kind: "made" });
    expect(
      introAction(
        prospect({
          intro: {
            via,
            askedAt: new Date("2026-11-20T00:00:00Z"),
            declinedAt: new Date("2026-11-22T00:00:00Z"),
          },
          bestPath: path({
            kind: "fund",
            via: null,
            through: fay,
            company: { name: "AgentPay", round: null, date: null },
          }),
        }),
        me,
      ),
    ).toMatchObject({ kind: "none", declined: { id: "fay" } });
    expect(introAction(prospect({}), me)).toEqual({
      kind: "none",
      declined: null,
    });
  });
});
