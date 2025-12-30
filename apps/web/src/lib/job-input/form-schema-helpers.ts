import {
  InputFormat,
  InputType,
  InputValidation,
} from "@sokosumi/masumi/types";
import * as z from "zod";

import { parseISOWeek, parseMonth } from "@/lib/utils";

import { JobInputFormIntlPath } from "./type";

/**
 * Minimum length for required string inputs when no explicit min validation is provided
 */
const MIN_REQUIRED_STRING_LENGTH = 1;

/**
 * Input type groups for categorizing similar input behaviors
 */
export const STRING_BASED_TYPES = new Set([
  InputType.STRING,
  InputType.TEXT,
  InputType.EMAIL,
  InputType.PASSWORD,
  InputType.URL,
  InputType.SEARCH,
]);

export const DATE_TYPES = new Set([
  InputType.DATE,
  InputType.DATETIME,
  InputType.TIME,
  InputType.MONTH,
  InputType.WEEK,
]);

export const OPTION_TYPES = new Set([
  InputType.OPTION,
  InputType.RADIO_GROUP,
  InputType.MULTISELECT,
]);

export const NUMERIC_TYPES = new Set([InputType.NUMBER, InputType.RANGE]);

export const BOOLEAN_TYPES = new Set([InputType.BOOLEAN, InputType.CHECKBOX]);

/**
 * Type guards for input type groups
 */
export const isStringBasedType = (type: InputType): boolean =>
  STRING_BASED_TYPES.has(type);
export const isDateType = (type: InputType): boolean => DATE_TYPES.has(type);
export const isOptionType = (type: InputType): boolean =>
  OPTION_TYPES.has(type);
export const isNumericType = (type: InputType): boolean =>
  NUMERIC_TYPES.has(type);
export const isBooleanType = (type: InputType): boolean =>
  BOOLEAN_TYPES.has(type);

/**
 * Validation entry from masumi schema
 */
interface ValidationEntry {
  validation: InputValidation;
  value: string | number;
}

/**
 * Parse validations to extract common options
 */
export interface ParsedValidationOptions {
  canBeOptional: boolean;
  min?: number | string;
  max?: number | string;
  format?: string;
  maxSize?: number;
  accept?: string;
  step?: number;
}

export function parseValidations(
  validations: ValidationEntry[] | null | undefined,
): ParsedValidationOptions {
  const result: ParsedValidationOptions = { canBeOptional: false };

  if (!validations) return result;

  for (const { validation, value } of validations) {
    switch (validation) {
      case InputValidation.OPTIONAL:
        result.canBeOptional = value === "true";
        break;
      case InputValidation.MIN:
        result.min = value;
        break;
      case InputValidation.MAX:
        result.max = value;
        break;
      case InputValidation.FORMAT:
        result.format = String(value);
        break;
      case InputValidation.ACCEPT:
        result.accept = String(value);
        break;
      case InputValidation.STEP:
        result.step = Number(value);
        break;
    }
  }

  return result;
}

/**
 * Apply string validations to a Zod string schema
 */
export function applyStringValidations(
  schema: z.ZodString,
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);
  let result: z.ZodString = schema;
  let hasMinValidation = false;
  let hasFormatValidation = false;

  // Apply validations in order
  if (validations) {
    for (const { validation, value } of validations) {
      switch (validation) {
        case InputValidation.MIN:
          hasMinValidation = true;
          result = result.min(Number(value), {
            error: t?.("String.min", { name, value: String(value) }),
          });
          break;
        case InputValidation.MAX:
          result = result.max(Number(value), {
            error: t?.("String.max", { name, value: String(value) }),
          });
          break;
        case InputValidation.FORMAT:
          switch (value) {
            case InputFormat.URL:
              hasFormatValidation = true;
              result = result.url({
                error: t?.("String.format", { name, value: String(value) }),
              });
              break;
            case InputFormat.EMAIL:
              hasFormatValidation = true;
              result = result.email({
                error: t?.("String.format", { name, value: String(value) }),
              });
              break;
            case InputFormat.NON_EMPTY:
              hasMinValidation = true;
              result = result.min(MIN_REQUIRED_STRING_LENGTH, {
                error: t?.("String.format", { name, value: String(value) }),
              });
              break;
          }
          break;
      }
    }
  }

  // Apply default min validation for required fields
  const needsMinLength =
    !parsed.canBeOptional && !hasMinValidation && !hasFormatValidation;
  const finalSchema = needsMinLength
    ? result.min(MIN_REQUIRED_STRING_LENGTH, {
        error: t?.("String.required", { name }),
      })
    : result;

  return parsed.canBeOptional ? finalSchema.nullish() : finalSchema;
}

