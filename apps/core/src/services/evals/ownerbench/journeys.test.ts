import { describe, expect, it } from "vitest";
import { minimumEvalRepeats, selectEvalCases } from "../eval-cases";
import { outcomeProblems } from "./holdout";
import {
  attachedMadeMedia,
  createdTableIds,
  cronDays,
  gradeRows,
  launchDay,
  madeImages,
  nextWeekdayKey,
  pictureProblems,
  savedFileTexts,
  urlsIn,
} from "./journey-checks";
import {
  countRetries,
  journeyScore,
  journeyStatus,
  packetTurnIds,
  type StepRecord,
  scheduleToFire,
  stepExpectationChecks,
} from "./journey-runner";
import { investorNotes, previousWeekMidpoint } from "./journey-world";
import {
  type FixtureInvestor,
  INVESTOR_FIXTURE,
  OWNER_JOURNEYS,
} from "./journeys";

describe("owner journeys", () => {
  it("has unique ids and starts each with the owner", () => {
    const ids = OWNER_JOURNEYS.map((journey) => journey.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const journey of OWNER_JOURNEYS)
      expect(journey.steps[0]?.kind, journey.id).toBe("owner");
  });

  it("says what content every delivery needs, so a promise can't pass", () => {
    const problems = OWNER_JOURNEYS.flatMap((journey) =>
      journey.steps.flatMap((step) =>
        (step.outcomes ?? []).flatMap((outcome) =>
          outcomeProblems(outcome).map(
            (problem) => `${journey.id}: ${problem}`,
          ),
        ),
      ),
    );
    expect(problems).toEqual([]);
    expect(outcomeProblems({ kind: "delivered", label: "report" })).toEqual([
      'delivered "report" must say what content it needs (textMatches)',
    ]);
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

  it("runs a held-out journey at least three times, the rest as asked", () => {
    const journey = (id: string) => ({
      id,
      suite: "soko-bot" as const,
      area: "Owner bench",
      title: "t",
      intent: "i",
      kind: "journey" as const,
      journey: { ...OWNER_JOURNEYS[0]!, id },
    });
    expect(minimumEvalRepeats(journey("owner-holdout-x"))).toBe(3);
    expect(minimumEvalRepeats(journey("owner-codepat-daily-post"))).toBe(1);
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

describe("a fired Task Schedule", () => {
  const journey = OWNER_JOURNEYS.find(
    (candidate) => candidate.id === "owner-weekly-report-schedule",
  )!;
  const fires = journey.steps.find((step) => step.kind === "schedule_fires")!;
  const turn = (capabilities: string[]) => ({
    status: "COMPLETED",
    route: "ANSWER",
    finalAnswer: "Monday report: two Tasks moved, one is stuck.",
    toolCalls: capabilities.map((capability) => ({
      capability,
      status: "COMPLETED",
      result: null,
    })),
    events: [],
    delegations: [],
    decisions: [],
  });

  it("never stands in for the report the step asks the bot for", () => {
    const released = stepExpectationChecks(journey, fires, null, true);
    expect(released).toEqual([
      expect.objectContaining({
        pass: false,
        actual: expect.stringContaining("no bot turn after the release"),
      }),
    ]);
    // The report delivered: the board read and the answer meet the step.
    const delivered = stepExpectationChecks(
      journey,
      fires,
      turn(["list_tasks"]),
      true,
    );
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every((check) => check.pass)).toBe(true);
    // A step that only forbids things holds without a turn.
    expect(
      stepExpectationChecks(
        journey,
        {
          kind: "schedule_fires",
          expect: { forbiddenTools: ["delete_schedule"] },
        },
        null,
        true,
      ),
    ).toEqual([]);
    // Without a release, no turn is still no turn.
    expect(stepExpectationChecks(journey, fires, null, false)).toEqual([
      { label: "Completed", pass: false, actual: "no turn" },
    ]);
  });

  it("fires the schedule the journey remembered, not the newest", () => {
    const schedule = (id: string, enabled = true) => ({
      kind: "task" as const,
      id,
      cronExpression: "0 9 * * *",
      prompt: "",
      timezone: "Europe/Berlin",
      enabled,
      runOnce: false,
      updatedAt: new Date(),
    });
    const newestFirst = [schedule("newer"), schedule("remembered")];
    expect(
      scheduleToFire(newestFirst, { schedule: ["remembered"] }),
    ).toMatchObject({
      id: "remembered",
    });
    expect(scheduleToFire(newestFirst, {})).toMatchObject({ id: "newer" });
    expect(
      scheduleToFire([schedule("newer"), schedule("remembered", false)], {
        schedule: ["remembered"],
      }),
    ).toEqual({ error: "The owner's schedule is off" });
    expect(
      scheduleToFire([schedule("newer")], { schedule: ["remembered"] }),
    ).toEqual({
      error: "The owner's schedule is gone",
    });
  });
});

describe("previousWeekMidpoint", () => {
  it("lands in last week's Berlin Monday-to-Sunday on Thursday through Sunday", () => {
    // Thu 26 Nov 2026 to Sun 29 Nov, late in the Berlin evening too.
    for (const now of [
      "2026-11-26T08:00:00Z",
      "2026-11-27T12:00:00Z",
      "2026-11-28T22:30:00Z",
      "2026-11-29T22:30:00Z",
    ])
      expect(previousWeekMidpoint(new Date(now)).toISOString(), now).toBe(
        "2026-11-18T11:00:00.000Z",
      );
    // Monday 30 Nov: last week is 23 to 29 Nov.
    expect(
      previousWeekMidpoint(new Date("2026-11-30T07:00:00Z")).toISOString(),
    ).toBe("2026-11-25T11:00:00.000Z");
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
  const made = (id: string) => ({
    id,
    status: "SUCCEEDED",
    asset: { id: "a" },
  });
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

describe("a journey's verdict", () => {
  it("is unscored when the judge was unavailable, never a pass", () => {
    expect(journeyStatus(true, true, null)).toBe("ERROR");
    expect(journeyStatus(true, true, { verdict: "pass" })).toBe("PASSED");
    expect(journeyStatus(true, true, { verdict: "fail" })).toBe("FAILED");
    expect(journeyStatus(false, true, { verdict: "pass" })).toBe("FAILED");
    // No turn to judge: the failed checks decide.
    expect(journeyStatus(false, false, null)).toBe("FAILED");
  });
});

describe("a replaced picture and a saved file", () => {
  const seeded = {
    postId: "post",
    text: "The post text.",
    pathname: "drive/old.svg",
    others: [{ postId: "other", pathnames: ["drive/other.svg"] }],
  };
  // As jsonb hands it back: keys in another order than they were written.
  const others = [
    {
      id: "other",
      media: [
        { kind: "image", name: "other.svg", pathname: "drive/other.svg" },
      ],
    },
  ];
  const made = [{ sourceId: "drive/new.png" }];

  it("passes a new made picture on the same post, the rest as they were", () => {
    expect(
      pictureProblems(
        seeded,
        {
          text: seeded.text,
          status: "SCHEDULED",
          media: [{ pathname: "drive/new.png" }],
        },
        others,
        made,
      ),
    ).toEqual([]);
  });

  it("fails the old picture kept, a changed text, a cancelled post and another picture touched", () => {
    expect(
      pictureProblems(
        seeded,
        {
          text: "New text.",
          status: "CANCELED",
          media: [{ pathname: "drive/old.svg" }],
        },
        [{ id: "other", media: [] }],
        made,
      ),
    ).toEqual([
      "the post was cancelled",
      "its text changed",
      "the old picture is still on it",
      "no picture made in this journey on it",
      "1 other picture(s) changed",
    ]);
    expect(pictureProblems(seeded, null, others, made)).toEqual([
      "the post is gone",
    ]);
  });

  it("reads a saved file's text from the last successful upload its receipt names, else what Files indexed", () => {
    const upload = (status: string, id: string, content?: string) => ({
      capability: "upload_file",
      status,
      input: { filename: "report.md", ...(content ? { content } : {}) },
      result: { id, filename: "report.md", size: 1 },
    });
    expect(
      savedFileTexts(
        [
          { id: "f1", displayName: "Reports/report.md" },
          { id: "f2", displayName: "report (2).md" },
          { id: "f3", displayName: "notes.md" },
        ],
        [
          upload("SUCCEEDED", "f1", "first"),
          upload("SUCCEEDED", "f1", "second"),
          upload("FAILED", "f1", "third"),
          // A sandbox upload: a workspace path, no content.
          upload("SUCCEEDED", "f2"),
        ],
        { f2: "indexed text" },
      ),
    ).toEqual([
      { name: "Reports/report.md", text: "second" },
      { name: "report (2).md", text: "indexed text" },
      { name: "notes.md", text: null },
    ]);
  });
});

describe("investor table checks", () => {
  const outcome = {
    minRows: 10,
    allowed: INVESTOR_FIXTURE.fits,
    excluded: INVESTOR_FIXTURE.misfits,
  };
  const fits = INVESTOR_FIXTURE.fits;
  const row = (fit: FixtureInvestor, override: Partial<FixtureInvestor> = {}) =>
    JSON.stringify({
      fund: fit.fund,
      partner: fit.partner,
      deal: `Seed round of ${fit.startup}`,
      source: fit.source,
      ...override,
    });

  it("passes ten different fitting investors, each with its own partner, deal and source", () => {
    const rows = fits.slice(0, 10).map((fit) => row(fit));
    expect(gradeRows(rows, outcome)).toEqual({
      rows: 10,
      good: 10,
      problems: [],
    });
  });

  it("fails ten known names sharing one unrelated link with no partner or deal", () => {
    const rows = fits
      .slice(0, 10)
      .map((fit) =>
        JSON.stringify({ fund: fit.fund, source: "https://example.org/list" }),
      );
    expect(gradeRows(rows, outcome)).toEqual({
      rows: 10,
      good: 0,
      problems: [
        "needs 10",
        "10 without the fund's own partner, deal and source",
      ],
    });
  });

  it("fails ten otherwise right rows whose links point under a different path", () => {
    const rows = fits
      .slice(0, 10)
      .map((fit) => row(fit, { source: `${fit.source}/elsewhere` }));
    expect(gradeRows(rows, outcome).good).toBe(0);
  });

  it("reads whole URLs out of a row", () => {
    expect(
      urlsIn(
        'see https://a.example/x/y, and (https://b.example/z/). "https://c.example"',
      ),
    ).toEqual([
      "https://a.example/x/y",
      "https://b.example/z",
      "https://c.example",
    ]);
  });

  it("fails a row whose partner, deal or link belongs to another fund", () => {
    const [first, second] = fits as [FixtureInvestor, FixtureInvestor];
    for (const field of ["partner", "deal", "source"] as const) {
      const swapped =
        field === "deal"
          ? row(first).replace(first.startup, second.startup)
          : row(first, { [field]: second[field] });
      expect(gradeRows([swapped], outcome).good, field).toBe(0);
    }
  });

  it("counts repeats, misfits and invented rows against it", () => {
    const rows = [
      ...fits.slice(0, 8).map((fit) => row(fit)),
      row(fits[0] as FixtureInvestor),
      row(INVESTOR_FIXTURE.misfits[0] as FixtureInvestor),
      JSON.stringify({ fund: "Made Up Ventures" }),
    ];
    expect(gradeRows(rows, outcome).problems).toEqual([
      "needs 10",
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
    for (const entry of [...INVESTOR_FIXTURE.fits, ...INVESTOR_FIXTURE.misfits])
      for (const value of Object.values(entry)) expect(notes).toContain(value);
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
