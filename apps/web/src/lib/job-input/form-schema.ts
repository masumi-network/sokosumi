import {
  InputBooleanSchemaType,
  InputCheckboxSchemaType,
  InputColorSchemaType,
  InputDateSchemaType,
  InputDatetimeSchemaType,
  InputEmailSchemaType,
  InputFieldSchemaType,
  InputFileSchemaType,
  InputMonthSchemaType,
  InputMultiselectSchemaType,
  InputNumberSchemaType,
  InputOptionSchemaType,
  InputPasswordSchemaType,
  InputRadioGroupSchemaType,
  InputRangeSchemaType,
  InputSearchSchemaType,
  InputStringSchemaType,
  InputTelSchemaType,
  InputTextareaSchemaType,
  InputTextSchemaType,
  InputTimeSchemaType,
  InputUrlSchemaType,
  InputWeekSchemaType,
} from "@sokosumi/masumi/schemas";
import {
  InputFormat,
  InputType,
  InputValidation,
} from "@sokosumi/masumi/types";
import * as z from "zod";

import { parseISOWeek, parseMonth } from "@/lib/utils";

import { JobInputFormIntlPath } from "./type";

export const makeZodSchemaFromJobInputSchema = (
  jobInputSchema: InputFieldSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  switch (jobInputSchema.type) {
    case InputType.NONE:
      return z.never().nullable();
    case InputType.STRING:
      return makeZodSchemaFromJobInputStringSchema(jobInputSchema, t);
    case InputType.TEXT:
      return makeZodSchemaFromJobInputTextSchema(jobInputSchema, t);
    case InputType.TEXTAREA:
      return makeZodSchemaFromJobInputTextareaSchema(jobInputSchema, t);
    case InputType.NUMBER:
      return makeZodSchemaFromJobInputNumberSchema(jobInputSchema, t);
    case InputType.BOOLEAN:
      return makeZodSchemaFromJobInputBooleanSchema(jobInputSchema, t);
    case InputType.EMAIL:
      return makeZodSchemaFromJobInputTextSchema(jobInputSchema, t);
    case InputType.PASSWORD:
      return makeZodSchemaFromJobInputTextSchema(jobInputSchema, t);
    case InputType.TEL:
      return makeZodSchemaFromJobInputTelSchema(jobInputSchema, t);
    case InputType.URL:
      return makeZodSchemaFromJobInputTextSchema(jobInputSchema, t);
    case InputType.DATE:
      return makeZodSchemaFromJobInputDateSchema(jobInputSchema, t);
    case InputType.DATETIME:
      return makeZodSchemaFromJobInputDatetimeSchema(jobInputSchema, t);
    case InputType.TIME:
      return makeZodSchemaFromJobInputTimeSchema(jobInputSchema, t);
    case InputType.MONTH:
      return makeZodSchemaFromJobInputMonthSchema(jobInputSchema, t);
    case InputType.WEEK:
      return makeZodSchemaFromJobInputWeekSchema(jobInputSchema, t);
    case InputType.COLOR:
      return makeZodSchemaFromJobInputColorSchema(jobInputSchema, t);
    case InputType.RANGE:
      return makeZodSchemaFromJobInputRangeSchema(jobInputSchema, t);
    case InputType.FILE:
      return makeZodSchemaFromJobInputFileSchema(jobInputSchema, t);
    case InputType.HIDDEN:
      return z.string().optional();
    case InputType.SEARCH:
      return makeZodSchemaFromJobInputTextSchema(jobInputSchema, t);
    case InputType.CHECKBOX:
      return makeZodSchemaFromJobInputCheckboxSchema(jobInputSchema, t);
    case InputType.RADIO_GROUP:
    case InputType.OPTION:
    case InputType.MULTISELECT:
      return makeZodSchemaFromJobInputOptionSchema(jobInputSchema, t);
  }
};
const makeZodSchemaFromJobInputColorSchema = (
  jobInputColorSchema: InputColorSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputColorSchema;
  const defaultSchema = z
    .string({
      error: t?.("String.required", { name }),
    })
    .refine((v) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), {
      error: t?.("String.format", { name, value: "color" }),
    });

  let canBeOptional = false;
  validations?.forEach(({ validation, value }) => {
    if (validation === InputValidation.OPTIONAL)
      canBeOptional = value === "true";
  });

  return canBeOptional ? defaultSchema.nullish() : defaultSchema;
};