/**
 * Apply numeric validations to a Zod number schema
 */
export function applyNumericValidations(
  schema: z.ZodNumber,
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);
  let result: z.ZodNumber = schema;

  if (validations) {
    for (const { validation, value } of validations) {
      switch (validation) {
        case InputValidation.MIN:
          result = result.min(Number(value), {
            error: t?.("Number.min", { name, value: String(value) }),
          });
          break;
        case InputValidation.MAX:
          result = result.max(Number(value), {
            error: t?.("Number.max", { name, value: String(value) }),
          });
          break;
        case InputValidation.FORMAT:
          if (value === InputFormat.INTEGER) {
            result = result.int({
              error: t?.("Number.format", { name, value: String(value) }),
            });
          }
          break;
      }
    }
  }

  return parsed.canBeOptional ? result.nullish() : result;
}

/**
 * Apply date validations using coerced date schema
 */
export function applyDateValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);
  let schema = z.coerce.date<Date>({ error: t?.("String.required", { name }) });

  if (parsed.min) {
    const minDate =
      typeof parsed.min === "number"
        ? new Date(parsed.min)
        : new Date(parsed.min);
    schema = schema.min(minDate, {
      error: t?.("Date.min", { name, value: minDate.toLocaleDateString() }),
    });
  }

  if (parsed.max) {
    const maxDate =
      typeof parsed.max === "number"
        ? new Date(parsed.max)
        : new Date(parsed.max);
    schema = schema.max(maxDate, {
      error: t?.("Date.max", { name, value: maxDate.toLocaleDateString() }),
    });
  }

  return parsed.canBeOptional ? schema.nullish() : schema;
}

/**
 * Apply time validations (string-based HH:mm format)
 */
export function applyTimeValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);

  const toMinutes = (val: string) => {
    if (/^\d+$/.test(val)) {
      const minutes = Number(val);
      return Number.isFinite(minutes) ? minutes : NaN;
    }
    const [hh, mm] = val.split(":").map((v) => Number(v));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
    return hh * 60 + mm;
  };

  const toHHmm = (minutes: number) => {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(minutes)));
    const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
    const mm = String(clamped % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  let schema = z
    .string({ error: t?.("String.required", { name }) })
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, {
      error: t?.("String.format", { name, value: "time" }),
    });

  if (parsed.min !== undefined) {
    const minStr = String(parsed.min);
    const minMinutes = toMinutes(minStr);
    const minHours = /^\d+$/.test(minStr) ? toHHmm(Number(minStr)) : minStr;
    if (Number.isFinite(minMinutes)) {
      schema = schema.refine((v) => toMinutes(v) >= minMinutes, {
        error: t?.("Number.min", { name, value: minHours }),
      });
    }
  }

  if (parsed.max !== undefined) {
    const maxStr = String(parsed.max);
    const maxMinutes = toMinutes(maxStr);
    const maxHours = /^\d+$/.test(maxStr) ? toHHmm(Number(maxStr)) : maxStr;
    if (Number.isFinite(maxMinutes)) {
      schema = schema.refine((v) => toMinutes(v) <= maxMinutes, {
        error: t?.("Number.max", { name, value: maxHours }),
      });
    }
  }

  return parsed.canBeOptional ? schema.nullish() : schema;
}

/**
 * Apply month validations (string-based YYYY-MM format)
 */
