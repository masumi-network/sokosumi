import { describe, expect, it } from "vitest";
import { selectEvalCases } from "../eval-cases";
import {
  attachedMadeMedia,
  createdTableIds,
  cronDays,
  gradeRows,
  launchDay,
  madeImages,
  nextWeekdayKey,
} from "./journey-checks";
import {
  countRetries,
  journeyScore,
  packetTurnIds,
  type StepRecord,
} from "./journey-runner";
import { investorNotes } from "./journey-world";
import { INVESTOR_FIXTURE, OWNER_JOURNEYS } from "./journeys";

describe("owner journeys", () => {
  it("has unique ids and starts each with the owner", () => {
    const ids = OWNER_JOURNEYS.map((journey) => journey.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const journey of OWNER_JOURNEYS)
      expect(journey.steps[0]?.kind, journey.id).toBe("owner");
  });

  it("gives Cuso journeys a Cuso world and Soko Bot journeys none", () => {
    for (const journey of OWNER_JOURNEYS)
      expect(Boolean(journey.cusoSetup), journey.id).toBe(
        journey.bot === "cuso",
      );
  });

  it("runs named journeys in the order named", () => {
    const ids = (caseIds: string[]) =>
      selectEvalCases({ suites: ["cmo"], caseIds }).map(
        (evalCase) => evalCase.id,
      );
    expect(ids(["owner-cuso-youtube", "owner-cuso-launch"])).toEqual([
      "owner-cuso-youtube",
      "owner-cuso-launch",
    ]);
    expect(ids(["owner-cuso-launch", "owner-cuso-youtube"])).toEqual([
      "owner-cuso-launch",
      "owner-cuso-youtube",
    ]);
  });

  it("runs only when named, never in a suite run", () => {
    const suite = selectEvalCases({ suites: ["soko-bot", "cmo"], caseIds: [] });
    expect(suite.some((evalCase) => evalCase.kind === "journey")).toBe(false);
    const named = selectEvalCases({
      suites: ["soko-bot"],
      caseIds: ["owner-codepat-daily-post"],
    });
    expect(named.map((evalCase) => evalCase.id)).toEqual([
      "owner-codepat-daily-post",
    ]);
  });
});

describe("cronDays", () => {
  it.each([
    ["0 9 * * *", [0, 1, 2, 3, 4, 5, 6]],
    ["0 9 * * 1-5", [1, 2, 3, 4, 5]],
    ["30 7 * * 1", [1]],
    ["0 9 * * 0-4,6", [0, 1, 2, 3, 4, 6]],
    ["0 9 * * SAT-THU", [0, 1, 2, 3, 4, 6]],
    ["0 9 * * 7", [0]],
  ])("%s", (cron, days) => {
    expect(cronDays(cron)).toEqual(days);
  });
});

it("finds the next weekday after a date in Berlin", () => {
  // Wednesday 2026-11-25 → next Tuesday is 2026-12-01.
  expect(nextWeekdayKey(new Date("2026-11-25T10:00:00Z"), 2)).toBe(
    "2026-12-01",
  );
});

describe("launchDay", () => {
  // Wednesday 2026-11-25: next Tuesday is Dec 1.
  const start = new Date("2026-11-25T10:00:00Z");

  it("is the next such weekday", () => {
    expect(launchDay(start, { weekday: 2 })).toBe("2026-12-01");
  });

  it("keeps the launch week when the launch moves", () => {
    // Not Thursday Nov 26, the day after the journey started.
    expect(launchDay(start, { weekday: 4, movedFrom: 2 })).toBe("2026-12-03");
  });
});

