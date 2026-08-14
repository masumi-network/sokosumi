import { InputOptionSchemaType } from "@sokosumi/masumi/schemas";
import { InputType, InputValidation } from "@sokosumi/masumi/types";
import { describe, expect, it } from "vitest";

import { isSingleOption } from "@/components/job-input/util";

describe("isSingleOption", () => {
  function makeOptionField(
    validations?: InputOptionSchemaType["validations"],
  ): InputOptionSchemaType {
    return {
      id: "option",
      type: InputType.OPTION,
      name: "Option",
      data: {
        values: ["A", "B", "C"],
      },
      validations,
    };
  }

  it("returns true when no min/max validations exist", () => {
    expect(isSingleOption(makeOptionField())).toBe(true);
    expect(
      isSingleOption(
        makeOptionField([
          { validation: InputValidation.OPTIONAL, value: "true" },
        ]),
      ),
    ).toBe(true);
  });

  it("returns true when min=1 and max=1", () => {
    expect(
      isSingleOption(
        makeOptionField([
          { validation: InputValidation.MIN, value: "1" },
          { validation: InputValidation.MAX, value: "1" },
        ]),
      ),
    ).toBe(true);
  });

  it("returns false when min/max imply multi-select", () => {
    expect(
      isSingleOption(
        makeOptionField([{ validation: InputValidation.MIN, value: "2" }]),
      ),
    ).toBe(false);
    expect(
      isSingleOption(
        makeOptionField([{ validation: InputValidation.MAX, value: "2" }]),
      ),
    ).toBe(false);
    expect(
      isSingleOption(
        makeOptionField([
          { validation: InputValidation.MIN, value: "1" },
          { validation: InputValidation.MAX, value: "2" },
        ]),
      ),
    ).toBe(false);
  });
});
