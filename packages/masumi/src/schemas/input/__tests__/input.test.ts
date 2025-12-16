import {
  InputFormat,
  InputType,
  InputValidation,
} from "../../../types/input-types.js";
import {
  InputCheckboxSchemaType,
  InputColorSchemaType,
  inputDataSchema,
  InputDateSchemaType,
  InputDatetimeSchemaType,
  InputEmailSchemaType,
  InputHiddenSchemaType,
  InputMonthSchemaType,
  InputMultiselectSchemaType,
  InputPasswordSchemaType,
  InputRadioGroupSchemaType,
  InputRangeSchemaType,
  InputSearchSchemaType,
  InputTimeSchemaType,
  InputUrlSchemaType,
  InputWeekSchemaType,
} from "../input.schema.js";

describe("inputDataSchema", () => {
  describe("String input type", () => {
    const validStringInput = {
      id: "test-id",
      type: InputType.STRING,
      name: "Test String Input",
      data: {
        placeholder: "Enter text",
        description: "Test description",
      },
    };

    it("should validate a valid string input", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validStringInput],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with empty id", () => {
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validStringInput,
            validations: [
              { validation: InputValidation.MIN, value: "10" },
              { validation: InputValidation.MAX, value: "100" },
              {
                validation: InputValidation.FORMAT,
                value: InputFormat.NON_EMPTY,
              },
              { validation: InputValidation.FORMAT, value: InputFormat.URL },
              { validation: InputValidation.FORMAT, value: InputFormat.EMAIL },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validStringInput,
            validations: [
              {
                validation: InputValidation.FORMAT,
                value: InputFormat.INTEGER,
              },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Number input type", () => {
    const validNumberInput = {
      id: "number-id",
      type: InputType.NUMBER,
      name: "Test Number Input",
      data: {
        placeholder: "Enter number",
        description: "Test number description",
      },
    };

    it("should validate a valid number input", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validNumberInput],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validNumberInput,
            validations: [
              { validation: InputValidation.MIN, value: "0" },
              { validation: InputValidation.MAX, value: "100" },
              {
                validation: InputValidation.FORMAT,
                value: InputFormat.INTEGER,
              },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validNumberInput,
            validations: [
              { validation: InputValidation.FORMAT, value: InputFormat.URL },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Boolean input type", () => {
    const validBooleanInput = {
      id: "boolean-id",
      type: InputType.BOOLEAN,
      name: "Test Boolean Input",
      data: {
        description: "Test boolean description",
      },
    };

    it("should validate a valid boolean input", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validBooleanInput],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validBooleanInput,
            validations: [
              { validation: InputValidation.OPTIONAL, value: "true" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validBooleanInput,
            validations: [
              { validation: InputValidation.FORMAT, value: InputFormat.URL },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Option input type", () => {
    const validOptionInput = {
      id: "option-id",
      type: InputType.OPTION,
      name: "Test Option Input",
      data: {
        values: ["option1", "option2", "option3"],
        description: "Test option description",
      },
    };

    it("should validate a valid option input", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validOptionInput],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with undefined data", () => {
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
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
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validOptionInput,
            validations: [
              { validation: InputValidation.MIN, value: "2" },
              { validation: InputValidation.MAX, value: "4" },
              { validation: InputValidation.OPTIONAL, value: "true" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validOptionInput,
            validations: [
              { validation: InputValidation.FORMAT, value: InputFormat.URL },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid optional", () => {
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validOptionInput,
            validations: [
              { validation: InputValidation.MIN, value: "2" },
              { validation: InputValidation.MAX, value: "4" },
              { validation: InputValidation.OPTIONAL, value: "" },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid optional missing value", () => {
      const result = inputDataSchema.safeParse({
        input_data: [
          {
            ...validOptionInput,
            validations: [
              { validation: InputValidation.MIN, value: "2" },
              { validation: InputValidation.MAX, value: "4" },
              { validation: InputValidation.OPTIONAL },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("None input type", () => {
    const validNoneInput = {
      id: "none-id",
      type: InputType.NONE,
      name: "Test None Input",
      data: {
        description: "Test none description",
      },
    };

    it("should validate a valid none input", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validNoneInput],
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = inputDataSchema.safeParse({
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

  describe("Date input type", () => {
    const validDate: InputDateSchemaType = {
      id: "date-id",
      type: InputType.DATE,
      name: "Date",
      data: {
        placeholder: "Pick a date",
      },
      validations: [{ validation: InputValidation.MIN, value: "0" }],
    };

    it("should validate date with min timestamp", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validDate],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Datetime input type", () => {
    const validDatetime: InputDatetimeSchemaType = {
      id: "dt-id",
      type: InputType.DATETIME,
      name: "Datetime",
      validations: [
        { validation: InputValidation.MIN, value: "0" },
        { validation: InputValidation.OPTIONAL, value: "true" },
      ],
    };

    it("should validate datetime with optional", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validDatetime],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Time input type", () => {
    const validTime: InputTimeSchemaType = {
      id: "time-id",
      type: InputType.TIME,
      name: "Time",
      validations: [
        { validation: InputValidation.MIN, value: "0" },
        { validation: InputValidation.MAX, value: "1439" },
      ],
    };

    it("should validate basic time schema definition", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validTime],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Range input type", () => {
    const validRange: InputRangeSchemaType = {
      id: "range-id",
      type: InputType.RANGE,
      name: "Range",
      data: { step: 2, default: 4, description: "0-10" },
      validations: [
        { validation: InputValidation.MIN, value: "0" },
        { validation: InputValidation.MAX, value: "10" },
      ],
    };

    it("should validate range schema with step", () => {
      const result = inputDataSchema.safeParse({
        input_data: [validRange],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Multiselect input type", () => {
    const ms: InputMultiselectSchemaType = {
      id: "ms-id",
      type: InputType.MULTISELECT,
      name: "MS",
      data: { values: ["a", "b"] },
      validations: [
        { validation: InputValidation.MIN, value: "1" },
        { validation: InputValidation.MAX, value: "2" },
      ],
    };

    it("should validate multiselect schema", () => {
      const result = inputDataSchema.safeParse({ input_data: [ms] });
      expect(result.success).toBe(true);
    });
  });

  describe("Checkbox input type", () => {
    const cb: InputCheckboxSchemaType = {
      id: "cb-id",
      type: InputType.CHECKBOX,
      name: "Terms and Conditions",
      data: { description: "I agree to the terms", default: false },
      validations: [{ validation: InputValidation.OPTIONAL, value: "true" }],
    };

    it("should validate checkbox schema", () => {
      const result = inputDataSchema.safeParse({ input_data: [cb] });
      expect(result.success).toBe(true);
    });
  });

  describe("Radio group input type", () => {
    const rg: InputRadioGroupSchemaType = {
      id: "rg-id",
      type: InputType.RADIO_GROUP,
      name: "RG",
      data: { values: ["a", "b"] },
    };

    it("should validate radio group schema", () => {
      const result = inputDataSchema.safeParse({ input_data: [rg] });
      expect(result.success).toBe(true);
    });
  });

  describe("Password input type", () => {
    const passwordInput: InputPasswordSchemaType = {
      id: "pwd-id",
      type: InputType.PASSWORD,
      name: "Password",
      data: {
        description: "Minimum 8 characters",
      },
      validations: [
        { validation: InputValidation.MIN, value: "8" },
        { validation: InputValidation.MAX, value: "128" },
      ],
    };

    it("should validate password input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [passwordInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Email input type", () => {
    const emailInput: InputEmailSchemaType = {
      id: "email-id",
      type: InputType.EMAIL,
      name: "Email",
      data: { description: "Enter your email" },
      validations: [
        {
          validation: InputValidation.FORMAT,
          value: InputFormat.EMAIL,
        },
      ],
    };

    it("should validate email input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [emailInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("URL input type", () => {
    const urlInput: InputUrlSchemaType = {
      id: "url-id",
      type: InputType.URL,
      name: "Website",
      data: { description: "Enter a valid URL" },
      validations: [
        {
          validation: InputValidation.FORMAT,
          value: InputFormat.URL,
        },
      ],
    };

    it("should validate url input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [urlInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Color input type", () => {
    const colorInput: InputColorSchemaType = {
      id: "color-id",
      type: InputType.COLOR,
      name: "Theme Color",
      data: { default: "#1a73e8", description: "Choose your preferred color" },
      validations: [{ validation: InputValidation.OPTIONAL, value: "true" }],
    };

    it("should validate color input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [colorInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Month input type", () => {
    const monthInput: InputMonthSchemaType = {
      id: "month-id",
      type: InputType.MONTH,
      name: "Month",
      data: { placeholder: "YYYY-MM" },
      validations: [{ validation: InputValidation.OPTIONAL, value: "true" }],
    };

    it("should validate month input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [monthInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Week input type", () => {
    const weekInput: InputWeekSchemaType = {
      id: "week-id",
      type: InputType.WEEK,
      name: "Week",
      data: { placeholder: "YYYY-Www" },
    };

    it("should validate week input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [weekInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Search input type", () => {
    const searchInput: InputSearchSchemaType = {
      id: "search-id",
      type: InputType.SEARCH,
      name: "Search",
      validations: [
        {
          validation: InputValidation.FORMAT,
          value: InputFormat.NON_EMPTY,
        },
      ],
    };

    it("should validate search input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [searchInput],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Hidden input type", () => {
    const hiddenInput: InputHiddenSchemaType = {
      id: "hidden-id",
      type: InputType.HIDDEN,
      name: "Hidden",
      data: { value: "static" },
    };

    it("should validate hidden input schema", () => {
      const result = inputDataSchema.safeParse({
        input_data: [hiddenInput],
      });
      expect(result.success).toBe(true);
    });
  });
});