describe("made images and what a draft carries", () => {
  const made = (id: string) => ({ id, status: "SUCCEEDED", assetId: "a" });
  const svg = (name: string) => ({
    sourceId: `orgs/o/${name}`,
    displayName: name,
  });

  it("counts three uploaded SVGs attached to the draft (no studio job)", () => {
    const files = ["one.svg", "two.svg", "three.svg"].map(svg);
    expect(madeImages([], files)).toBe(3);
    expect(
      attachedMadeMedia(
        files.map((file) => ({ pathname: file.sourceId })),
        files,
      ),
    ).toEqual({ total: 3, made: 3 });
  });

  it("does not let three studio images with one attached pass as attached", () => {
    const jobs = ["...-aaaa1111", "...-bbbb2222", "...-cccc3333"].map(
      (suffix) => made(`01a21579-b51b-757c-b2b9-3d6d${suffix.slice(-8)}`),
    );
    const copy = svg("memory-aaaa1111.png");
    expect(madeImages(jobs, [copy])).toBe(3);
    expect(attachedMadeMedia([{ pathname: copy.sourceId }], [copy])).toEqual({
      total: 1,
      made: 1,
    });
  });

  it("counts a studio image once, whether or not it was copied to Files", () => {
    const job = made("01a21579-b51b-757c-b2b9-3d6d5edd6ed2");
    expect(madeImages([job], [svg("memory-5edd6ed2.png")])).toBe(1);
    expect(madeImages([job], [])).toBe(1);
    expect(madeImages([{ ...job, status: "FAILED" }], [])).toBe(0);
  });

  it("ignores attachments this journey did not make, and repeats", () => {
    const mine = svg("chart.svg");
    expect(
      attachedMadeMedia(
        [
          { pathname: mine.sourceId },
          { pathname: mine.sourceId },
          { pathname: "orgs/o/old-logo.png" },
        ],
        [mine],
      ),
    ).toEqual({ total: 2, made: 1 });
    expect(attachedMadeMedia(null, [mine])).toEqual({ total: 0, made: 0 });
  });
});

describe("investor table checks", () => {
  const outcome = {
    minRows: 10,
    allowed: INVESTOR_FIXTURE.fits,
    excluded: INVESTOR_FIXTURE.misfits,
  };
  const row = (fund: string, link = true) =>
    JSON.stringify({
      fund,
      source: link ? "https://example.com/notes/x" : "",
    });

  it("passes ten different sourced fitting investors", () => {
    const rows = INVESTOR_FIXTURE.fits.slice(0, 10).map((fund) => row(fund));
    expect(gradeRows(rows, outcome)).toEqual({
      rows: 10,
      good: 10,
      problems: [],
    });
  });

  it("counts repeats, missing links, misfits and invented rows against it", () => {
    const rows = [
      ...INVESTOR_FIXTURE.fits.slice(0, 8).map((fund) => row(fund)),
      row(INVESTOR_FIXTURE.fits[0]),
      row(INVESTOR_FIXTURE.fits[8], false),
      row("Bayline Capital"),
      row("Made Up Ventures"),
    ];
    expect(gradeRows(rows, outcome).problems).toEqual([
      "needs 10",
      "1 without a source link",
      "1 repeated",
      "2 not from the notes",
      "includes Bayline Capital",
    ]);
  });

  it("reads only the tables this journey's create_table returned", () => {
    expect(
      createdTableIds([
        {
          capability: "create_table",
          status: "COMPLETED",
          result: { table: { id: "t1" } },
        },
        {
          capability: "create_table",
          status: "FAILED",
          result: { table: { id: "t2" } },
        },
        {
          capability: "write_table_rows",
          status: "COMPLETED",
          result: { table: { id: "t3" } },
        },
      ]),
    ).toEqual(["t1"]);
  });

  it("puts every fitting and misfit investor in the notes", () => {
    const notes = investorNotes();
    for (const fund of [...INVESTOR_FIXTURE.fits, ...INVESTOR_FIXTURE.misfits])
      expect(notes).toContain(fund);
  });
});

it("finds the turn ids a context packet's recent turns name", () => {
  expect(
    packetTurnIds({ recentTurns: [{ id: "a" }, { id: "b" }, {}] }),
  ).toEqual(["a", "b"]);
  expect(packetTurnIds(null)).toEqual([]);
});

it("counts calls that come after a failed call of the same tool", () => {
  expect(
    countRetries([
      { capability: "update_social_post", status: "FAILED" },
      { capability: "update_social_post", status: "FAILED" },
      { capability: "update_social_post", status: "COMPLETED" },
      { capability: "create_schedule", status: "COMPLETED" },
    ]),
  ).toBe(2);
});

it("scores progress by steps in a row and checks", () => {
  const journey = OWNER_JOURNEYS[0]!;
  const step = (index: number, pass: boolean): StepRecord => ({
    index,
    kind: "owner",
    label: "",
    startedAt: "",
    turnIds: [],
    passed: pass,
    checks: [{ label: "x", pass, actual: "" }],
  });
  expect(
    journeyScore(journey, [step(0, true), step(1, false), step(2, true)]),
  ).toEqual({
    stepsTotal: journey.steps.length,
    stepsRun: 3,
    stepsPassed: 2,
    reached: 1,
    checksPassed: 2,
    checksTotal: 3,
  });
});
