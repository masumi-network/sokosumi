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

describe("newsletter issue write tools", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const issueId = "44444444-4444-4444-8444-444444444444";
  const content = [
    { type: "heading", level: 2, text: "News" },
    { type: "image", url: "https://example.com/a.png", alt: "A" },
    { type: "divider" },
  ];
  const create = SOKO_BOT_TOOL_INPUT_SCHEMAS.create_newsletter_issue;
  const update = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_newsletter_issue;
  const remove = SOKO_BOT_TOOL_INPUT_SCHEMAS.delete_newsletter_issue;
  const created = { projectId, subject: "Hi", template: "IMAGES", content };

  it("creates from exact blocks and never from raw HTML or http links", () => {
    expect(create.safeParse(created).success).toBe(true);
    expect(create.safeParse({ ...created, content: [] }).success).toBe(false);
    expect(
      create.safeParse({
        ...created,
        content: [{ type: "html", html: "<b>hi</b>" }],
      }).success,
    ).toBe(false);
    expect(
      create.safeParse({
        ...created,
        content: [{ type: "button", label: "Go", url: "http://example.com" }],
      }).success,
    ).toBe(false);
  });

  it("edits need the read revision, a change, and content with a new template", () => {
    const ref = { projectId, issueId, revision: 2 };
    expect(update.safeParse({ ...ref, subject: "New" }).success).toBe(true);
    expect(update.safeParse({ ...ref, previewText: null }).success).toBe(true);
    expect(update.safeParse(ref).success).toBe(false);
    expect(
      update.safeParse({ projectId, issueId, subject: "New" }).success,
    ).toBe(false);
    expect(update.safeParse({ ...ref, template: "TEXT" }).success).toBe(false);
    expect(
      update.safeParse({ ...ref, template: "TEXT", content }).success,
    ).toBe(true);
    expect(remove.safeParse(ref).success).toBe(true);
    expect(remove.safeParse({ projectId, issueId }).success).toBe(false);
  });

  it.each([
    "create_newsletter_issue",
    "update_newsletter_issue",
    "delete_newsletter_issue",
  ] as const)("%s leaves approving and sending to a person", (capability) => {
    const description = SOKO_BOT_TOOL_DESCRIPTIONS[capability];
    expect(description).toMatch(/untrusted/i);
    expect(description).toMatch(
      /never approves, schedules or sends|Newsletter UI/i,
    );
  });

  it("says an edit sends the issue back for approval and deletes need the owner", () => {
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.update_newsletter_issue).toMatch(
      /returns the issue to DRAFT.*approve it again/,
    );
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.delete_newsletter_issue).toMatch(
      /owner explicitly asks/,
    );
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
