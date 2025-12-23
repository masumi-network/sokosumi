import {
  InputCheckboxSchemaType,
  InputColorSchemaType,
  InputFieldSchemaType,
  InputHiddenSchemaType,
  InputRangeSchemaType,
  InputSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import * as z from "zod";

import { makeZodSchemaFromJobInputSchema } from "./form-schema";
import { isBooleanType } from "./form-schema-helpers";
import { JobInputFormIntlPath } from "./type";

/**
 * Type Relationship Documentation:
 *
 * This module bridges two type systems:
 *
 * 1. **Masumi InputSchemaType** (from @sokosumi/masumi/schemas):
 *    - A flat record type: `Record<string, number | string | boolean | File | arrays>`
 *    - Used for API submissions and data storage
 *    - Does not include null/undefined (clean data)
 *
 * 2. **JobInputsFormSchemaType** (defined here):
 *    - Dynamic Zod schema inferred from input field definitions
 *    - Used for form state management with react-hook-form
 *    - May include null/undefined for optional/unset fields
 *
 * Conversion Flow:
 * ```
 * InputFieldSchemaType[] → jobInputsFormSchema() → JobInputsFormSchemaType
 *                                                         ↓
 *                                               filterOutNullValues()
 *                                                         ↓
 *                                                  InputSchemaType
 * ```
 */

/**
 * Creates a dynamic Zod schema from an array of input field definitions.
 * The resulting schema validates form data based on each field's type and validations.
 *
 * @param jobInputSchemas - Array of masumi input field definitions
 * @param t - Optional translation function for error messages
 * @returns Zod object schema with field-specific validation
 */
export const jobInputsFormSchema = (
  jobInputSchemas: InputFieldSchemaType[],
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  return z.object(
    Object.fromEntries(
      jobInputSchemas.map((jobInputSchema) => {
        return [
          jobInputSchema.id,
          makeZodSchemaFromJobInputSchema(jobInputSchema, t)!,
        ];
      }),
    ),
  );
};

/**
 * Form state type inferred from the dynamic Zod schema.
 *
 * Key differences from InputSchemaType:
 * - May contain null/undefined for optional fields
 * - Fields are validated according to input type (e.g., dates are Date objects)
 * - Used with react-hook-form for form state management
 *
 * @see InputSchemaType for the API-compatible type
 * @see filterOutNullValues for converting to InputSchemaType
 */
export type JobInputsFormSchemaType = z.infer<
  ReturnType<typeof jobInputsFormSchema>
>;

/**
 * Converts form state to API-compatible format by removing null/undefined values.
 *
 * This is the primary bridge between:
 * - JobInputsFormSchemaType (form state, may have nulls)
 * - InputSchemaType (API format, no nulls)
 *
 * @param values - Form values that may contain null/undefined
 * @returns Clean values compatible with masumi InputSchemaType
 *
 * @example
 * ```typescript
 * const formData: JobInputsFormSchemaType = {
 *   name: "John",
 *   optionalField: null,
 *   age: 25
 * };
 *
 * const apiData = filterOutNullValues(formData);
 * // Result: { name: "John", age: 25 }
 * ```
 */
export function filterOutNullValues(
  values: JobInputsFormSchemaType,
): InputSchemaType {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([_, value]) => value !== null && value !== undefined,
    ),
  ) as InputSchemaType;
}

/**
 * Type guard to check if a value is a valid InputSchemaType value.
 * Useful for runtime validation when converting between types.
 */
export function isInputSchemaValue(
  value: unknown,
): value is InputSchemaType[string] {
  if (value === undefined) return true;
  if (typeof value === "number") return true;
  if (typeof value === "string") return true;
  if (typeof value === "boolean") return true;
  if (value instanceof File) return true;
  if (Array.isArray(value)) {
    return value.every(
      (item) =>
        typeof item === "number" ||
        typeof item === "string" ||
        item instanceof File,
    );
  }
  return false;
}

