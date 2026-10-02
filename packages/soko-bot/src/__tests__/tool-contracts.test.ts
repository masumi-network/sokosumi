import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  isSokoBotDecisionTarget,
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_TOOL_DESCRIPTIONS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotArchiveTaskInputSchema,
  sokoBotCreateTaskInputSchema,
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