const makeZodSchemaFromJobInputTextareaSchema = (
  jobInputTextareaSchema: InputTextareaSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputTextareaSchema;
  const defaultSchema = z.string({
    error: t?.("String.required", { name }),
  });
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("String.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("String.max", { name, value }),
        });
      case InputValidation.FORMAT:
        switch (value) {
          case InputFormat.NON_EMPTY:
            return acc.min(1, {
              error: t?.("String.format", { name, value }),
            });
          default:
            return acc;
        }
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputTextSchema = (
  jobInputTextSchema:
    | InputTextSchemaType
    | InputPasswordSchemaType
    | InputEmailSchemaType
    | InputUrlSchemaType
    | InputSearchSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputTextSchema;
  const defaultSchema = z.string({
    error: t?.("String.required", { name }),
  });
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("String.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("String.max", { name, value }),
        });
      case InputValidation.FORMAT:
        switch (value) {
          case InputFormat.URL:
            return acc.url({
              error: t?.("String.format", { name, value }),
            });
          case InputFormat.EMAIL:
            return acc.email({
              error: t?.("String.format", { name, value }),
            });
          case InputFormat.NON_EMPTY:
            return acc.min(1, {
              error: t?.("String.format", { name, value }),
            });
          default:
            return acc;
        }
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputStringSchema = (
  jobInputStringSchema: InputStringSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputStringSchema;
  const defaultSchema = z.string({
    error: t?.("String.required", { name }),
  });
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("String.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("String.max", { name, value }),
        });
      case InputValidation.FORMAT:
        switch (value) {
          case InputFormat.URL:
            return acc.url({
              error: t?.("String.format", { name, value }),
            });
          case InputFormat.EMAIL:
            return acc.email({
              error: t?.("String.format", { name, value }),
            });
          case InputFormat.NON_EMPTY:
            return acc.min(1, {
              error: t?.("String.format", { name, value }),
            });
          default:
            return acc;
        }
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputTelSchema = (
  jobInputTelSchema: InputTelSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputTelSchema;
  const defaultSchema = z.string({ error: t?.("String.required", { name }) });
  if (!validations) return defaultSchema;

  let canBeOptional = false;
  let min: number | undefined;
  let max: number | undefined;

  const telRegex = /^[+]?\d[\d\s().-]{3,}$/;

  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        min = Number(value);
        return acc;
      case InputValidation.MAX:
        max = Number(value);
        return acc;
      case InputValidation.FORMAT:
        // Only one allowed value for tel format for now
        return acc.regex(telRegex, {
          error: t?.("String.format", { name, value: "tel" }),
        });
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  let withLength = schema;
  if (typeof min === "number")
    withLength = withLength.min(min, {
      error: t?.("String.min", { name, value: String(min) }),
    });
  if (typeof max === "number")
    withLength = withLength.max(max, {
      error: t?.("String.max", { name, value: String(max) }),
    });

  return canBeOptional ? withLength.nullish() : withLength;
};

const makeZodSchemaFromJobInputNumberSchema = (
  jobInputNumberSchema: InputNumberSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputNumberSchema;
  const defaultSchema = z.coerce.number<number>({
    error: t?.("Number.required", { name }),
  });
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("Number.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("Number.max", { name, value }),
        });
      case InputValidation.FORMAT:
        switch (value) {
          case InputFormat.INTEGER:
            return acc.int({
              error: t?.("Number.format", { name, value }),
            });
          default:
            return acc;
        }
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullish() : schema;
};

// For Boolean Schema we can ignore validations
// because validations are only Required
// for UI, we will set default to `false`
// so undefined is not the case
const makeZodSchemaFromJobInputBooleanSchema = (
  jobInputSchema: InputBooleanSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name } = jobInputSchema;
  return z.boolean({
    error: t?.("Boolean.required", { name }),
  });
};

// Single checkbox behaves like boolean, but allows default in data
const makeZodSchemaFromJobInputCheckboxSchema = (
  jobInputSchema: InputCheckboxSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name } = jobInputSchema;
  return z.boolean({
    error: t?.("Boolean.required", { name }),
  });
};