/**
 * Default value extractors for each input type category.
 * Uses masumi schema `data` fields directly where possible.
 */
type DefaultValueExtractor = (schema: InputFieldSchemaType) => unknown | null;

/**
 * Extract default value for boolean types (BOOLEAN, CHECKBOX)
 */
const getBooleanDefault: DefaultValueExtractor = (schema) => {
  if (schema.type === InputType.CHECKBOX) {
    return (schema as InputCheckboxSchemaType).data?.default ?? false;
  }
  return false;
};

/**
 * Extract default value for color type
 */
const getColorDefault: DefaultValueExtractor = (schema) => {
  return (schema as InputColorSchemaType).data?.default ?? "#000000";
};

/**
 * Extract default value for range type
 */
const getRangeDefault: DefaultValueExtractor = (schema) => {
  return (schema as InputRangeSchemaType).data?.default ?? null;
};

/**
 * Extract default value for hidden type
 */
const getHiddenDefault: DefaultValueExtractor = (schema) => {
  return (schema as InputHiddenSchemaType).data?.value ?? "";
};

/**
 * Map of input types to their default value extractors.
 * Types not in this map return null as default.
 */
const DEFAULT_VALUE_EXTRACTORS: Partial<
  Record<InputType, DefaultValueExtractor>
> = {
  // Boolean types
  [InputType.BOOLEAN]: getBooleanDefault,
  [InputType.CHECKBOX]: getBooleanDefault,
  // Special types with data defaults
  [InputType.COLOR]: getColorDefault,
  [InputType.RANGE]: getRangeDefault,
  [InputType.HIDDEN]: getHiddenDefault,
};

/**
 * Gets the default value for a job input schema.
 * Uses the masumi schema's data field directly where available.
 *
 * @param jobInputSchema - The input schema definition
 * @returns Default value for the input, or null for inputs without defaults
 */
export function getDefaultValue(
  jobInputSchema: InputFieldSchemaType,
): unknown | null {
  const { type } = jobInputSchema;

  // Look up extractor in the map
  const extractor = DEFAULT_VALUE_EXTRACTORS[type];
  if (extractor) {
    return extractor(jobInputSchema);
  }

  // Default to null for all other types
  return null;
}

/**
 * Creates default values object for a list of job input schemas.
 * Maps each input's id to its default value.
 *
 * @param jobInputSchemas - Array of input schema definitions
 * @returns Object mapping input ids to default values
 */
export const defaultValues = (
  jobInputSchemas: InputFieldSchemaType[],
): Record<string, unknown | null> => {
  return Object.fromEntries(
    jobInputSchemas.map((jobInputSchema) => {
      return [jobInputSchema.id, getDefaultValue(jobInputSchema)];
    }),
  );
};

/**
 * Type guard to check if a value is a non-null form value.
 * Useful for filtering form values before submission.
 */
export function isNonNullValue(value: unknown): value is NonNullable<unknown> {
  return value !== null && value !== undefined;
}

/**
 * Checks if two form values represent the same input type.
 * Used for validation and type narrowing.
 */
export function isValidFormValue(
  schema: InputFieldSchemaType,
  value: unknown,
): boolean {
  const { type } = schema;

  if (value === null || value === undefined) {
    return true; // Null values are always valid (optionality is handled by schema)
  }

  if (isBooleanType(type)) {
    return typeof value === "boolean";
  }

  switch (type) {
    case InputType.NUMBER:
    case InputType.RANGE:
      return typeof value === "number";
    case InputType.FILE:
      return (
        Array.isArray(value) && value.every((item) => item instanceof File)
      );
    case InputType.OPTION:
    case InputType.RADIO_GROUP:
    case InputType.MULTISELECT:
      return (
        Array.isArray(value) && value.every((item) => typeof item === "number")
      );
    case InputType.DATE:
    case InputType.DATETIME:
      return value instanceof Date;
    default:
      return typeof value === "string";
  }
}
