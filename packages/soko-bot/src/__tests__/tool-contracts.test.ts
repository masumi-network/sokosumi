import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  isSokoBotDecisionTarget,
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_TOOL_DESCRIPTIONS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotArchiveTaskInputSchema,
  sokoBotCreateTaskInputSchema,
  sokoBotListTasksInputSchema,
  sokoBotReplyToTaskInputSchema,
  sokoBotUpdateAssignedTaskInputSchema,
  sokoBotUpdateTaskInputSchema,
} from "../index.js";

describe("Soko Bot tool contracts", () => {
  it("defines one input schema and description for every capability", () => {
    expect(Object.keys(SOKO_BOT_TOOL_INPUT_SCHEMAS).sort()).toEqual(
      [...SOKO_BOT_CAPABILITIES].sort(),
    );
    expect(Object.keys(SOKO_BOT_TOOL_DESCRIPTIONS).sort()).toEqual(
      [...SOKO_BOT_CAPABILITIES].sort(),
    );
  });

  it("cannot set or filter by the event-only CREATED status", () => {
    expect(
      sokoBotCreateTaskInputSchema.safeParse({ name: "x", status: "CREATED" })
        .success,
    ).toBe(false);
    expect(
      sokoBotUpdateTaskInputSchema.safeParse({
        taskId: "t",
        status: "CREATED",
      }).success,
    ).toBe(false);
    expect(
      sokoBotReplyToTaskInputSchema.safeParse({
        taskId: "t",
        comment: "c",
        status: "CREATED",
      }).success,
    ).toBe(false);
    expect(
      sokoBotUpdateAssignedTaskInputSchema.safeParse({
        taskId: "t",
        comment: "c",
        status: "CREATED",
      }).success,
    ).toBe(false);
    expect(
      sokoBotListTasksInputSchema.safeParse({ status: "CREATED" }).success,
    ).toBe(false);
  });

  it("normalizes task input at shared Eve/Core boundary", () => {
    expect(
      sokoBotCreateTaskInputSchema.parse({ name: "  Launch campaign  " }),
    ).toMatchObject({ name: "Launch campaign", status: "DRAFT" });
  });

  it("requires an exact prior-read revision for archival and keeps one archive tool", () => {
    const archive = {
      taskId: "task-one",
      expectedUpdatedAt: "2026-09-26T12:00:00.000Z",
    };
    expect(sokoBotArchiveTaskInputSchema.parse(archive)).toEqual(archive);
    expect(
      sokoBotArchiveTaskInputSchema.safeParse({ taskId: "task-one" }).success,
    ).toBe(false);
    expect(
      sokoBotArchiveTaskInputSchema.safeParse({
        ...archive,
        expectedUpdatedAt: "yesterday",
      }).success,
    ).toBe(false);
    expect(
      sokoBotArchiveTaskInputSchema.safeParse({ ...archive, taskId: "" })
        .success,
    ).toBe(false);
    expect(
      sokoBotArchiveTaskInputSchema.safeParse({
        ...archive,
        status: "CANCELED",
      }).success,
    ).toBe(false);
    expect(
      sokoBotUpdateTaskInputSchema.safeParse({ ...archive, archive: true })
        .success,
    ).toBe(false);
    expect(isSokoBotDecisionTarget("archive_task")).toBe(true);
  });

  it("restricts decision requests to supported mutation targets", () => {
    expect(isSokoBotDecisionTarget("hire_agent")).toBe(true);
    expect(isSokoBotDecisionTarget("clarify_scope")).toBe(false);
  });

  it("converts write_table_rows to an object schema without an intersection root", () => {
    const jsonSchema = z.toJSONSchema(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.write_table_rows,
    );

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.allOf).toBeUndefined();
    expect(jsonSchema.properties).toHaveProperty("tableId");
    expect(jsonSchema.required).toContain("tableId");
  });

  it("keeps write_table_rows validation and the 100-row bound", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.write_table_rows;
    const tableId = "00000000-0000-4000-8000-000000000001";
    const row = (value: string) => ({
      values: {
        "00000000-0000-4000-8000-000000000002": value,
      },
    });

    expect(
      schema.safeParse({
        key: "batch",
        tableId,
        insert: Array.from({ length: 100 }, (_, index) => row(String(index))),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        key: "batch",
        tableId,
        insert: Array.from({ length: 101 }, (_, index) => row(String(index))),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ key: "batch", tableId, insert: [], patch: [] })
        .success,
    ).toBe(false);
  });
});

