import type {
  InputCheckboxSchemaType,
  InputColorSchemaType,
  InputDateSchemaType,
  InputDatetimeSchemaType,
  InputFieldSchemaType,
  InputFileSchemaType,
  InputMonthSchemaType,
  InputMultiselectSchemaType,
  InputNumberSchemaType,
  InputOptionSchemaType,
  InputRadioGroupSchemaType,
  InputRangeSchemaType,
  InputTelSchemaType,
  InputTextareaSchemaType,
  InputTimeSchemaType,
  InputWeekSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import * as z from "zod";

import {
  applyColorValidations,
  applyDateStringValidations,
  applyDatetimeLocalValidations,
  applyFileValidations,
  applyMonthValidations,
  applyNumericValidations,
  applyOptionValidations,
  applyRangeValidations,
  applyStringValidations,
  applyTelValidations,
  applyTextareaValidations,
  applyTimeValidations,
  applyWeekValidations,
  isBooleanType,
  isStringBasedType,
} from "./form-schema-helpers";
import { getOptionSelectMode } from "./option-select-mode";
import type { JobInputFormIntlPath } from "./type";

/**
 * String-based input types that share common validation logic
 */
type StringBasedInputSchemaType = {
  name: string;
  validations?: Array<{ validation: string; value: string | number }> | null;
};

function makeZodSchemaForStringType(
  jobInputSchema: StringBasedInputSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;
  const defaultSchema = z.string({
    error: t?.("String.required", { name }),
  });

  return applyStringValidations(
    defaultSchema,
    validations as Parameters<typeof applyStringValidations>[1],
    name,
    t,
  );
}

function makeZodSchemaForTextareaType(
  jobInputSchema: InputTextareaSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;
  const defaultSchema = z.string({
    error: t?.("String.required", { name }),
  });

  return applyTextareaValidations(
    defaultSchema,
    validations as Parameters<typeof applyTextareaValidations>[1],
    name,
    t,
  );
}

function makeZodSchemaForTelType(
  jobInputSchema: InputTelSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyTelValidations(
    validations as Parameters<typeof applyTelValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForNumberType(
  jobInputSchema: InputNumberSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;
  const defaultSchema = z.coerce.number<number>({
    error: t?.("Number.required", { name }),
  });

  return applyNumericValidations(
    defaultSchema,
    validations as Parameters<typeof applyNumericValidations>[1],
    name,
    t,
  );
}

function makeZodSchemaForRangeType(
  jobInputSchema: InputRangeSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations, data } = jobInputSchema;

  return applyRangeValidations(
    validations as Parameters<typeof applyRangeValidations>[0],
    data?.step,
    name,
    t,
  );
}

function makeZodSchemaForBooleanType(
  jobInputSchema: { name: string },
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodBoolean {
  const { name } = jobInputSchema;
  return z.boolean({
    error: t?.("Boolean.required", { name }),
  });
}

function makeZodSchemaForDateType(
  jobInputSchema: InputDateSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyDateStringValidations(
    validations as Parameters<typeof applyDateStringValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForDatetimeType(
  jobInputSchema: InputDatetimeSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyDatetimeLocalValidations(
    validations as Parameters<typeof applyDatetimeLocalValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForTimeType(
  jobInputSchema: InputTimeSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyTimeValidations(
    validations as Parameters<typeof applyTimeValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForMonthType(
  jobInputSchema: InputMonthSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyMonthValidations(
    validations as Parameters<typeof applyMonthValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForWeekType(
  jobInputSchema: InputWeekSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyWeekValidations(
    validations as Parameters<typeof applyWeekValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForColorType(
  jobInputSchema: InputColorSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyColorValidations(
    validations as Parameters<typeof applyColorValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForFileType(
  jobInputSchema: InputFileSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const { name, validations } = jobInputSchema;

  return applyFileValidations(
    validations as Parameters<typeof applyFileValidations>[0],
    name,
    t,
  );
}

function makeZodSchemaForOptionType(
  jobInputSchema: InputOptionSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const {
    name,
    data: { values },
    validations,
  } = jobInputSchema;

  return applyOptionValidations(
    values.length,
    validations as Parameters<typeof applyOptionValidations>[1],
    getOptionSelectMode(validations),
    name,
    t,
  );
}

function makeZodSchemaForMultiselectType(
  jobInputSchema: InputMultiselectSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const {
    name,
    data: { values },
    validations,
  } = jobInputSchema;

  return applyOptionValidations(
    values.length,
    validations as Parameters<typeof applyOptionValidations>[1],
    "multi",
    name,
    t,
  );
}

function makeZodSchemaForRadioGroupType(
  jobInputSchema: InputRadioGroupSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny {
  const {
    name,
    data: { values },
    validations,
  } = jobInputSchema;

  return applyOptionValidations(
    values.length,
    validations as Parameters<typeof applyOptionValidations>[1],
    "single",
    name,
    t,
  );
}

export const makeZodSchemaFromJobInputSchema = (
  jobInputSchema: InputFieldSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
): z.ZodTypeAny => {
  const { type } = jobInputSchema;

  if (type === InputType.NONE) {
    return z.never().nullable();
  }

  if (type === InputType.HIDDEN) {
    return z.string().optional();
  }

  // Handle boolean types (BOOLEAN, CHECKBOX)
  if (isBooleanType(type)) {
    return makeZodSchemaForBooleanType(
      jobInputSchema as InputCheckboxSchemaType,
      t,
    );
  }

  // Handle string-based types (STRING, TEXT, EMAIL, PASSWORD, URL, SEARCH)
  if (isStringBasedType(type)) {
    return makeZodSchemaForStringType(jobInputSchema, t);
  }

  // Handle remaining types with specific handlers
  switch (type) {
    case InputType.TEXTAREA:
      return makeZodSchemaForTextareaType(
        jobInputSchema as InputTextareaSchemaType,
        t,
      );

    case InputType.TEL:
      return makeZodSchemaForTelType(jobInputSchema as InputTelSchemaType, t);

    case InputType.NUMBER:
      return makeZodSchemaForNumberType(
        jobInputSchema as InputNumberSchemaType,
        t,
      );

    case InputType.RANGE:
      return makeZodSchemaForRangeType(
        jobInputSchema as InputRangeSchemaType,
        t,
      );

    case InputType.DATE:
      return makeZodSchemaForDateType(jobInputSchema as InputDateSchemaType, t);

    case InputType.DATETIME:
      return makeZodSchemaForDatetimeType(
        jobInputSchema as InputDatetimeSchemaType,
        t,
      );

    case InputType.TIME:
      return makeZodSchemaForTimeType(jobInputSchema as InputTimeSchemaType, t);

    case InputType.MONTH:
      return makeZodSchemaForMonthType(
        jobInputSchema as InputMonthSchemaType,
        t,
      );

    case InputType.WEEK:
      return makeZodSchemaForWeekType(jobInputSchema as InputWeekSchemaType, t);

    case InputType.COLOR:
      return makeZodSchemaForColorType(
        jobInputSchema as InputColorSchemaType,
        t,
      );

    case InputType.FILE:
      return makeZodSchemaForFileType(jobInputSchema as InputFileSchemaType, t);

    case InputType.OPTION:
      return makeZodSchemaForOptionType(
        jobInputSchema as InputOptionSchemaType,
        t,
      );

    case InputType.MULTISELECT:
      return makeZodSchemaForMultiselectType(
        jobInputSchema as InputMultiselectSchemaType,
        t,
      );

    case InputType.RADIO_GROUP:
      return makeZodSchemaForRadioGroupType(
        jobInputSchema as InputRadioGroupSchemaType,
        t,
      );

    default:
      // Fallback for any unhandled types
      return z.unknown();
  }
};
