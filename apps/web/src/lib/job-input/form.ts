import type {
  InputFieldSchemaType,
  InputSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import * as z from "zod";

import { makeZodSchemaFromJobInputSchema } from "./form-schema";
import type { JobInputFormIntlPath } from "./type";

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
 *                                         filterOutNullValues()
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
 * - Fields are validated according to input type (e.g., date/time fields are strings)
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
function filterOutNullValues(values: JobInputsFormSchemaType): InputSchemaType {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([_, value]) => value !== null && value !== undefined,
    ),
  ) as InputSchemaType;
}

/**
 * Prepares input values for submission by filtering out null/undefined values.
 *
 * @param values - JobInputsFormSchemaType
 * @returns InputSchemaType
 */
export function prepareInputValues(
  values: JobInputsFormSchemaType,
): InputSchemaType {
  return filterOutNullValues(values);
}

/**
 * Default value extractors for each input type category.
 * Uses masumi schema `data` fields directly where possible.
 */
type DefaultValueExtractor = (schema: InputFieldSchemaType) => unknown | null;

function getSchemaDefaultValue(schema: InputFieldSchemaType): unknown {
  if (
    !schema.data ||
    typeof schema.data !== "object" ||
    !("default" in schema.data)
  ) {
    return undefined;
  }

  return schema.data.default;
}

/**
 * Extract default value for boolean types (BOOLEAN, CHECKBOX)
 */
const getBooleanDefault: DefaultValueExtractor = (schema) => {
  const defaultValue = getSchemaDefaultValue(schema);
  return typeof defaultValue === "boolean" ? defaultValue : false;
};

/**
 * Extract default value for color type
 */
const getColorDefault: DefaultValueExtractor = (schema) => {
  const defaultValue = getSchemaDefaultValue(schema);
  return typeof defaultValue === "string" ? defaultValue : "#000000";
};

/**
 * Extract default value for numeric types
 */
const getNumericDefault: DefaultValueExtractor = (schema) => {
  const defaultValue = getSchemaDefaultValue(schema);
  return typeof defaultValue === "number" ? defaultValue : null;
};

/**
 * Extract default value for hidden type
 */
const getHiddenDefault: DefaultValueExtractor = (schema) => {
  return schema.type === InputType.HIDDEN ? (schema.data?.value ?? "") : "";
};

/**
 * Extract default value for string-based inputs
 */
const getStringDefault: DefaultValueExtractor = (schema) => {
  const defaultValue = getSchemaDefaultValue(schema);
  return typeof defaultValue === "string" ? defaultValue : null;
};

/**
 * Extract default value for radio group inputs.
 * The form stores the selected option as an array containing the option index.
 */
const getRadioGroupDefault: DefaultValueExtractor = (schema) => {
  if (schema.type !== InputType.RADIO_GROUP) {
    return null;
  }

  const defaultValue = getSchemaDefaultValue(schema);
  if (typeof defaultValue !== "string") {
    return null;
  }

  const selectedIndex = schema.data.values.indexOf(defaultValue);
  return selectedIndex >= 0 ? [selectedIndex] : null;
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
  [InputType.NUMBER]: getNumericDefault,
  [InputType.RANGE]: getNumericDefault,
  [InputType.HIDDEN]: getHiddenDefault,
  [InputType.TEXT]: getStringDefault,
  [InputType.TEXTAREA]: getStringDefault,
  [InputType.EMAIL]: getStringDefault,
  [InputType.TEL]: getStringDefault,
  [InputType.URL]: getStringDefault,
  [InputType.DATE]: getStringDefault,
  [InputType.DATETIME]: getStringDefault,
  [InputType.TIME]: getStringDefault,
  [InputType.MONTH]: getStringDefault,
  [InputType.WEEK]: getStringDefault,
  [InputType.SEARCH]: getStringDefault,
  [InputType.RADIO_GROUP]: getRadioGroupDefault,
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