describe("newsletter read tools", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const reads = [
    "get_newsletter",
    "list_newsletter_issues",
    "get_newsletter_issue",
    "get_newsletter_analytics",
    "list_newsletter_subscribers",
  ] as const;
  const issueId = "44444444-4444-4444-8444-444444444444";
  const valid = (capability: (typeof reads)[number]) =>
    capability === "get_newsletter_issue"
      ? { projectId, issueId }
      : { projectId };

  it.each(reads)(
    "%s needs a project and takes no approval or send flag",
    (capability) => {
      const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS[capability];
      expect(schema.safeParse(valid(capability)).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
      for (const field of ["approve", "autoApprove", "schedule", "send"])
        expect(
          schema.safeParse({ ...valid(capability), [field]: true }).success,
        ).toBe(false);
    },
  );

  it.each(reads)("%s tells the model content is untrusted", (capability) => {
    expect(SOKO_BOT_TOOL_DESCRIPTIONS[capability]).toMatch(/untrusted/i);
  });

  it("pages lists by default and bounds the page size", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.list_newsletter_issues.parse({ projectId }),
    ).toEqual({ projectId, limit: 20 });
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.list_newsletter_subscribers.safeParse({
        projectId,
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.get_newsletter_analytics.safeParse({
        projectId,
        from: "2026-02-30",
      }).success,
    ).toBe(false);
  });
});

