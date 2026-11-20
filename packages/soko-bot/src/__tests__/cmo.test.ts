import {
  creditsPerTalkingVideoCents,
  TALKING_VIDEO_PRICE,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  cmoMayExecute,
  cmoRoutineSkipReason,
  cmoSaveBrandBrainInputSchema,
  cmoSaveStrategyInputSchema,
  isCmoScheduleKey,
  parseCmoStrategySave,
  SOKO_BOT_CMO_RHYTHMS,
  SOKO_BOT_CMO_SCHEDULES,
} from "../cmo.js";
import {
  SOKO_BOT_CMO_CAPABILITIES,
  SOKO_BOT_COMPETITOR_CAPABILITIES,
} from "../policy.js";
import {
  cmoCalendarEntrySchema,
  marketingStrategyPlanSchema,
  socialPostPlanningSchema,
} from "../project-marketing.js";
import { CMO_SCENARIOS, evaluateScenario } from "../scenarios.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import {
  CMO_BATCHED_PRODUCTION_SKILL,
  CMO_PIECE_WRITING_GUIDE,
  CMO_SKILLS,
  CMO_VARIED_PIECE_WRITING_GUIDE,
} from "../versions/cmo-skills.js";
import { cmoV6 } from "../versions/cmo-v6.js";
import { cmoV7 } from "../versions/cmo-v7.js";
import {
  CMO_CLAIMS_STRATEGY_SKILL,
  CMO_VARIED_PRODUCTION_SKILL,
} from "../versions/cmo-v8-skills.js";
import {
  applyVersionCapabilities,
  CMO_SOKO_BOT_VERSION_ID,
  CMO_SOKO_BOT_VERSION_IDS,
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotSkill,
  getSokoBotVersion,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";
import { v29 } from "../versions/v29.js";

describe("CMO version", () => {
  it("names no Sokosumi feature in Cuso's own persona, skills and rhythms", () => {
    // He works in CMO.xyz: what he is told is what he tells the owner.
    const own = [
      ...CMO_SOKO_BOT_VERSION_IDS.map((id) =>
        getSokoBotVersion(id).systemPrompt.replace(v29.systemPrompt, ""),
      ),
      JSON.stringify(CMO_SKILLS),
      JSON.stringify(SOKO_BOT_CMO_SCHEDULES),
    ]
      .join("\n")
      .replaceAll("Speak the founder's language, not Sokosumi's", "");
    expect(own).toContain("You are Cuso");
    expect(own.match(/Sokosumi|Content Studio|Soko Bot|\]\(\//g)).toBeNull();
  });

  it("is resolvable but never part of the personal-assistant fleet", () => {
    expect(getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID).profile).toBe("cmo");
    expect(SOKO_BOT_VERSIONS.map((version) => version.id)).not.toContain(
      CMO_SOKO_BOT_VERSION_ID,
    );
    expect(composeSystemPrompt(getSokoBotVersion("cmo-v1"))).toContain(
      "# Brand Brain",
    );
  });

  it("keeps cmo-v1's strategy skill word for word and gives cmo-v2 the plan in pieces", () => {
    const v1 = composeSystemPrompt(getSokoBotVersion("cmo-v1"));
    const v2 = composeSystemPrompt(getSokoBotVersion("cmo-v2"));
    expect(getSokoBotVersion("cmo-v2").id).toBe("cmo-v2");
    expect(v1).toContain(
      "Every entry has approach, pillar, date, time (HH:MM, a sensible slot for that channel's audience), channel, format, title, brief",
    );
    expect(v1).not.toMatch(/part patch|weeks two to four are titles/);
    expect(v2).toMatch(/weeks two to four are titles/);
    expect(v2).toMatch(/with part patch/);
    expect(v2).toMatch(/refuses a save that breaks a hard rule/);
    // Titles-only weeks are still the whole month, and a new cadence moves
    // the calendar, not just its label.
    expect(v2).toMatch(
      /still hold every piece the pace and each channel's cadence call for/,
    );
    // ...and only that channel's: a change request once rewrote a newsletter
    // to win the shares back.
    expect(v2).toMatch(/changes that channel's entries only/);
    expect(v2).toMatch(/Leave every other piece as it was/);
    expect(v2).toMatch(/never by changing a piece the owner did not name/);
    expect(v2).toMatch(/Never change the mix, the pillars/);
    expect(v1).not.toMatch(
      /still hold every piece|that channel's entries only/,
    );
    // A new audience reaches every part that names the old one; titles make
    // their own point; a holiday needs a real reason.
    expect(v2).toMatch(/A change to the audience or focus rewrites every part/);
    expect(v2).toMatch(/Every title makes its own point/);
    expect(v2).toMatch(
      /only when the business has a real reason for that date/,
    );
    // Only the strategy skill differs.
    const one = getSokoBotVersion("cmo-v1");
    const two = getSokoBotVersion("cmo-v2");
    expect(two.systemPrompt).toBe(one.systemPrompt);
    expect(two.capabilities).toEqual(one.capabilities);
    expect(two.model).toBe(one.model);
    expect(two.skills).toEqual(
      one.skills.map((skill) =>
        skill === "cmo-brand-brain"
          ? "cmo-brand-brain-groups"
          : skill === "cmo-strategy"
            ? "cmo-strategy-patches"
            : skill,
      ),
    );
  });

  it("gives Core's month writer only to a Cuso whose production skill calls it", () => {
    expect(
      applyVersionCapabilities(getSokoBotVersion("cmo-v6"), ["read_memory"]),
    ).toContain("write_month_pieces");
    for (const id of ["cmo-v5", "cmo-v1", DEFAULT_SOKO_BOT_VERSION_ID])
      expect(
        applyVersionCapabilities(getSokoBotVersion(id), [
          "read_memory",
          "write_month_pieces",
        ]),
      ).not.toContain("write_month_pieces");
  });

  it("keeps cmo-v5's month and has cmo-v6 call the writer first, on the same writing rules", () => {
    const skillOf = (id: string) =>
      getSokoBotVersion(id).skills.find((skill) =>
        skill.startsWith("cmo-production"),
      );
    expect(skillOf("cmo-v5")).toBe("cmo-production");
    expect(skillOf("cmo-v6")).toBe(CMO_BATCHED_PRODUCTION_SKILL);
    const batched = getSokoBotSkill(CMO_BATCHED_PRODUCTION_SKILL).content;
    expect(batched).toContain("## Core writes first");
    expect(batched).toContain("write_month_pieces");
    const sections = (content: string) =>
      content.split("\n## ").map((section) => section.split("\n")[0]);
    // The same sections in the same order, one more first, and an end that
    // leaves Core's pieces to Jev's review.
    expect(sections(batched)).toEqual(
      sections(getSokoBotSkill("cmo-production").content).flatMap((name) =>
        name === "Before the first piece"
          ? ["Core writes first", name]
          : [name],
      ),
    );
    expect(batched).toContain("do not read them back or rewrite them");
    expect(getSokoBotSkill("cmo-production").content).not.toContain(
      "do not read them back",
    );
    // The writer works from the same copy rules, without the tool steps.
    expect(CMO_PIECE_WRITING_GUIDE).toContain("## Hooks and copy");
    expect(CMO_PIECE_WRITING_GUIDE).not.toMatch(
      /list_project_social_accounts|update_social_post|save_strategy/,
    );
  });

  // Owner, 2026-11-20: varied pictures, no repeated messages, corrections
  // that reach the whole plan, stronger LinkedIn openings.
  it("has cmo-v8 build on cmo-v7 with claims, varied pictures and LinkedIn openings", () => {
    const v7 = getSokoBotVersion("cmo-v7");
    const v8 = getSokoBotVersion("cmo-v8");
    expect(v8.systemPrompt).toBe(v7.systemPrompt);
    expect(v8.skills).toEqual(
      v7.skills.map((skill) =>
        skill === "cmo-strategy-every-network"
          ? CMO_CLAIMS_STRATEGY_SKILL
          : skill === CMO_BATCHED_PRODUCTION_SKILL
            ? CMO_VARIED_PRODUCTION_SKILL
            : skill,
      ),
    );
    // Core still writes the month at once.
    expect(
      applyVersionCapabilities(v8, ["read_memory", "write_month_pieces"]),
    ).toContain("write_month_pieces");

    const strategy = getSokoBotSkill(CMO_CLAIMS_STRATEGY_SKILL).content;
    expect(strategy).toContain(
      "also has claim: the one sentence the piece argues",
    );
    expect(strategy).toContain(
      "A correction (an owner's no, a Brand Brain fix",
    );
    expect(strategy.length).toBeGreaterThan(
      getSokoBotSkill("cmo-strategy-every-network").content.length,
    );

    const production = getSokoBotSkill(CMO_VARIED_PRODUCTION_SKILL).content;
    expect(production).not.toContain("infographics for data and how-to");
    expect(production).toContain(
      "An infographic only for a picture that shows numbers",
    );
    expect(production).toContain("A LinkedIn post opens with a result");
    expect(production).toContain("## Core writes first");

    expect(CMO_VARIED_PIECE_WRITING_GUIDE).toContain(
      "- purpose, with styleLook",
    );
    expect(CMO_VARIED_PIECE_WRITING_GUIDE).toContain(
      "argues its entry's claim",
    );
    expect(CMO_PIECE_WRITING_GUIDE).not.toContain("purpose, with styleLook");
  });

  it("keeps a piece's claim on its plan entry and its Social post", () => {
    const entry = {
      id: "e1",
      date: "2026-11-21",
      channel: "x",
      title: "Mint without code",
      format: "post",
      status: "idea",
      claim: "Minting takes no code",
    };
    expect(cmoCalendarEntrySchema.parse(entry).claim).toBe(
      "Minting takes no code",
    );
    expect(socialPostPlanningSchema.parse(entry).claim).toBe(
      "Minting takes no code",
    );
  });

  it("gives CMO tools to Cuso on every route and to nobody else", () => {
    const cmo = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    const assistant = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    // Cuso also always carries the competitor tools, routed or not, once.
    for (const routed of [
      ["read_memory"] as const,
      ["read_memory", "check_competitors", "save_competitor_feed"] as const,
    ])
      expect(applyVersionCapabilities(cmo, routed)).toEqual([
        "read_memory",
        ...SOKO_BOT_CMO_CAPABILITIES,
        ...SOKO_BOT_COMPETITOR_CAPABILITIES,
      ]);
    // Another bot gets them only from its route; Core then asks whether a
    // Project it works in has the weekly check on.
    expect(
      applyVersionCapabilities(assistant, [
        "read_memory",
        "check_competitors",
        "save_competitor_feed",
      ]),
    ).toEqual(["read_memory", "check_competitors", "save_competitor_feed"]);
    expect(
      applyVersionCapabilities(assistant, [
        "read_memory",
        "save_strategy",
        "save_brand_brain",
      ]),
    ).toEqual(["read_memory"]);
    // Personal mail is not a CMO tool.
    expect(applyVersionCapabilities(cmo, ["search_inbox"])).not.toContain(
      "search_inbox",
    );
  });

  it("writes scripts, follows Agent Jobs and asks Coworkers like v27", () => {
    const cmo = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    expect(cmo.skills).toEqual(
      expect.arrayContaining([
        "cmo-code-tools",
        "cmo-agent-jobs",
        "cmo-ask-coworker",
      ]),
    );
    expect(cmo.capabilities).toEqual(
      expect.arrayContaining([
        "bash",
        "ask_coworker",
        "hire_agent",
        "get_job_status",
        "provide_job_input",
      ]),
    );
  });

  it("carries what a default Soko Bot learned: v29's contract, statistics, wait_for, Jev and read-only ads", () => {
    const cmo = getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID);
    const prompt = composeSystemPrompt(cmo);
    expect(prompt).toContain("# Truth");
    expect(prompt).toContain("When the owner forbids or defers an action");
    expect(prompt).toContain("# You are Cuso");
    expect(prompt).toContain(
      "Write to the owner in the language of their latest message in the chat",
    );
    expect(prompt).toContain(
      "Every piece is in it from its title to its last word",
    );
    expect(prompt).not.toContain(
      "is in the language the owner wrote their goal",
    );
    expect(cmo.skills).toEqual(
      expect.arrayContaining([
        "cmo-social-posts",
        "cmo-long-work",
        "cmo-newsletter",
      ]),
    );
    expect(cmo.skills).not.toContain("long-work");
    expect(cmo.capabilities).toEqual(
      expect.arrayContaining([
        "list_social_account_statistics",
        "refresh_social_account_statistics",
        "list_social_post_statistics",
        "get_posting_instructions",
        "wait_for",
        "evaluate_with_jev",
        "read_integration_tool",
        "list_ad_campaigns",
        "get_market_keywords",
        "newsletter_draft_issue",
        "submit_newsletter_issue",
      ]),
    );
    // A person starts and changes ads, and changes contacts; Cuso reads
    // them and keeps audience lists.
    for (const outside of [
      "create_ad_campaign",
      "update_ad_campaign",
      "upsert_contact",
      "update_contact",
      "merge_contacts",
    ])
      expect(cmo.capabilities).not.toContain(outside);
    for (const inside of [
      "search_contacts",
      "count_contacts",
      "manage_contact_lists",
      "add_newsletter_subscribers_from_contacts",
    ])
      expect(cmo.capabilities).toContain(inside);
  });

  it("dreams at night like every Soko Bot, pointing to his daily run", () => {
    const dream = SOKO_BOT_CMO_RHYTHMS.find(
      (rhythm) => rhythm.key === "dreaming",
    );
    expect(dream?.prompt).toContain("update_memory");
    expect(dream?.prompt).not.toContain("stand-up");
    expect(isCmoScheduleKey("dreaming")).toBe(false);
  });

  it("describes both CMO tools", () => {
    for (const capability of SOKO_BOT_CMO_CAPABILITIES) {
      expect(SOKO_BOT_TOOL_DESCRIPTIONS[capability]).toBeTruthy();
    }
  });
});

describe("cmoSaveBrandBrainInputSchema", () => {
  const question = {
    id: "q1",
    question: "Do customers come from Google?",
    statement: "Customers come from Google",
    section: "marketing" as const,
  };

  it("accepts reveal, marketingToday or questions on their own", () => {
    const reveal = { positioning: "Rockets", insights: [], buyers: [] };
    expect(cmoSaveBrandBrainInputSchema.safeParse({ reveal }).success).toBe(
      true,
    );
    expect(
      cmoSaveBrandBrainInputSchema.safeParse({
        marketingToday: { summary: "Weekly posts" },
      }).success,
    ).toBe(true);
    expect(
      cmoSaveBrandBrainInputSchema.safeParse({ questions: [question] }).success,
    ).toBe(true);
  });

  it("rejects an empty questions list so it cannot wipe stored ones", () => {
    expect(
      cmoSaveBrandBrainInputSchema.safeParse({ questions: [] }).success,
    ).toBe(false);
  });

  it("rejects a save that sends nothing", () => {
    expect(cmoSaveBrandBrainInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("cmoMayExecute", () => {
  it("executes only once the strategy is approved and paid for", () => {
    const run = (approved: boolean, subscribed: boolean) =>
      cmoMayExecute({ approved, subscribed }).ok;
    expect(run(false, true)).toBe(false);
    expect(run(true, false)).toBe(false);
    expect(run(true, true)).toBe(true);
  });

  it("says why it refused", () => {
    const refused = cmoMayExecute({ approved: false, subscribed: true });
    expect(refused.ok === false && refused.reason).toMatch(/approved/);
  });
});

describe("CMO strategy and rhythms", () => {
  it("fills defaults the bot can leave out", () => {
    const strategy = marketingStrategyPlanSchema.parse({
      month: "2026-10",
      summary: "Grow LinkedIn reach with founder-led posts.",
      goals: ["More demo requests"],
      pillars: ["Product stories"],
      channels: [{ channel: "LinkedIn", cadence: "3 posts a week" }],
      calendar: [
        {
          id: "w1-mon",
          date: "2026-10-05",
          channel: "linkedin",
          title: "Why we built it",
          format: "post",
          status: "idea",
        },
      ],
    });
    expect(strategy.channels[0]).toEqual({
      channel: "linkedin",
      cadence: "3 posts a week",
    });
    expect(strategy.previews).toEqual([]);
  });

  it("keeps a patch record for every entry the calendar holds", () => {
    // cmo-v3 adds weeks two to four with part patch: 153 of 204 pieces.
    const entry = (index: number) => ({
      id: `p${index}`,
      date: "2026-10-05",
      channel: "linkedin",
      title: `Piece ${index}`,
      format: "post",
      status: "idea",
    });
    const calendar = Array.from({ length: 204 }, (_, index) => entry(index));
    const strategy = marketingStrategyPlanSchema.parse({
      month: "2026-10",
      summary: "Grow LinkedIn reach with founder-led posts.",
      goals: ["More demo requests"],
      pillars: ["Product stories"],
      channels: [],
      calendar,
      patched: calendar.slice(51).map(({ id }) => ({ id, was: null })),
    });
    expect(strategy.patched).toHaveLength(153);
  });

  it("gives the pillars of an older plan equal shares", () => {
    const pillars = (value: unknown) =>
      marketingStrategyPlanSchema.shape.pillars.parse(value);
    expect(pillars(["Recipes", "Delivery", "Prices"])).toEqual([
      { name: "Recipes", share: 33 },
      { name: "Delivery", share: 33 },
      { name: "Prices", share: 33 },
    ]);
    expect(pillars([{ name: "Recipes", share: 70, why: "Why" }])).toEqual([
      { name: "Recipes", share: 70, why: "Why" },
    ]);
  });

  it("saves only what Cuso runs, mapping older names first", () => {
    const plan = (channel: string, format: string) => ({
      strategy: {
        month: "2026-10",
        summary: "Grow.",
        goals: ["More demos"],
        pillars: [],
        channels: [{ channel, cadence: "Weekly" }],
        calendar: [
          {
            id: "a",
            date: "2026-10-05",
            channel,
            title: "One",
            format,
            status: "idea",
          },
        ],
      },
    });
    const saved = cmoSaveStrategyInputSchema.parse(plan("twitter", "thread"));
    expect(saved.strategy.channels[0]?.channel).toBe("x");
    expect(saved.strategy.calendar[0]).toMatchObject({
      channel: "x",
      format: "reply",
    });
    // SEO has its own tab: a strategy never plans an article or a page fix.
    const seo = cmoSaveStrategyInputSchema.safeParse(
      plan("website", "article"),
    );
    expect(seo.success).toBe(false);
    expect(seo.error?.issues[0]?.message).toContain("Use a channel Cuso runs");
    expect(
      cmoSaveStrategyInputSchema.parse(plan("linkedin", "carousel")).strategy
        .calendar[0]?.format,
    ).toBe("images");
    const refused = cmoSaveStrategyInputSchema.safeParse(
      plan("reddit", "thread"),
    );
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toContain("linkedin");
    const withSkipped = plan("linkedin", "post");
    withSkipped.strategy.calendar.push({
      id: "old",
      date: "2026-10-06",
      channel: "reddit",
      title: "Retired",
      format: "thread",
      status: "skipped",
    });
    expect(cmoSaveStrategyInputSchema.safeParse(withSkipped).success).toBe(
      true,
    );
  });

  it("takes only the named part, so filler never replaces the saved plan", () => {
    const entry = {
      id: "a",
      date: "2026-10-05",
      channel: "linkedin",
      title: "One",
      format: "post",
      status: "idea",
    };
    // Tool calls fill every field: the calendar call sends empty lists too.
    const calendarOnly = parseCmoStrategySave({
      part: "calendar",
      strategy: { mix: [], funnel: [], openQuestions: [], calendar: [entry] },
    });
    expect(Object.keys(calendarOnly)).toEqual(["calendar"]);
    // And the plan call may send the calendar as a placeholder string.
    const planOnly = parseCmoStrategySave({
      part: "plan",
      strategy: { summary: "Grow.", calendar: "unchanged" },
    });
    expect(planOnly.summary).toBe("Grow.");
    expect("calendar" in planOnly).toBe(false);
  });

  it("takes from a patch only the entries and fields it really sent", () => {
    const entry = {
      id: "a",
      date: "2026-10-05",
      channel: "linkedin",
      title: "One",
      format: "post",
      status: "idea",
    };
    const patch = parseCmoStrategySave({
      part: "patch",
      strategy: {
        pace: { level: "active", why: "The owner asked.", perWeek: 5 },
        mix: [],
        funnel: [],
        calendar: [entry],
      },
    });
    expect(Object.keys(patch).sort()).toEqual(["calendar", "pace"]);
    expect(patch.calendar).toHaveLength(1);
  });

  it("drops a patch field sent without a value, so it never wipes the plan's", () => {
    const patch = parseCmoStrategySave({
      part: "patch",
      strategy: { summary: "Grow.", channels: undefined, calendar: undefined },
    });
    expect(Object.keys(patch)).toEqual(["summary"]);
  });

  it("proposes only channels Cuso runs that the plan leaves out", () => {
    const proposing = (channel: string) => ({
      strategy: {
        month: "2026-10",
        summary: "Grow.",
        goals: ["More demos"],
        pillars: [],
        channels: [{ channel: "linkedin", cadence: "Weekly" }],
        calendar: [],
        proposals: [
          {
            channel,
            what: "Image posts",
            why: "Buyers are there",
            perMonth: 8,
          },
        ],
      },
    });
    // TikTok is a channel Cuso runs: the owner confirms each video.
    for (const run of ["instagram", "tiktok"]) {
      expect(cmoSaveStrategyInputSchema.safeParse(proposing(run)).success).toBe(
        true,
      );
    }
    for (const outside of ["reddit", "linkedin"]) {
      expect(
        cmoSaveStrategyInputSchema.safeParse(proposing(outside)).success,
      ).toBe(false);
    }
    // A plan saved before proposals named a channel still reads.
    expect(
      marketingStrategyPlanSchema.parse({
        ...proposing("instagram").strategy,
        proposals: [{ name: "Reddit", what: "Answers", why: "Threads" }],
      }).proposals,
    ).toEqual([]);
  });

  it("names its rhythms", () => {
    expect(SOKO_BOT_CMO_SCHEDULES.map((schedule) => schedule.key)).toEqual([
      "cmo-daily-run",
      "cmo-weekly-review",
      "cmo-monthly-strategy",
      "cmo-brand-refresh",
      "cmo-strategy-nudge",
    ]);
    for (const schedule of SOKO_BOT_CMO_SCHEDULES) {
      expect(schedule.when.length).toBeGreaterThan(0);
    }
    expect(isCmoScheduleKey("cmo-daily-run")).toBe(true);
    expect(isCmoScheduleKey("standup")).toBe(false);
  });
});

describe("cmoRoutineSkipReason", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 60 * 60 * 1_000);
  const state = (
    patch: Partial<Parameters<typeof cmoRoutineSkipReason>[1]>,
  ) => ({
    brandBrain: true,
    strategySavedAt: hoursAgo(10),
    strategyApproved: false,
    now,
    ...patch,
  });

  it("runs nothing that executes before the strategy is approved", () => {
    for (const key of [
      "cmo-daily-run",
      "cmo-weekly-review",
      "cmo-monthly-strategy",
    ] as const) {
      expect(cmoRoutineSkipReason(key, state({}))).not.toBeNull();
      expect(
        cmoRoutineSkipReason(key, state({ strategyApproved: true })),
      ).toBeNull();
    }
  });

  it("refreshes the Brand Brain only once there is one", () => {
    expect(cmoRoutineSkipReason("cmo-brand-refresh", state({}))).toBeNull();
    expect(
      cmoRoutineSkipReason("cmo-brand-refresh", state({ brandBrain: false })),
    ).not.toBeNull();
  });

  it("reminds once, in the one daily slot 48 to 72 hours after the proposal", () => {
    const nudge = (hours: number, approved = false) =>
      cmoRoutineSkipReason(
        "cmo-strategy-nudge",
        state({ strategySavedAt: hoursAgo(hours), strategyApproved: approved }),
      );
    expect(nudge(47)).not.toBeNull();
    expect(nudge(48)).toBeNull();
    expect(nudge(71)).toBeNull();
    expect(nudge(72)).not.toBeNull();
    expect(nudge(50, true)).not.toBeNull();
    expect(
      cmoRoutineSkipReason(
        "cmo-strategy-nudge",
        state({ strategySavedAt: null }),
      ),
    ).not.toBeNull();
  });
});

describe("CMO scenarios", () => {
  const scenario = CMO_SCENARIOS.find(
    (candidate) => candidate.id === "cmo-asks-before-planning",
  );
  const turn = (finalAnswer: string, capability = "save_brand_brain") => ({
    status: "COMPLETED",
    route: "MANAGE_WORK",
    finalAnswer,
    toolCalls: [{ capability, status: "COMPLETED", result: {} }],
    events: [],
    delegations: [],
    decisions: [],
  });

  it("fails a strategy full of gaps", () => {
    if (!scenario) throw new Error("missing scenario");
    const result = evaluateScenario(
      scenario,
      turn(
        "Here is your provisional plan: How to choose [confirmed solution category].",
        "save_strategy",
      ),
    );
    const failed = result.checks.filter((check) => !check.pass);
    // Planned anyway, wrote gaps, and asked nothing.
    expect(failed.length).toBeGreaterThanOrEqual(3);
  });

  it("passes asking the founder before planning", () => {
    if (!scenario) throw new Error("missing scenario");
    const result = evaluateScenario(
      scenario,
      turn(
        "I could not read acme-unknown.example. Three quick questions: What do you sell, in one line? Who buys it? What should a new customer do first?",
      ),
    );
    expect(result.checks.filter((check) => !check.pass)).toEqual([]);
  });
});

describe("Brand Brain research", () => {
  it("looks for the brand's own story, prices on shop pages, and keeps sister brands out of competitors", async () => {
    const { CMO_SKILLS } = await import("../versions/cmo-skills.js");
    const skill = CMO_SKILLS.find((entry) => entry.id === "cmo-brand-brain");
    expect(skill?.content).toContain("What it is famous for");
    expect(skill?.content).toContain("open one before you give up");
    expect(skill?.content).toContain(
      "(a sister brand), a supplier and a partner are never competitors",
    );
    expect(skill?.content).toContain(
      "never a page title or a product name alone",
    );
  });
});

describe("launch videos", () => {
  it("builds every scene from the brand's real pictures and evens the sound out", async () => {
    const { CMO_SKILLS } = await import("../versions/cmo-skills.js");
    const skill = CMO_SKILLS.find((entry) => entry.id === "cmo-launch-video");
    expect(skill?.content).toContain("Never draw a logo or use a placeholder");
    expect(skill?.content).toContain(
      "Every scene shows one of those real pictures",
    );
    expect(skill?.content).toContain("loudnorm=I=-14");
    expect(skill?.content).toContain('grep -E "^\\s+I:"');
    expect(skill?.content).toContain('workspacePath "video/out/final.mp4"');
  });
});

describe("picture styles", () => {
  it("tells Cuso on cmo-v1 to give pictures the look of an old print, once", async () => {
    const { CMO_SKILLS } = await import("../versions/cmo-skills.js");
    const skill = CMO_SKILLS.find((entry) => entry.id === "cmo-production");
    expect(skill?.content.split("## Picture styles")).toHaveLength(2);
    expect(skill?.content).toContain("call find_style_references");
    expect(skill?.content).toContain("Put its id in styleReferenceId");
    expect(SOKO_BOT_CMO_CAPABILITIES).toContain("find_style_references");
    expect(
      composeSystemPrompt(getSokoBotVersion(CMO_SOKO_BOT_VERSION_ID)),
    ).toContain("## Picture styles");
  });

  it("checks that a styled picture goes through the reference library", () => {
    const scenario = CMO_SCENARIOS.find(
      (entry) => entry.id === "cmo-picture-style",
    );
    expect(scenario?.expect.tools).toEqual(["find_style_references"]);
  });
});

describe("pictures of the month", () => {
  it("tells Cuso to style every picture, each slide with its own words", async () => {
    const { CMO_SKILLS } = await import("../versions/cmo-skills.js");
    const skill = CMO_SKILLS.find((entry) => entry.id === "cmo-production");
    expect(skill?.content).toContain(
      "Every piece with a picture takes the look of an old print",
    );
    expect(skill?.content).toContain("slideHeadlines: one entry per slide");
    expect(skill?.content).not.toContain("Decide per piece");
    expect(
      cmoCalendarEntrySchema.safeParse({
        id: "c1",
        date: "2026-12-01",
        channel: "instagram",
        title: "Three steps",
        format: "carousel",
        status: "draft",
        slideHeadlines: ["Review the drafts", "Then it goes live"],
      }).success,
    ).toBe(true);
  });
});

describe("pictures in chat", () => {
  it("tells Cuso to make a chat post's picture in a library style", async () => {
    const { CMO_SKILLS } = await import("../versions/cmo-skills.js");
    const skill = CMO_SKILLS.find((entry) => entry.id === "cmo-production");
    expect(skill?.content).toContain(
      "In chat, a picture for a post or an ad goes the same way",
    );
    expect(skill?.content).toContain("the reference's id as styleReferenceId");
    expect(skill?.content).toContain("maxCredits 25");
    expect(skill?.content).toContain(
      "pass that picture in referenceFileIds as well",
    );
    const scenario = CMO_SCENARIOS.find(
      (entry) => entry.id === "cmo-post-with-picture",
    );
    expect(scenario?.expect.tools).toEqual([
      "find_style_references",
      "generate_image",
    ]);
  });
});

describe("what Cuso is told a talking video costs", () => {
  const credits = (length: number, siteShots = false) =>
    creditsPerTalkingVideoCents(TALKING_VIDEO_PRICE, "x".repeat(length), {
      siteShots,
    });

  it("tells the strategy the price a 150 to 400 character script is charged, with the music and B-roll a month's video has", () => {
    const strategy = CMO_SKILLS.filter((skill) =>
      skill.id.startsWith("cmo-strategy"),
    );
    expect(strategy.length).toBeGreaterThan(0);
    const extras = 60;
    const from = Math.round((credits(150) + extras) / 10) * 10;
    const to = Math.round((credits(400, true) + extras) / 10) * 10;
    for (const skill of strategy) {
      expect(skill.content).toContain(`costs about ${from} to ${to} credits`);
      expect(skill.content).not.toContain("200 to 450 credits");
    }
  });

  it("quotes the same price in the tool that makes one", () => {
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.generate_talking_video).toContain(
      `a 150-character script costs about ${credits(150)})`,
    );
  });
});

describe("cmo-v7", () => {
  it("is the version a new hire gets", () => {
    expect(CMO_SOKO_BOT_VERSION_ID).toBe("cmo-v7");
  });

  it("answers a change without repeating the card or naming internals", () => {
    expect(cmoV6.systemPrompt).toContain("then answer in one or two sentences");
    expect(cmoV7.systemPrompt).not.toContain(
      "then answer in one or two sentences",
    );
    expect(cmoV7.systemPrompt).toContain(
      "never says what changed or what stayed the same",
    );
    expect(cmoV7.systemPrompt).toContain(
      "Never name your tools, saves, checks or reviews",
    );
    // The month written at once comes with it.
    expect(cmoV7.skills).toEqual(cmoV6.skills);
  });
});
