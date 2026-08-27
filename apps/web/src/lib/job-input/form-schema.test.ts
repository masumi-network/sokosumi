import {
  InputDateSchemaType,
  InputDatetimeSchemaType,
  InputNumberSchemaType,
  InputOptionSchemaType,
  InputRadioGroupSchemaType,
  InputRangeSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType, InputValidation } from "@sokosumi/masumi/types";
import { describe, expect, it } from "vitest";

import { jobInputsFormSchema } from "@/lib/job-input";

describe("jobInputsFormSchema date and datetime-local validation", () => {
  describe("DATE", () => {
    const dateField: InputDateSchemaType = {
      id: "startDate",
      type: InputType.DATE,
      name: "Start date",
      validations: [
        { validation: InputValidation.MIN, value: "2026-03-01" },
        { validation: InputValidation.MAX, value: "2026-03-31" },
      ],
    };

    const schema = jobInputsFormSchema([dateField]);

    it("accepts YYYY-MM-DD", () => {
      const result = schema.safeParse({ startDate: "2026-03-10" });
      expect(result.success).toBe(true);
    });

    it("rejects full ISO datetime strings", () => {
      const result = schema.safeParse({
        startDate: "2026-03-10T00:00:00.000Z",
      });
      expect(result.success).toBe(false);
    });

    it("applies min and max constraints", () => {
      const belowMinResult = schema.safeParse({ startDate: "2026-02-28" });
      const aboveMaxResult = schema.safeParse({ startDate: "2026-04-01" });

      expect(belowMinResult.success).toBe(false);
      expect(aboveMaxResult.success).toBe(false);
    });

    it("allows nullish values when optional", () => {
      const optionalDateField: InputDateSchemaType = {
        ...dateField,
        validations: [
          ...(dateField.validations ?? []),
          { validation: InputValidation.OPTIONAL, value: "true" },
        ],
      };
      const optionalSchema = jobInputsFormSchema([optionalDateField]);

      expect(optionalSchema.safeParse({ startDate: null }).success).toBe(true);
      expect(optionalSchema.safeParse({}).success).toBe(true);
    });

    it("uses local date for datetime-local min/max bounds (no UTC off-by-one)", () => {
      const dateFieldWithDatetimeLocalBounds: InputDateSchemaType = {
        id: "startDate",
        type: InputType.DATE,
        name: "Start date",
        validations: [
          { validation: InputValidation.MIN, value: "2026-03-10T01:30" },
          { validation: InputValidation.MAX, value: "2026-03-10T23:00" },
        ],
      };
      const schema = jobInputsFormSchema([dateFieldWithDatetimeLocalBounds]);

      const originalTimezone = process.env.TZ;
      process.env.TZ = "Pacific/Auckland";

      try {
        expect(schema.safeParse({ startDate: "2026-03-10" }).success).toBe(
          true,
        );
        expect(schema.safeParse({ startDate: "2026-03-09" }).success).toBe(
          false,
        );
        expect(schema.safeParse({ startDate: "2026-03-11" }).success).toBe(
          false,
        );
      } finally {
        if (originalTimezone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimezone;
        }
      }
    });

    it("keeps timezone-qualified ISO bounds on the same calendar day", () => {
      const dateFieldWithIsoTimestampBounds: InputDateSchemaType = {
        id: "startDate",
        type: InputType.DATE,
        name: "Start date",
        validations: [
          {
            validation: InputValidation.MIN,
            value: "2026-03-10T00:00:00.000+14:00",
          },
          {
            validation: InputValidation.MAX,
            value: "2026-03-10T23:59:59.999-12:00",
          },
        ],
      };
      const schema = jobInputsFormSchema([dateFieldWithIsoTimestampBounds]);

      expect(schema.safeParse({ startDate: "2026-03-09" }).success).toBe(false);
      expect(schema.safeParse({ startDate: "2026-03-10" }).success).toBe(true);
      expect(schema.safeParse({ startDate: "2026-03-11" }).success).toBe(false);
    });
  });

  describe("DATETIME", () => {
    const datetimeField: InputDatetimeSchemaType = {
      id: "startAt",
      type: InputType.DATETIME,
      name: "Start at",
      validations: [
        { validation: InputValidation.MIN, value: "2026-03-10T09:00" },
        { validation: InputValidation.MAX, value: "2026-03-10T12:00" },
      ],
    };

    const schema = jobInputsFormSchema([datetimeField]);

    it("accepts datetime-local strings", () => {
      const result = schema.safeParse({ startAt: "2026-03-10T10:30" });
      expect(result.success).toBe(true);
    });

    it("accepts DST-gap local datetimes without timezone-dependent rejection", () => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = "America/New_York";

      try {
        const result = schema.safeParse({ startAt: "2026-03-08T02:30" });
        expect(result.success).toBe(false);

        const relaxedRangeField: InputDatetimeSchemaType = {
          ...datetimeField,
          validations: [
            { validation: InputValidation.MIN, value: "2026-03-08T00:00" },
            { validation: InputValidation.MAX, value: "2026-03-08T23:59" },
          ],
        };

        const relaxedSchema = jobInputsFormSchema([relaxedRangeField]);
        expect(
          relaxedSchema.safeParse({ startAt: "2026-03-08T02:30" }).success,
        ).toBe(true);
      } finally {
        if (originalTimezone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimezone;
        }
      }
    });

    it("rejects timezone-based ISO datetime strings", () => {
      const result = schema.safeParse({
        startAt: "2026-03-10T10:30:00.000Z",
      });
      expect(result.success).toBe(false);
    });

    it("ignores unsupported second-precision string bounds", () => {
      const secondsBoundField: InputDatetimeSchemaType = {
        ...datetimeField,
        validations: [
          { validation: InputValidation.MIN, value: "2026-03-10T10:30:30Z" },
          { validation: InputValidation.MAX, value: "2026-03-10T10:30:30" },
        ],
      };

      const secondsBoundSchema = jobInputsFormSchema([secondsBoundField]);
      const result = secondsBoundSchema.safeParse({
        startAt: "2026-03-10T10:30",
      });
      expect(result.success).toBe(true);
    });

    it("applies min and max constraints", () => {
      const belowMinResult = schema.safeParse({ startAt: "2026-03-10T08:59" });
      const aboveMaxResult = schema.safeParse({ startAt: "2026-03-10T12:01" });

      expect(belowMinResult.success).toBe(false);
      expect(aboveMaxResult.success).toBe(false);
    });

    it("allows nullish values when optional", () => {
      const optionalDatetimeField: InputDatetimeSchemaType = {
        ...datetimeField,
        validations: [
          ...(datetimeField.validations ?? []),
          { validation: InputValidation.OPTIONAL, value: "true" },
        ],
      };
      const optionalSchema = jobInputsFormSchema([optionalDatetimeField]);

      expect(optionalSchema.safeParse({ startAt: null }).success).toBe(true);
      expect(optionalSchema.safeParse({}).success).toBe(true);
    });
  });

  describe("OPTION", () => {
    it("treats option with no min/max as single-selection and required by default", () => {
      const optionField: InputOptionSchemaType = {
        id: "singleOption",
        type: InputType.OPTION,
        name: "Single Option",
        data: {
          values: ["One", "Two", "Three"],
        },
      };
      const schema = jobInputsFormSchema([optionField]);

      expect(schema.safeParse({ singleOption: [] }).success).toBe(false);
      expect(schema.safeParse({ singleOption: [1] }).success).toBe(true);
      expect(schema.safeParse({ singleOption: [0, 1] }).success).toBe(false);
    });

    it("treats option with min=1 max=1 as single-selection", () => {
      const optionField: InputOptionSchemaType = {
        id: "singleOption",
        type: InputType.OPTION,
        name: "Single Option",
        data: {
          values: ["One", "Two", "Three"],
        },
        validations: [
          { validation: InputValidation.MIN, value: "1" },
          { validation: InputValidation.MAX, value: "1" },
        ],
      };
      const schema = jobInputsFormSchema([optionField]);

      expect(schema.safeParse({ singleOption: [2] }).success).toBe(true);
      expect(schema.safeParse({ singleOption: [1, 2] }).success).toBe(false);
    });

    it("treats option with min/max as multi-select and applies bounds", () => {
      const optionField: InputOptionSchemaType = {
        id: "multiOption",
        type: InputType.OPTION,
        name: "Multi Option",
        data: {
          values: ["One", "Two", "Three", "Four"],
        },
        validations: [
          { validation: InputValidation.MIN, value: "2" },
          { validation: InputValidation.MAX, value: "3" },
        ],
      };
      const schema = jobInputsFormSchema([optionField]);

      expect(schema.safeParse({ multiOption: [0] }).success).toBe(false);
      expect(schema.safeParse({ multiOption: [0, 1] }).success).toBe(true);
      expect(schema.safeParse({ multiOption: [0, 1, 2, 3] }).success).toBe(
        false,
      );
    });

    it("defaults option required min to 1 when no explicit min is provided", () => {
      const optionField: InputOptionSchemaType = {
        id: "requiredOption",
        type: InputType.OPTION,
        name: "Required Option",
        data: {
          values: ["One", "Two", "Three"],
        },
        validations: [{ validation: InputValidation.MAX, value: "3" }],
      };
      const schema = jobInputsFormSchema([optionField]);

      expect(schema.safeParse({ requiredOption: [] }).success).toBe(false);
      expect(schema.safeParse({ requiredOption: [0] }).success).toBe(true);
    });
  });

  describe("NUMBER and RANGE", () => {
    it("treats empty string as unset for optional number fields", () => {
      const numberField: InputNumberSchemaType = {
        id: "count",
        type: InputType.NUMBER,
        name: "Count",
        validations: [{ validation: InputValidation.OPTIONAL, value: "true" }],
      };
      const schema = jobInputsFormSchema([numberField]);
      const result = schema.safeParse({ count: "" });
      expect(result.success).toBe(true);
      expect(result.data?.count).toBeUndefined();
    });

    it("rejects empty string for required number fields", () => {
      const numberField: InputNumberSchemaType = {
        id: "count",
        type: InputType.NUMBER,
        name: "Count",
      };
      const schema = jobInputsFormSchema([numberField]);
      expect(schema.safeParse({ count: "" }).success).toBe(false);
    });

    it("treats empty string as unset for optional range fields", () => {
      const rangeField: InputRangeSchemaType = {
        id: "volume",
        type: InputType.RANGE,
        name: "Volume",
        data: { step: 1 },
        validations: [
          { validation: InputValidation.MIN, value: "0" },
          { validation: InputValidation.MAX, value: "10" },
          { validation: InputValidation.OPTIONAL, value: "true" },
        ],
      };
      const schema = jobInputsFormSchema([rangeField]);
      const result = schema.safeParse({ volume: "" });
      expect(result.success).toBe(true);
      expect(result.data?.volume).toBeUndefined();
    });

    it("rejects empty string for required range fields", () => {
      const rangeField: InputRangeSchemaType = {
        id: "volume",
        type: InputType.RANGE,
        name: "Volume",
        data: { step: 1 },
        validations: [
          { validation: InputValidation.MIN, value: "0" },
          { validation: InputValidation.MAX, value: "10" },
        ],
      };
      const schema = jobInputsFormSchema([rangeField]);
      expect(schema.safeParse({ volume: "" }).success).toBe(false);
    });
  });

  describe("RADIO_GROUP", () => {
    it("ignores min/max validations and enforces a single selected value", () => {
      const radioField: InputRadioGroupSchemaType = {
        id: "radioChoice",
        type: InputType.RADIO_GROUP,
        name: "Radio Choice",
        data: {
          values: ["One", "Two", "Three"],
        },
        validations: [
          { validation: InputValidation.MIN, value: "2" },
          { validation: InputValidation.MAX, value: "2" },
        ],
      };
      const schema = jobInputsFormSchema([radioField]);

      expect(schema.safeParse({ radioChoice: [] }).success).toBe(false);
      expect(schema.safeParse({ radioChoice: [1] }).success).toBe(true);
      expect(schema.safeParse({ radioChoice: [0, 1] }).success).toBe(false);
    });

    it("respects optional validation for radio fields", () => {
      const radioField: InputRadioGroupSchemaType = {
        id: "optionalRadioChoice",
        type: InputType.RADIO_GROUP,
        name: "Optional Radio Choice",
        data: {
          values: ["One", "Two", "Three"],
        },
        validations: [
          { validation: InputValidation.MIN, value: "2" },
          { validation: InputValidation.MAX, value: "2" },
          { validation: InputValidation.OPTIONAL, value: "true" },
        ],
      };
      const schema = jobInputsFormSchema([radioField]);

      expect(schema.safeParse({ optionalRadioChoice: null }).success).toBe(
        true,
      );
      expect(schema.safeParse({ optionalRadioChoice: [] }).success).toBe(true);
      expect(schema.safeParse({ optionalRadioChoice: [1] }).success).toBe(true);
      expect(schema.safeParse({ optionalRadioChoice: [0, 1] }).success).toBe(
        false,
      );
    });
  });
});
