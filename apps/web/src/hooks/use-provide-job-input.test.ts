import { describe, expect, it } from "vitest";

import { mergeReadonlyInputValues } from "@/lib/utils/job-input-transformers";

describe("mergeReadonlyInputValues", () => {
  it("returns transformed payload when readonly values are absent", () => {
    const inputData = { editable: "value" };

    expect(mergeReadonlyInputValues(inputData)).toEqual(inputData);
  });

  it("adds readonly none values to payload", () => {
    const inputData = { editableField: "user value" };
    const readonlyInputValues = {
      readonlyField: "original readonly value",
    };

    expect(mergeReadonlyInputValues(inputData, readonlyInputValues)).toEqual({
      editableField: "user value",
      readonlyField: "original readonly value",
    });
  });

  it("keeps keys in input schema order when readonly values are merged", () => {
    const inputData = {
      editableFirst: "first value",
      editableThird: "third value",
    };
    const readonlyInputValues = {
      readonlySecond: "second readonly value",
    };
    const inputFieldIdsInOrder = [
      "editableFirst",
      "readonlySecond",
      "editableThird",
    ];

    const result = mergeReadonlyInputValues(
      inputData,
      readonlyInputValues,
      inputFieldIdsInOrder,
    );

    expect(Object.keys(result)).toEqual(inputFieldIdsInOrder);
    expect(result).toEqual({
      editableFirst: "first value",
      readonlySecond: "second readonly value",
      editableThird: "third value",
    });
  });
});
