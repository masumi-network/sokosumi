import { readFileSync } from "node:fs";
import type { TurnClassification } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import {
  isRight,
  isRightToAct,
  outcomeOf,
  parseRoutingCases,
  type RoutingCall,
  type RoutingCase,
  summarizeRouting,
} from "./routing-bench";

const routed = (
  route: TurnClassification["route"],
  writeScope?: TurnClassification["writeScope"],
) => ({ route, ...(writeScope ? { writeScope } : {}) }) as TurnClassification;

const item = (
  want: RoutingCase["want"],
  alt?: RoutingCase["alt"],
): RoutingCase => ({
  id: want,
  category: "work",
  lang: "en",
  bot: "soko-bot",
  message: "m",
  want,
  ...(alt ? { alt } : {}),
  complexity: "SIMPLE",
  source: "test",
});

const call = (
  caseId: string,
  got: RoutingCall["got"],
  run = 1,
): RoutingCall => ({
  caseId,
  run,
  got,
  jevRoute: null,
  jevConfidence: null,
  unsureRoute: got === "READ" ? "MANAGE_WORK" : null,
  complexity: "SIMPLE",
  costUsd: 0.0001,
});

describe("outcomeOf", () => {
  it("reads the grant the turn gets, not Jev's raw label", () => {
    expect(outcomeOf(routed("CLARIFY"))).toBe("ASK");
    expect(outcomeOf(routed("DIRECT_RESPONSE"))).toBe("READ");
    expect(outcomeOf(routed("MIXED"))).toBe("DELEGATE");
    expect(outcomeOf(routed("MANAGE_WORK", "SOCIAL"))).toBe("MANAGE:SOCIAL");
    expect(outcomeOf(routed("MANAGE_WORK"))).toBe("READ");
  });
});

describe("scoring", () => {
  it("ACT takes any write but a hire", () => {
    expect(isRight(item("ACT"), "MANAGE:WORK")).toBe(true);
    expect(isRight(item("ACT"), "DELEGATE")).toBe(true);
    expect(isRight(item("ACT"), "HIRE")).toBe(false);
    expect(isRight(item("ACT"), "ASK")).toBe(false);
  });

  it("a wrong scope is still right about acting", () => {
    expect(isRight(item("MANAGE:SOCIAL"), "MANAGE:WORK")).toBe(false);
    expect(isRightToAct(item("MANAGE:SOCIAL"), "MANAGE:WORK")).toBe(true);
    expect(isRightToAct(item("READ", ["ASK"]), "ASK")).toBe(true);
    expect(isRightToAct(item("MANAGE:SOCIAL"), "ASK")).toBe(false);
  });

  it("counts under-acts, threshold losses, flips and failures", () => {
    const cases = [item("MANAGE:SOCIAL"), item("READ")];
    const summary = summarizeRouting(cases, [
      call("MANAGE:SOCIAL", "READ", 1),
      call("MANAGE:SOCIAL", "MANAGE:SOCIAL", 2),
      call("READ", "DELEGATE", 1),
      call("READ", null, 2),
    ]);
    expect(summary).toMatchObject({
      calls: 4,
      failed: 1,
      right: 1,
      underActs: 1,
      overActs: 1,
      lostToThreshold: 1,
      flipped: 1,
    });
    expect(summary.confusion.MANAGE).toEqual({ READ: 1, MANAGE: 1 });
    expect(summary.confusion.READ).toEqual({ DELEGATE: 1, FAILED: 1 });
  });
});

describe("the dev set", () => {
  it("parses, with unique ids", () => {
    const cases = parseRoutingCases(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../scripts/fixtures/jev-routing-set.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    expect(cases.length).toBeGreaterThanOrEqual(140);
  });
});
