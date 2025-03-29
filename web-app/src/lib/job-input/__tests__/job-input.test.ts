import { jobInputSchema } from "@/lib/job-input/job-input";
import { ValidJobInputTypes } from "@/lib/job-input/type";

describe("jobInputSchema", () => {
  // Since we're only testing the schema validation logic,
  // we can use undefined for all translation messages
  const mockT = undefined;

  describe("String input type", () => {
    const validStringInput = {
      id: "test-id",
      type: ValidJobInputTypes.String,
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
  });

  describe("Number input type", () => {
    const validNumberInput = {
      id: "number-id",
      type: ValidJobInputTypes.Number,
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

    it("should accept number input with validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validNumberInput,
        validations: [
          { validation: "min", value: "0" },
          { validation: "max", value: "100" },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Boolean input type", () => {
    const validBooleanInput = {
      id: "boolean-id",
      type: ValidJobInputTypes.Boolean,
      name: "Test Boolean Input",
      data: {
        description: "Test boolean description",
      },
    };

    it("should validate a valid boolean input", () => {
      const result = jobInputSchema(mockT).safeParse(validBooleanInput);
      expect(result.success).toBe(true);
    });

    it("should accept boolean input with required validation", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validBooleanInput,
        validations: [{ validation: "required" }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Option input type", () => {
    const validOptionInput = {
      id: "option-id",
      type: ValidJobInputTypes.Option,
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
  });

  describe("None input type", () => {
    const validNoneInput = {
      id: "none-id",
      type: ValidJobInputTypes.None,
      name: "Test None Input",
      data: {
        description: "Test none description",
      },
    };

    it("should validate a valid none input", () => {
      const result = jobInputSchema(mockT).safeParse(validNoneInput);
      expect(result.success).toBe(true);
    });

    it("should not accept validations", () => {
      const result = jobInputSchema(mockT).safeParse({
        ...validNoneInput,
        validations: [{ validation: "required" }],
      });
      expect(result.success).toBe(true);
      expect(result.data).not.toEqual(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.data as any).validations).toBeUndefined();
    });
  });
});
