/* eslint-disable simple-import-sort/imports */
import {
  JobInputCheckboxSchemaType,
  JobInputColorSchemaType,
  JobInputDateSchemaType,
  JobInputDatetimeSchemaType,
  JobInputEmailSchemaType,
  JobInputHiddenSchemaType,
  JobInputMonthSchemaType,
  JobInputMultiselectSchemaType,
  JobInputPasswordSchemaType,
  JobInputRadioGroupSchemaType,
  JobInputRangeSchemaType,
  JobInputSearchSchemaType,
  JobInputTimeSchemaType,
  JobInputUrlSchemaType,
  JobInputWeekSchemaType,
  jobInputsDataSchema,
} from "@/lib/job-input/job-input";
import {
  ValidJobInputFormatValues,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "@/lib/job-input/type";

describe("jobInputSchema", () => {
  // Since we're only testing the schema validation logic,
  // we can use undefined for all translation messages
  const mockT = undefined;

  describe("String input type", () => {
    const validStringInput = {
      id: "test-id",
      type: ValidJobInputTypes.STRING,
      name: "Test String Input",
      data: {
        placeholder: "Enter text",
        description: "Test description",
      },
    };

    it("should validate a valid string input", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validStringInput],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with empty id", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validStringInput,
            id: "",
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should fail with empty name", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validStringInput,
            name: "",
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validStringInput,
            data: undefined,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with empty validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validStringInput,
            validations: undefined,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with valid validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validStringInput,
            validations: [
              { validation: "min", value: "10" },
              { validation: "max", value: "100" },
              { validation: "format", value: "nonempty" },
              { validation: "format", value: "url" },
              { validation: "format", value: "email" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validStringInput,
            validations: [{ validation: "format", value: "integer" }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Number input type", () => {
    const validNumberInput = {
      id: "number-id",
      type: ValidJobInputTypes.NUMBER,
      name: "Test Number Input",
      data: {
        placeholder: "Enter number",
        description: "Test number description",
      },
    };

    it("should validate a valid number input", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validNumberInput],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validNumberInput,
            data: undefined,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should accept number input with validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validNumberInput,
            validations: [
              { validation: "min", value: "0" },
              { validation: "max", value: "100" },
              { validation: "format", value: "integer" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validNumberInput,
            validations: [{ validation: "format", value: "url" }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Boolean input type", () => {
    const validBooleanInput = {
      id: "boolean-id",
      type: ValidJobInputTypes.BOOLEAN,
      name: "Test Boolean Input",
      data: {
        description: "Test boolean description",
      },
    };

    it("should validate a valid boolean input", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validBooleanInput],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validBooleanInput,
            data: undefined,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should accept boolean input with optional validation", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validBooleanInput,
            validations: [{ validation: "optional", value: "true" }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validBooleanInput,
            validations: [{ validation: "format", value: "url" }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Option input type", () => {
    const validOptionInput = {
      id: "option-id",
      type: ValidJobInputTypes.OPTION,
      name: "Test Option Input",
      data: {
        values: ["option1", "option2", "option3"],
        description: "Test option description",
      },
    };

    it("should validate a valid option input", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validOptionInput],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with undefined data", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validOptionInput,
            data: undefined,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should fail with empty values array", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validOptionInput,
            data: {
              ...validOptionInput.data,
              values: [],
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should fail with empty value in values array", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validOptionInput,
            data: {
              ...validOptionInput.data,
              values: ["option1", "", "option3"],
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should succeed with valid validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validOptionInput,
            validations: [
              { validation: "min", value: "2" },
              { validation: "max", value: "4" },
              { validation: "optional", value: "true" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validOptionInput,
            validations: [{ validation: "format", value: "url" }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
    it("should fail with invalid optional", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        ...validOptionInput,
        validations: [
          { validation: "min", value: "2" },
          { validation: "max", value: "4" },
          { validation: "optional", value: "" },
        ],
      });
      expect(result.success).toBe(false);
    });
    it("should fail with invalid optional", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        ...validOptionInput,
        validations: [
          { validation: "min", value: "2" },
          { validation: "max", value: "4" },
          { validation: "optional" },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("None input type", () => {
    const validNoneInput = {
      id: "none-id",
      type: ValidJobInputTypes.NONE,
      name: "Test None Input",
      data: {
        description: "Test none description",
      },
    };

    it("should validate a valid none input", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validNoneInput],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [
          {
            ...validNoneInput,
            data: undefined,
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  // New: Date/Datetime/Time/Range/MultiSelect/CheckboxGroup/RadioGroup
  describe("Date input type", () => {
    const validDate: JobInputDateSchemaType = {
      id: "date-id",
      type: ValidJobInputTypes.DATE,
      name: "Date",
      data: {
        placeholder: "Pick a date",
      },
      validations: [
        { validation: ValidJobInputValidationTypes.MIN, value: "0" },
      ],
    };

    it("should validate date with min timestamp", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validDate],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Datetime input type", () => {
    const validDatetime: JobInputDatetimeSchemaType = {
      id: "dt-id",
      type: ValidJobInputTypes.DATETIME,
      name: "Datetime",
      validations: [
        { validation: ValidJobInputValidationTypes.MIN, value: "0" },
        { validation: ValidJobInputValidationTypes.OPTIONAL, value: "true" },
      ],
    };

    it("should validate datetime with optional", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validDatetime],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Time input type", () => {
    const validTime: JobInputTimeSchemaType = {
      id: "time-id",
      type: ValidJobInputTypes.TIME,
      name: "Time",
      validations: [
        { validation: ValidJobInputValidationTypes.MIN, value: "0" },
        { validation: ValidJobInputValidationTypes.MAX, value: "1439" },
      ],
    };

    it("should validate basic time schema definition", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validTime],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Range input type", () => {
    const validRange: JobInputRangeSchemaType = {
      id: "range-id",
      type: ValidJobInputTypes.RANGE,
      name: "Range",
      data: { step: 2, default: 4, description: "0-10" },
      validations: [
        { validation: ValidJobInputValidationTypes.MIN, value: "0" },
        { validation: ValidJobInputValidationTypes.MAX, value: "10" },
      ],
    };

    it("should validate range schema with step", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [validRange],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Multiselect input type", () => {
    const ms: JobInputMultiselectSchemaType = {
      id: "ms-id",
      type: ValidJobInputTypes.MULTISELECT,
      name: "MS",
      data: { values: ["a", "b"] },
      validations: [
        { validation: ValidJobInputValidationTypes.MIN, value: "1" },
        { validation: ValidJobInputValidationTypes.MAX, value: "2" },
      ],
    };
    it("should validate multiselect schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({ input_data: [ms] });
      expect(result.success).toBe(true);
    });
  });

  describe("Checkbox input type", () => {
    const cb: JobInputCheckboxSchemaType = {
      id: "cb-id",
      type: ValidJobInputTypes.CHECKBOX,
      name: "Terms and Conditions",
      data: { description: "I agree to the terms", default: false },
      validations: [
        { validation: ValidJobInputValidationTypes.OPTIONAL, value: "true" },
      ],
    };
    it("should validate checkbox schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({ input_data: [cb] });
      expect(result.success).toBe(true);
    });
  });

  describe("Radio group input type", () => {
    const rg: JobInputRadioGroupSchemaType = {
      id: "rg-id",
      type: ValidJobInputTypes.RADIO_GROUP,
      name: "RG",
      data: { values: ["a", "b"] },
    };
    it("should validate radio group schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({ input_data: [rg] });
      expect(result.success).toBe(true);
    });
  });

  describe("Password input type", () => {
    const passwordInput: JobInputPasswordSchemaType = {
      id: "pwd-id",
      type: ValidJobInputTypes.PASSWORD,
      name: "Password",
      data: {
        description: "Minimum 8 characters",
      },
      validations: [
        { validation: ValidJobInputValidationTypes.MIN, value: "8" },
        { validation: ValidJobInputValidationTypes.MAX, value: "128" },
      ],
    };

    it("should validate password input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [passwordInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Email input type", () => {
    const emailInput: JobInputEmailSchemaType = {
      id: "email-id",
      type: ValidJobInputTypes.EMAIL,
      name: "Email",
      data: { description: "Enter your email" },
      validations: [
        {
          validation: ValidJobInputValidationTypes.FORMAT,
          value: ValidJobInputFormatValues.EMAIL,
        },
      ],
    };

    it("should validate email input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [emailInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("URL input type", () => {
    const urlInput: JobInputUrlSchemaType = {
      id: "url-id",
      type: ValidJobInputTypes.URL,
      name: "Website",
      data: { description: "Enter a valid URL" },
      validations: [
        {
          validation: ValidJobInputValidationTypes.FORMAT,
          value: ValidJobInputFormatValues.URL,
        },
      ],
    };

    it("should validate url input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [urlInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Color input type", () => {
    const colorInput: JobInputColorSchemaType = {
      id: "color-id",
      type: ValidJobInputTypes.COLOR,
      name: "Theme Color",
      data: { default: "#1a73e8", description: "Choose your preferred color" },
      validations: [
        { validation: ValidJobInputValidationTypes.OPTIONAL, value: "true" },
      ],
    };

    it("should validate color input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [colorInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Month input type", () => {
    const monthInput: JobInputMonthSchemaType = {
      id: "month-id",
      type: ValidJobInputTypes.MONTH,
      name: "Month",
      data: { placeholder: "YYYY-MM" },
      validations: [
        { validation: ValidJobInputValidationTypes.OPTIONAL, value: "true" },
      ],
    };

    it("should validate month input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [monthInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Week input type", () => {
    const weekInput: JobInputWeekSchemaType = {
      id: "week-id",
      type: ValidJobInputTypes.WEEK,
      name: "Week",
      data: { placeholder: "YYYY-Www" },
    };

    it("should validate week input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [weekInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Search input type", () => {
    const searchInput: JobInputSearchSchemaType = {
      id: "search-id",
      type: ValidJobInputTypes.SEARCH,
      name: "Search",
      validations: [
        {
          validation: ValidJobInputValidationTypes.FORMAT,
          value: ValidJobInputFormatValues.NON_EMPTY,
        },
      ],
    };

    it("should validate search input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [searchInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Hidden input type", () => {
    const hiddenInput: JobInputHiddenSchemaType = {
      id: "hidden-id",
      type: ValidJobInputTypes.HIDDEN,
      name: "Hidden",
      data: { value: "static" },
    };

    it("should validate hidden input schema", () => {
      const result = jobInputsDataSchema(mockT).safeParse({
        input_data: [hiddenInput],
      });
      expect(result.success).toBe(true);
    });
  });
});