export function applyMonthValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);

  let schema = z
    .string({ error: t?.("String.required", { name }) })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
      error: t?.("String.format", { name, value: "month" }),
    })
    .refine((v) => !!parseMonth(v), {
      error: t?.("String.format", { name, value: "month" }),
    });

  if (parsed.min !== undefined) {
    const minStr = String(parsed.min);
    const minMonth = parseMonth(minStr);
    if (minMonth) {
      schema = schema.refine(
        (v) => {
          const d = parseMonth(v);
          return !!d && d.getTime() >= minMonth.getTime();
        },
        { error: t?.("Date.min", { name, value: minStr }) },
      );
    }
  }

  if (parsed.max !== undefined) {
    const maxStr = String(parsed.max);
    const maxMonth = parseMonth(maxStr);
    if (maxMonth) {
      schema = schema.refine(
        (v) => {
          const d = parseMonth(v);
          return !!d && d.getTime() <= maxMonth.getTime();
        },
        { error: t?.("Date.max", { name, value: maxStr }) },
      );
    }
  }

  return parsed.canBeOptional ? schema.nullish() : schema;
}

/**
 * Apply week validations (string-based YYYY-Www format)
 */
export function applyWeekValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);

  let schema = z
    .string({ error: t?.("String.required", { name }) })
    .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, {
      error: t?.("String.format", { name, value: "week" }),
    })
    .refine((v) => !!parseISOWeek(v), {
      error: t?.("String.format", { name, value: "week" }),
    });

  if (parsed.min !== undefined) {
    const minStr = String(parsed.min);
    const minWeek = parseISOWeek(minStr);
    if (minWeek) {
      schema = schema.refine(
        (v) => {
          const d = parseISOWeek(v);
          return !!d && d.getTime() >= minWeek.getTime();
        },
        { error: t?.("Date.min", { name, value: minStr }) },
      );
    }
  }

  if (parsed.max !== undefined) {
    const maxStr = String(parsed.max);
    const maxWeek = parseISOWeek(maxStr);
    if (maxWeek) {
      schema = schema.refine(
        (v) => {
          const d = parseISOWeek(v);
          return !!d && d.getTime() <= maxWeek.getTime();
        },
        { error: t?.("Date.max", { name, value: maxStr }) },
      );
    }
  }

  return parsed.canBeOptional ? schema.nullish() : schema;
}

/**
 * Apply option validations to an array schema for select/multiselect/radio
 */
export function applyOptionValidations(
  valuesCount: number,
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);

  const defaultSchema = z.array(
    z
      .int({
        error: t?.("Option.integer", { name }),
      })
      .nonnegative({
        error: t?.("Option.nonnegative", { name }),
      })
      .max(valuesCount - 1, {
        error: t?.("Option.invalid", { name, maxValue: valuesCount - 1 }),
      }),
    { error: t?.("Option.required", { name }) },
  );

  let result = defaultSchema;

  if (validations) {
    for (const { validation, value } of validations) {
      switch (validation) {
        case InputValidation.MIN:
          result = result.min(Number(value), {
            error: t?.("Option.min", { name, value: String(value) }),
          });
          break;
        case InputValidation.MAX:
          result = result.max(Number(value), {
            error: t?.("Option.max", { name, value: String(value) }),
          });
          break;
      }
    }
  }

  return parsed.canBeOptional ? result.nullish() : result;
}

/**
 * Apply file validations
 */
export function applyFileValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);

  let schema = z.array(z.instanceof(File));
  let hasMinValidation = false;

  if (validations) {
    for (const { validation, value } of validations) {
      switch (validation) {
        case InputValidation.MIN:
          hasMinValidation = true;
          schema = schema.min(Number(value), {
            error: t?.("Number.min", { name, value: String(value) }),
          });
          break;
        case InputValidation.MAX:
          schema = schema.max(Number(value), {
            error: t?.("Number.max", { name, value: String(value) }),
          });
          break;
      }
    }
  }

  // Apply default min(1) for required fields without explicit min
  const finalSchema =
    !parsed.canBeOptional && !hasMinValidation
      ? schema.min(1, { error: t?.("File.required", { name }) })
      : schema;

  return parsed.canBeOptional ? finalSchema.nullish() : finalSchema;
}

