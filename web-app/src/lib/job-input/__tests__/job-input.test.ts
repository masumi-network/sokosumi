import { jobInputSchema } from "@/lib/job-input/job-input";
import { ValidJobInputTypes } from "@/lib/job-input/type";

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
      const result = jobInputSchema(mockT).safeParse(validStringInput);
      expect(result.success).toBe(true);
    });

    it("should fail with empty id", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validStringInput,
        id: "",
      });
      expect(result.success).toBe(false);
    });

    it("should fail with empty name", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validStringInput,
        name: "",
      });
      expect(result.success).toBe(false);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validStringInput,
        data: undefined,
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with empty validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validStringInput,
        validations: undefined,
      });
      expect(result.success).toBe(true);
    });

    it("should not fail with valid validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validStringInput,
        validations: [
          { validation: "min", value: "10" },
          { validation: "max", value: "100" },
          { validation: "format", value: "nonempty" },
          { validation: "format", value: "url" },
          { validation: "format", value: "email" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validStringInput,
        validations: [{ validation: "format", value: "integer" }],
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
      const result = jobInputSchema(mockT).safeParse(validNumberInput);
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validNumberInput,
        data: undefined,
      });
      expect(result.success).toBe(true);
    });

    it("should accept number input with validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validNumberInput,
        validations: [
          { validation: "min", value: "0" },
          { validation: "max", value: "100" },
          { validation: "format", value: "integer" },
          { validation: "format", value: "nonempty" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validNumberInput,
        validations: [{ validation: "format", value: "url" }],
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
      const result = jobInputSchema(mockT).safeParse(validBooleanInput);
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validBooleanInput,
        data: undefined,
      });
      expect(result.success).toBe(true);
    });

    it("should accept boolean input with optional validation", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validBooleanInput,
        validations: [{ validation: "optional", value: "true" }],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validBooleanInput,
        validations: [{ validation: "format", value: "url" }],
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
      const result = jobInputSchema(mockT).safeParse(validOptionInput);
      expect(result.success).toBe(true);
    });

    it("should fail with undefined data", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validOptionInput,
        data: undefined,
      });
      expect(result.success).toBe(false);
    });

    it("should fail with empty values array", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validOptionInput,
        data: {
          ...validOptionInput.data,
          values: [],
        },
      });
      expect(result.success).toBe(false);
    });

    it("should fail with empty value in values array", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validOptionInput,
        data: {
          ...validOptionInput.data,
          values: ["option1", "", "option3"],
        },
      });
      expect(result.success).toBe(false);
    });

    it("should succeed with valid validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validOptionInput,
        validations: [
          { validation: "min", value: "2" },
          { validation: "max", value: "4" },
          { validation: "optional", value: "true" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validOptionInput,
        validations: [{ validation: "format", value: "url" }],
      });
      expect(result.success).toBe(false);
    });
    it("should fail with invalid optional", () => {
      const result = jobInputSchema(mockT).safeParse({
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
      const result = jobInputSchema(mockT).safeParse({
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
      const result = jobInputSchema(mockT).safeParse(validNoneInput);
      expect(result.success).toBe(true);
    });

    it("should not fail with undefined data", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validNoneInput,
        data: undefined,
      });
      expect(result.success).toBe(true);
    });
  });
});