describe("evaluate_with_jev input", () => {
  const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.evaluate_with_jev;
  const triage = {
    key: "mail0",
    question: "How urgent is mail0 for the owner?",
    options: [
      { name: "URGENT", criteria: "Needs the owner today." },
      { name: "BULK", criteria: "Nothing to do." },
    ],
  };
  const yesNo = { key: "asksForMoney", question: "Does mail0 ask for money?" };

  it("takes a short state and 1–10 yes/no or choice questions", () => {
    expect(
      schema.safeParse({
        state: '{"mail0":{"subject":"Payout failed"}}',
        questions: [triage, yesNo],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ state: "x", questions: [] }).success).toBe(false);
    expect(
      schema.safeParse({
        state: "x",
        questions: Array.from({ length: 11 }, (_, index) => ({
          ...yesNo,
          key: `q${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it("bounds the state and refuses ambiguous keys and options", () => {
    const invalid = (input: unknown) => !schema.safeParse(input).success;
    expect(invalid({ state: "x".repeat(12_001), questions: [yesNo] })).toBe(
      true,
    );
    expect(invalid({ state: "x", questions: [yesNo, yesNo] })).toBe(true);
    expect(
      invalid({ state: "x", questions: [{ ...yesNo, key: "1 bad" }] }),
    ).toBe(true);
    expect(
      invalid({
        state: "x",
        questions: [{ ...triage, options: [triage.options[0]] }],
      }),
    ).toBe(true);
    expect(
      invalid({
        state: "x",
        questions: [
          { ...triage, options: [triage.options[0], triage.options[0]] },
        ],
      }),
    ).toBe(true);
  });

  it("converts to a plain object schema for the model", () => {
    const jsonSchema = z.toJSONSchema(schema);
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.required).toEqual(["state", "questions"]);
  });
});

describe("Ads read tool contracts", () => {
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const inputs = {
    list_ad_accounts: { projectId },
    list_ad_campaigns: { projectId, accountId },
    find_ad_targeting: { projectId, accountId },
    get_market_keywords: { projectId },
    get_ad_campaign: { projectId, accountId, campaignId: "23850000000000000" },
  } as const;

  it.each(Object.keys(inputs) as (keyof typeof inputs)[])(
    "%s takes strict ids and says the bot never connects ad accounts itself",
    (capability) => {
      const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS[capability];
      expect(schema.safeParse(inputs[capability]).success).toBe(true);
      expect(
        schema.safeParse({ ...inputs[capability], projectId: "nope" }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ ...inputs[capability], workspaceId: "x" }).success,
      ).toBe(false);
      expect(SOKO_BOT_TOOL_DESCRIPTIONS[capability]).toMatch(/never connect/i);
    },
  );

  it("defaults the campaign range and rejects unknown ranges", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_ad_campaigns;
    expect(schema.parse(inputs.list_ad_campaigns).range).toBe("LAST_30_DAYS");
    expect(
      schema.safeParse({ ...inputs.list_ad_campaigns, range: "LAST_YEAR" })
        .success,
    ).toBe(false);
  });

  it("points campaign creation at the Market keywords", () => {
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.create_ad_campaign).toContain(
      "get_market_keywords",
    );
  });

  it("searches locations only for a non-empty query", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.find_ad_targeting;
    expect(
      schema.safeParse({ ...inputs.find_ad_targeting, locationQuery: "Berlin" })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...inputs.find_ad_targeting, locationQuery: "" })
        .success,
    ).toBe(false);
  });
});

describe("create_ad_campaign contract", () => {
  const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.create_ad_campaign;
  const base = {
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Spring",
    dailyBudget: 25,
  };
  const common = {
    locationIds: ["1003854"],
    languageIds: ["1001"],
    finalUrl: "https://example.com",
  };
  const search = {
    type: "SEARCH",
    ...common,
    keywords: [{ text: "running shoes", matchType: "EXACT" }],
    headlines: ["One", "Two", "Three"],
    descriptions: ["First line.", "Second line."],
  };
  const display = {
    type: "DISPLAY",
    ...common,
    businessName: "Sokosumi",
    headlines: ["One"],
    longHeadline: "A longer headline",
    descriptions: ["First line."],
    images: [
      { fileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: "LANDSCAPE" },
      { fileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "SQUARE" },
    ],
  };

  it.each([search, display])("takes a valid $type campaign", (google) => {
    expect(schema.safeParse({ ...base, google }).success).toBe(true);
  });

  it("refuses unknown keys, bad ids and a Display image that is not a file id", () => {
    for (const bad of [
      { ...base, google: search, workspaceId: "x" },
      { ...base, google: { ...search, status: "ENABLED" } },
      { ...base, google: { ...search, locationIds: ["Berlin"] } },
      { ...base, google: { ...search, headlines: ["One", "Two"] } },
      { ...base, google: { ...display, images: [{ role: "SQUARE" }] } },
      {
        ...base,
        google: { ...display, images: [{ fileId: "x", role: "SQUARE" }] },
      },
      { ...base, dailyBudget: 0, google: search },
    ])
      expect(schema.safeParse(bad).success).toBe(false);
  });

  it("says the campaign is paused and the bot never connects accounts", () => {
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.create_ad_campaign).toMatch(/paused/i);
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.create_ad_campaign).toMatch(
      /never connect/i,
    );
  });
});

describe("ad campaign management contracts", () => {
  const base = {
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    campaignId: "23850000000000000",
  };

  it("defaults the details range and takes a digit campaign id only", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.get_ad_campaign;
    expect(schema.parse(base).range).toBe("LAST_30_DAYS");
    expect(schema.safeParse({ ...base, range: "LAST_YEAR" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...base, campaignId: "brand" }).success).toBe(
      false,
    );
  });

  describe("update_ad_campaign", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_ad_campaign;

    // Google writes a budget and a status separately, so one change per call
    // keeps a refused call honestly unsent.
    it("takes a status or a budget, one per call, and nothing else", () => {
      for (const change of [
        { status: "PAUSED" },
        { status: "ACTIVE" },
        { dailyBudget: 12.5 },
      ])
        expect(schema.safeParse({ ...base, ...change }).success).toBe(true);
      for (const bad of [
        base,
        { ...base, status: "PAUSED", dailyBudget: 12.5 },
        { ...base, status: "REMOVED" },
        { ...base, dailyBudget: 0 },
        { ...base, status: "PAUSED", workspaceId: "x" },
      ])
        expect(schema.safeParse(bad).success).toBe(false);
    });

    it("lets the bot resume only when the owner asks", () => {
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.update_ad_campaign).toMatch(
        /only resume when the owner asks/i,
      );
    });
  });

  describe("delete_ad_campaign", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.delete_ad_campaign;

    it("takes the project, account and a digit campaign id, and nothing else", () => {
      expect(schema.safeParse(base).success).toBe(true);
      for (const bad of [
        { ...base, campaignId: "brand" },
        { projectId: base.projectId, accountId: base.accountId },
        { ...base, status: "REMOVED" },
        { ...base, workspaceId: "x" },
      ])
        expect(schema.safeParse(bad).success).toBe(false);
    });

    it("tells the bot it cannot be undone and to prefer pausing", () => {
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.delete_ad_campaign).toMatch(
        /cannot be undone/i,
      );
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.delete_ad_campaign).toContain(
        "update_ad_campaign",
      );
    });
  });

  describe("edit_ad_campaign", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.edit_ad_campaign;
    const common = {
      locationIds: ["1003854"],
      languageIds: ["1001"],
      finalUrl: "https://example.com",
    };
    const display = {
      type: "DISPLAY",
      ...common,
      businessName: "Sokosumi",
      headlines: ["One"],
      longHeadline: "A longer headline",
      descriptions: ["First line."],
      images: [
        { assetId: "123456", role: "LANDSCAPE" },
        { fileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", role: "SQUARE" },
      ],
    };
    const edit = { ...base, name: "Spring", dailyBudget: 25 };

    it("keeps images by assetId and adds new ones by fileId", () => {
      expect(schema.safeParse({ ...edit, google: display }).success).toBe(true);
    });

    it("refuses an image with both or neither id, and a Search spec with unknown keys", () => {
      for (const image of [
        { assetId: "123456", fileId: display.images[1].fileId, role: "SQUARE" },
        { assetId: "not-digits", role: "SQUARE" },
        { role: "SQUARE" },
      ])
        expect(
          schema.safeParse({
            ...edit,
            google: { ...display, images: [image] },
          }).success,
        ).toBe(false);
      expect(
        schema.safeParse({
          ...edit,
          google: {
            type: "SEARCH",
            ...common,
            keywords: [{ text: "shoes", matchType: "EXACT" }],
            headlines: ["One", "Two", "Three"],
            descriptions: ["First line.", "Second line."],
            status: "ENABLED",
          },
        }).success,
      ).toBe(false);
    });

    it("tells the bot to read the campaign first and leave the status alone", () => {
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.edit_ad_campaign).toContain(
        "get_ad_campaign",
      );
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.edit_ad_campaign).toContain(
        "update_ad_campaign",
      );
    });
  });
});
