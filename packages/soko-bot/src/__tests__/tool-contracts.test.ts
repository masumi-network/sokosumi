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