/**
 * Apply color validations
 */
export function applyColorValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);

  const schema = z
    .string({
      error: t?.("String.required", { name }),
    })
    .refine((v) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), {
      error: t?.("String.format", { name, value: "color" }),
    });

  return parsed.canBeOptional ? schema.nullish() : schema;
}

/**
 * Apply tel validations
 */
export function applyTelValidations(
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);
  const telRegex = /^[+]?\d[\d\s().-]{3,}$/;

  let schema = z.string({ error: t?.("String.required", { name }) });

  if (validations) {
    for (const { validation } of validations) {
      if (validation === InputValidation.FORMAT) {
        schema = schema.regex(telRegex, {
          error: t?.("String.format", { name, value: "tel" }),
        });
      }
    }
  }

  if (parsed.min !== undefined) {
    schema = schema.min(Number(parsed.min), {
      error: t?.("String.min", { name, value: String(parsed.min) }),
    });
  }

  if (parsed.max !== undefined) {
    schema = schema.max(Number(parsed.max), {
      error: t?.("String.max", { name, value: String(parsed.max) }),
    });
  }

  return parsed.canBeOptional ? schema.nullish() : schema;
}

/**
 * Apply textarea validations (similar to string but for multiline)
 */
export function applyTextareaValidations(
  schema: z.ZodString,
  validations: ValidationEntry[] | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);
  let result: z.ZodString = schema;
  let hasMinValidation = false;

  if (validations) {
    for (const { validation, value } of validations) {
      switch (validation) {
        case InputValidation.MIN:
          hasMinValidation = true;
          result = result.min(Number(value), {
            error: t?.("String.min", { name, value: String(value) }),
          });
          break;
        case InputValidation.MAX:
          result = result.max(Number(value), {
            error: t?.("String.max", { name, value: String(value) }),
          });
          break;
        case InputValidation.FORMAT:
          if (value === InputFormat.NON_EMPTY) {
            hasMinValidation = true;
            result = result.min(MIN_REQUIRED_STRING_LENGTH, {
              error: t?.("String.format", { name, value: String(value) }),
            });
          }
          break;
      }
    }
  }

  // Apply default min validation for required fields
  const needsMinLength = !parsed.canBeOptional && !hasMinValidation;
  const finalSchema = needsMinLength
    ? result.min(MIN_REQUIRED_STRING_LENGTH, {
        error: t?.("String.required", { name }),
      })
    : result;

  return parsed.canBeOptional ? finalSchema.nullish() : finalSchema;
}

/**
 * Apply range validations (numeric with step support)
 */
export function applyRangeValidations(
  validations: ValidationEntry[] | null | undefined,
  step: number | null | undefined,
  name: string,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const parsed = parseValidations(validations);
  let schema = z.coerce.number<number>({
    error: t?.("Number.required", { name }),
  });

  if (validations) {
    for (const { validation, value } of validations) {
      switch (validation) {
        case InputValidation.MIN:
          schema = schema.min(Number(value), {
            error: t?.("Number.min", { name, value: String(value) }),
          });
          break;
        case InputValidation.MAX:
          schema = schema.max(Number(value), {
            error: t?.("Number.max", { name, value: String(value) }),
          });
          break;
      }
    }
  }

  let finalSchema: z.ZodTypeAny = schema;

  if (typeof step === "number") {
    finalSchema = schema.refine(
      (v) => {
        const minVal = parsed.min !== undefined ? Number(parsed.min) : 0;
        const num = Number(v);
        return (
          Number.isFinite(num) &&
          Number.isFinite(step) &&
          (num - minVal) % step === 0
        );
      },
      { error: t?.("Number.format", { name, value: "step" }) },
    );
  }

  return parsed.canBeOptional ? finalSchema.nullish() : finalSchema;
}
