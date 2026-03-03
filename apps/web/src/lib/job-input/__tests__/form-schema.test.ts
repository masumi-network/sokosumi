import {
  InputDateSchemaType,
  InputDatetimeSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType, InputValidation } from "@sokosumi/masumi/types";

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
});
