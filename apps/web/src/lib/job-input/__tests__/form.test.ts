import { prepareInputValues, JobInputsFormSchemaType } from "@/lib/job-input";

describe("prepareInputValues", () => {
  it("serializes Date values and removes null/undefined entries", () => {
    const firstDate = new Date("2026-01-19T00:00:00.000Z");
    const secondDate = new Date("2026-02-01T10:00:00.000Z");

    const values = {
      startDate: firstDate,
      dateRange: [firstDate, secondDate],
      count: 2,
      optional: null,
      unset: undefined,
    } as unknown as JobInputsFormSchemaType;

    const result = prepareInputValues(values);
    expect(result).toEqual({
      startDate: firstDate.toISOString(),
      dateRange: [firstDate.toISOString(), secondDate.toISOString()],
      count: 2,
    });
  });
});
