import { describe, expect, it } from "vitest";
import { tableCreationFeedback } from "./table-creation-feedback";

describe("tableCreationFeedback", () => {
  it("reports rows inserted by creation and preserves the confirmed table", () => {
    const result = {
      table: { id: "table-1", title: "Launch findings" },
      url: "/drive/tables/table-1",
      instruction: "Enrich in batches.",
    };
    const feedback = tableCreationFeedback(
      { rows: [{ name: "A" }, { name: "B" }] },
      result,
    );
    expect(feedback).toEqual({
      ...result,
      initialRowCount: 2,
      instruction: expect.stringContaining("2 initial rows already inserted"),
    });
    expect((feedback as { instruction: string }).instruction).toContain(
      "Do not insert those rows again",
    );
  });

  it("identifies an empty table without implying any inserted rows", () => {
    expect(
      tableCreationFeedback({}, { table: { id: "table-1" } }),
    ).toMatchObject({ initialRowCount: 0 });
  });

  it.each([
    [null, { table: { id: "table-1" } }],
    [{ rows: null }, { table: { id: "table-1" } }],
    [{ rows: [] }, { error: "failed" }],
    [{ rows: [] }, null],
  ])(
    "does not invent creation evidence for malformed input or results",
    (input, result) => {
      expect(tableCreationFeedback(input, result)).toBe(result);
    },
  );
});
