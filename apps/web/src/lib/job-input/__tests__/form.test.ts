import { InputType } from "@sokosumi/masumi/types";
import { describe, expect, it } from "vitest";

import {
  defaultValues,
  JobInputsFormSchemaType,
  prepareInputValues,
} from "@/lib/job-input";

describe("prepareInputValues", () => {
  it("keeps date and datetime-local strings and removes null/undefined entries", () => {
    const values = {
      startDate: "2026-01-19",
      startAt: "2026-02-01T10:00",
      dateRange: ["2026-01-19", "2026-02-01"],
      count: 2,
      optional: null,
      unset: undefined,
    } as unknown as JobInputsFormSchemaType;

    const result = prepareInputValues(values);
    expect(result).toEqual({
      startDate: "2026-01-19",
      startAt: "2026-02-01T10:00",
      dateRange: ["2026-01-19", "2026-02-01"],
      count: 2,
    });
  });
});

describe("defaultValues", () => {
  it("seeds text and textarea defaults from the input schema", () => {
    const result = defaultValues([
      {
        id: "language",
        type: InputType.TEXT,
        name: "Campaign Language",
        data: {
          default: "English",
        },
        validations: null,
      },
      {
        id: "goal",
        type: InputType.TEXTAREA,
        name: "Primary Campaign Goal",
        data: {
          default: "Generate leads and increase brand awareness",
        },
        validations: null,
      },
    ]);

    expect(result).toEqual({
      language: "English",
      goal: "Generate leads and increase brand awareness",
    });
  });

  it("seeds spec-supported defaults for scalar inputs and radio groups", () => {
    const inputSchemas = [
      {
        id: "count",
        type: InputType.NUMBER,
        name: "Count",
        data: {
          default: 3,
        },
        validations: null,
      },
      {
        id: "acceptedTerms",
        type: InputType.BOOLEAN,
        name: "Accepted Terms",
        data: {
          default: true,
        },
        validations: null,
      },
      {
        id: "contactEmail",
        type: InputType.EMAIL,
        name: "Contact Email",
        data: {
          default: "hello@example.com",
        },
        validations: null,
      },
      {
        id: "startDate",
        type: InputType.DATE,
        name: "Start Date",
        data: {
          default: "2026-01-19",
        },
        validations: null,
      },
      {
        id: "paymentMethod",
        type: InputType.RADIO_GROUP,
        name: "Payment Method",
        data: {
          values: ["Credit Card", "PayPal", "Bank Transfer"],
          default: "PayPal",
        },
        validations: null,
      },
      {
        id: "invalidRadioDefault",
        type: InputType.RADIO_GROUP,
        name: "Invalid Radio Default",
        data: {
          values: ["One", "Two"],
          default: "Three",
        },
        validations: null,
      },
    ] as unknown as Parameters<typeof defaultValues>[0];

    const result = defaultValues(inputSchemas);

    expect(result).toEqual({
      count: 3,
      acceptedTerms: true,
      contactEmail: "hello@example.com",
      startDate: "2026-01-19",
      paymentMethod: [1],
      invalidRadioDefault: null,
    });
  });
});