const makeZodSchemaFromJobInputOptionSchema = (
  jobInputOptionSchema:
    | InputOptionSchemaType
    | InputMultiselectSchemaType
    | InputRadioGroupSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const {
    name,
    data: { values },
    validations,
  } = jobInputOptionSchema;
  const defaultSchema = z.array(
    z
      .int({
        error: t?.("Option.integer", { name }),
      })
      .nonnegative({
        error: t?.("Option.nonnegative", { name }),
      })
      .max(values.length - 1, {
        error: t?.("Option.invalid", { name, maxValue: values.length - 1 }),
      }),
    { error: t?.("Option.required", { name }) },
  );
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("Option.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("Option.max", { name, value }),
        });
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputFileSchema = (
  jobInputFileSchema: InputFileSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputFileSchema;
  let maxSize = 0;

  const defaultSchema = z.array(z.instanceof(File));

  const schema = validations?.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("Number.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("Number.max", { name, value }),
        });
      case InputValidation.MAX_SIZE:
        maxSize = Number(value);
        return acc;
      case InputValidation.ACCEPT:
        return acc;
    }
  }, defaultSchema);

  return (schema ?? defaultSchema).refine(
    (files) => {
      if (!maxSize) return true;
      return files.every((file) => file.size <= maxSize);
    },
    {
      error: t?.("File.maxSize", { name, value: maxSize ?? "" }),
    },
  );
};

