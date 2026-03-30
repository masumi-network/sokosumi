import { InputType } from "@sokosumi/masumi/types";
import { describe, expect, it } from "vitest";

import { getReadonlyNoneInputValues } from "@/lib/utils/job-input-transformers";

describe("getReadonlyNoneInputValues", () => {
  it("collects readonly none values from input fields", () => {
    const result = getReadonlyNoneInputValues([
      {
        id: "none-with-description",
        type: InputType.NONE,
        name: "Readonly",
        data: { description: "Preset markdown value" },
      },
      {
        id: "text-field",
        type: InputType.TEXT,
        name: "Text",
        data: { placeholder: "Type here" },
        validations: [],
      },
      {
        id: "none-without-description",
        type: InputType.NONE,
        name: "Readonly empty",
      },
    ]);

    expect(result).toEqual({
      "none-with-description": "Preset markdown value",
    });
  });
});
