import { describe, expect, it } from "vitest";
import type { FundraisingPipelineDto } from "@/schemas/fundraising.schema";
import { raiseBriefLines } from "./fundraising-brief.service";

const now = new Date("2026-11-25T09:00:00Z");
const via = {
  kind: "contact" as const,
  id: "c",
  name: "Christoph",
  image: null,
  email: null,
};

function prospect(
  over: Record<string, unknown>,
): FundraisingPipelineDto["prospects"][number] {
  return {
    contact: {
      id: "x",
      name: "Nico Lumma",
      organization: "NMA",
      followUpAt: null,
      nextStep: null,
      lastContactAt: null,
    },
    stage: "WARM_PATH",
    intro: { via: null, askedAt: null, madeAt: null, declinedAt: null },
    dataRoom: null,
    ...over,
  } as unknown as FundraisingPipelineDto["prospects"][number];
}

function pipeline(
  prospects: FundraisingPipelineDto["prospects"],
): FundraisingPipelineDto {
  return { prospects } as unknown as FundraisingPipelineDto;
}

describe("raiseBriefLines", () => {
  it("says nothing when nothing needs the owner", () => {
    expect(raiseBriefLines(pipeline([prospect({})]), now)).toEqual([]);
    expect(
      raiseBriefLines(
        pipeline([
          prospect({
            intro: { via, askedAt: new Date("2026-11-23T09:00:00Z") },
          }),
        ]),
        now,
      ),
    ).toEqual([]);
  });

  it("names the connector who went quiet, the investor quiet after the intro, and a fresh data room open", () => {
    const lines = raiseBriefLines(
      pipeline([
        prospect({
          intro: { via, askedAt: new Date("2026-11-19T09:00:00Z") },
          contact: {
            id: "x",
            name: "Nico Lumma",
            organization: "NMA",
            followUpAt: "2026-11-24",
            nextStep: "Wait",
            lastContactAt: null,
          },
        }),
        prospect({
          stage: "REACHED_OUT",
          intro: {
            via,
            askedAt: new Date("2026-11-10T09:00:00Z"),
            madeAt: new Date("2026-11-15T09:00:00Z"),
          },
          contact: {
            id: "y",
            name: "Ann Partner",
            organization: "Ann Capital",
            followUpAt: null,
            nextStep: null,
            lastContactAt: new Date("2026-11-14T09:00:00Z"),
          },
        }),
        prospect({
          contact: {
            id: "z",
            name: "Ryan Green",
            organization: "Antler",
            followUpAt: "2026-11-25",
            nextStep: "Send the deck",
            lastContactAt: null,
          },
          dataRoom: {
            lastVisitAt: new Date("2026-11-25T01:00:00Z"),
            lastOpened: "deck.pdf",
          },
        }),
      ]),
      now,
    );
    expect(lines[0]).toBe("## Your raise");
    expect(lines[1]).toContain(
      "Christoph has not answered your intro ask for Nico Lumma (NMA) in 6 days",
    );
    expect(
      lines.some((l) =>
        l.includes(
          "Ann Partner (Ann Capital) has not replied since Christoph made the intro 10 days ago",
        ),
      ),
    ).toBe(true);
    expect(
      lines.some((l) =>
        l.includes(
          "Ryan Green (Antler) opened the data room (deck.pdf) in the last day",
        ),
      ),
    ).toBe(true);
    expect(
      lines.some((l) =>
        l.includes("Ryan Green (Antler): follow-up due today: Send the deck"),
      ),
    ).toBe(true);
    // a pending ask is not also listed as a plain follow-up
    expect(lines.filter((l) => l.includes("Nico Lumma")).length).toBe(1);
    expect(lines.at(-2)).toContain("never a send");
  });
});