// New builders
const makeZodSchemaFromJobInputDateSchema = (
  jobInputSchema: InputDateSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputSchema;
  let canBeOptional = false;
  let minDate: Date | undefined;
  let maxDate: Date | undefined;

  if (validations) {
    validations.forEach(({ validation, value }) => {
      if (validation === InputValidation.OPTIONAL)
        canBeOptional = value === "true";
      if (validation === InputValidation.MIN)
        minDate = typeof value === "number" ? new Date(value) : new Date(value);
      if (validation === InputValidation.MAX)
        maxDate = typeof value === "number" ? new Date(value) : new Date(value);
    });
  }

  let schema = z.coerce.date<Date>({ error: t?.("String.required", { name }) });
  if (minDate)
    schema = schema.min(minDate, {
      error: t?.("Date.min", { name, value: minDate.toLocaleDateString() }),
    });
  if (maxDate)
    schema = schema.max(maxDate, {
      error: t?.("Date.max", { name, value: maxDate.toLocaleDateString() }),
    });
  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputDatetimeSchema = (
  jobInputSchema: InputDatetimeSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputSchema;
  let canBeOptional = false;
  let minDate: Date | undefined;
  let maxDate: Date | undefined;

  if (validations) {
    validations.forEach(({ validation, value }) => {
      if (validation === InputValidation.OPTIONAL)
        canBeOptional = value === "true";
      if (validation === InputValidation.MIN)
        minDate = typeof value === "number" ? new Date(value) : new Date(value);
      if (validation === InputValidation.MAX)
        maxDate = typeof value === "number" ? new Date(value) : new Date(value);
    });
  }

  let schema = z.coerce.date<Date>({ error: t?.("String.required", { name }) });
  if (minDate)
    schema = schema.min(minDate, {
      error: t?.("Date.min", { name, value: minDate.toLocaleString() }),
    });
  if (maxDate)
    schema = schema.max(maxDate, {
      error: t?.("Date.max", { name, value: maxDate.toLocaleString() }),
    });
  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputMonthSchema = (
  jobInputSchema: InputMonthSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputSchema;
  let canBeOptional = false;
  let min: string | undefined;
  let max: string | undefined;

  validations?.forEach(({ validation, value }) => {
    if (validation === InputValidation.OPTIONAL)
      canBeOptional = value === "true";
    if (validation === InputValidation.MIN) min = String(value);
    if (validation === InputValidation.MAX) max = String(value);
  });

  let schema = z
    .string({ error: t?.("String.required", { name }) })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
      error: t?.("String.format", { name, value: "month" }),
    })
    .refine((v) => !!parseMonth(v), {
      error: t?.("String.format", { name, value: "month" }),
    });

  const minMonth = parseMonth(min);
  const maxMonth = parseMonth(max);
  if (min && minMonth)
    schema = schema.refine(
      (v) => {
        const d = parseMonth(v);
        return !!d && d.getTime() >= minMonth.getTime();
      },
      { error: t?.("Date.min", { name, value: min }) },
    );
  if (max && maxMonth)
    schema = schema.refine(
      (v) => {
        const d = parseMonth(v);
        return !!d && d.getTime() <= maxMonth.getTime();
      },
      { error: t?.("Date.max", { name, value: max }) },
    );

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputWeekSchema = (
  jobInputSchema: InputWeekSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputSchema;
  let canBeOptional = false;
  let min: string | undefined;
  let max: string | undefined;

  validations?.forEach(({ validation, value }) => {
    if (validation === InputValidation.OPTIONAL)
      canBeOptional = value === "true";
    if (validation === InputValidation.MIN) min = String(value);
    if (validation === InputValidation.MAX) max = String(value);
  });

  // HTML week input format: YYYY-Www (ISO week)
  let schema = z
    .string({ error: t?.("String.required", { name }) })
    .regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, {
      error: t?.("String.format", { name, value: "week" }),
    })
    .refine((v) => !!parseISOWeek(v), {
      error: t?.("String.format", { name, value: "week" }),
    });

  const minWeek = parseISOWeek(min);
  const maxWeek = parseISOWeek(max);
  if (min && minWeek)
    schema = schema.refine(
      (v) => {
        const d = parseISOWeek(v);
        return !!d && d.getTime() >= minWeek.getTime();
      },
      { error: t?.("Date.min", { name, value: min }) },
    );
  if (max && maxWeek)
    schema = schema.refine(
      (v) => {
        const d = parseISOWeek(v);
        return !!d && d.getTime() <= maxWeek.getTime();
      },
      { error: t?.("Date.max", { name, value: max }) },
    );

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputTimeSchema = (
  jobInputSchema: InputTimeSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputSchema;
  let canBeOptional = false;
  let minMinutes: number | undefined;
  let maxMinutes: number | undefined;
  let minHours: string | undefined;
  let maxHours: string | undefined;

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

  if (validations) {
    validations.forEach(({ validation, value }) => {
      if (validation === InputValidation.OPTIONAL)
        canBeOptional = value === "true";
      if (validation === InputValidation.MIN) {
        const v = value.toString();
        minMinutes = toMinutes(v);
        minHours = /^\d+$/.test(v) ? toHHmm(Number(v)) : v;
      }
      if (validation === InputValidation.MAX) {
        const v = value.toString();
        maxMinutes = toMinutes(v);
        maxHours = /^\d+$/.test(v) ? toHHmm(Number(v)) : v;
      }
    });
  }

  let schema = z
    .string({ error: t?.("String.required", { name }) })
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, {
      error: t?.("String.format", { name, value: "time" }),
    });

  if (typeof minMinutes === "number" && Number.isFinite(minMinutes))
    schema = schema.refine((v) => toMinutes(v) >= minMinutes!, {
      error: t?.("Number.min", { name, value: minHours ?? "" }),
    });
  if (typeof maxMinutes === "number" && Number.isFinite(maxMinutes))
    schema = schema.refine((v) => toMinutes(v) <= maxMinutes!, {
      error: t?.("Number.max", { name, value: maxHours ?? "" }),
    });

  return canBeOptional ? schema.nullish() : schema;
};

const makeZodSchemaFromJobInputRangeSchema = (
  jobInputSchema: InputRangeSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputSchema;
  const defaultSchema = z.coerce.number<number>({
    error: t?.("Number.required", { name }),
  });

  // Step and default value are in data for Range
  const step = jobInputSchema.data?.step;

  let canBeOptional = false;

  const schema = (validations ?? []).reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case InputValidation.MIN:
        return acc.min(Number(value), {
          error: t?.("Number.min", { name, value }),
        });
      case InputValidation.MAX:
        return acc.max(Number(value), {
          error: t?.("Number.max", { name, value }),
        });
      case InputValidation.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
      default:
        return acc;
    }
  }, defaultSchema);

  const withStep =
    typeof step === "number"
      ? schema.refine(
          (v) => {
            const min = Number(
              (validations ?? []).find(
                (v) => v.validation === InputValidation.MIN,
              )?.value ?? 0,
            );
            const num = Number(v);
            return (
              Number.isFinite(num) &&
              Number.isFinite(step!) &&
              (num - min) % step! === 0
            );
          },
          { error: t?.("Number.format", { name, value: "step" }) },
        )
      : schema;

  return canBeOptional ? withStep.nullish() : withStep;
};
