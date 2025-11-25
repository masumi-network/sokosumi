import * as z from "zod";

import {
  JobInputSchemaIntlPath,
  requiredJobInputFileValidationTypes,
  ValidJobInputTypes,
} from "./type";
import {
  acceptValidationSchema,
  formatEmailValidationSchema,
  formatIntegerValidationSchema,
  formatNonEmptyValidationSchema,
  formatTelPatternValidationSchema,
  formatUrlValidationSchema,
  maxSizeValidationSchema,
  maxValidationSchema,
  minValidationSchema,
  optionalValidationSchema,
} from "./validation";

/*
 * @deprecated This was a placeholder and is superseded by jobInputSchema.
 *
 */
export const jobInputDataSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    input_data: z.array(jobInputSchema(t)),
  });

/*
 * @deprecated This was a placeholder and is superseded by JobInputSchemaType.
 */
export type JobInputDataSchemaType = z.infer<
  ReturnType<typeof jobInputDataSchema>
>;

export const jobInputGroupSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    input_data: z.array(jobInputSchema(t)),
  });

export type JobInputGroupSchemaType = z.infer<
  ReturnType<typeof jobInputGroupSchema>
>;

export const jobInputsSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) => {
  const inputDataSchema = z.object({
    input_data: z.array(jobInputSchema(t)),
  });

  const inputGroupsSchema = z.object({
    input_groups: z.array(jobInputGroupSchema(t)),
  });

  return z.union([inputDataSchema, inputGroupsSchema]).refine(
    (data) => {
      const hasInputData = "input_data" in data;
      const hasInputGroups = "input_groups" in data;
      return hasInputData !== hasInputGroups; // Exactly one must be present
    },
    {
      message: "Must provide exactly one of 'input_data' or 'input_groups'",
    },
  );
};

export type JobInputsSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  jobInputNoneSchema(t)
    .or(jobInputStringSchema(t))
    .or(jobInputTextSchema(t))
    .or(jobInputTextareaSchema(t))
    .or(jobInputNumberSchema(t))
    .or(jobInputBooleanSchema(t))
    .or(jobInputEmailSchema(t))
    .or(jobInputPasswordSchema(t))
    .or(jobInputTelSchema(t))
    .or(jobInputUrlSchema(t))
    .or(jobInputDateSchema(t))
    .or(jobInputDatetimeSchema(t))
    .or(jobInputTimeSchema(t))
    .or(jobInputMonthSchema(t))
    .or(jobInputWeekSchema(t))
    .or(jobInputColorSchema(t))
    .or(jobInputRangeSchema(t))
    .or(jobInputFileSchema(t))
    .or(jobInputHiddenSchema(t))
    .or(jobInputSearchSchema(t))
    .or(jobInputCheckboxSchema(t))
    .or(jobInputRadioGroupSchema(t))
    .or(jobInputOptionSchema(t))
    .or(jobInputMultiselectSchema(t));

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;

export const jobInputNoneSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.NONE], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        description: z.string().min(1).nullish(),
      })
      .nullish(),
  });

export type JobInputNoneSchemaType = z.infer<
  ReturnType<typeof jobInputNoneSchema>
>;

export const jobInputStringSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.STRING], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatUrlValidationSchema(t))
          .or(formatEmailValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputStringSchemaType = z.infer<
  ReturnType<typeof jobInputStringSchema>
>;

export const jobInputTextSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TEXT], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatUrlValidationSchema(t))
          .or(formatEmailValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputTextSchemaType = z.infer<
  ReturnType<typeof jobInputTextSchema>
>;

export const jobInputTextareaSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TEXTAREA], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputTextareaSchemaType = z.infer<
  ReturnType<typeof jobInputTextareaSchema>
>;

export const jobInputNumberSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.NUMBER], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatIntegerValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputNumberSchemaType = z.infer<
  ReturnType<typeof jobInputNumberSchema>
>;

export const jobInputBooleanSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.BOOLEAN], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z.array(optionalValidationSchema(t)).nullish(),
  });

export type JobInputBooleanSchemaType = z.infer<
  ReturnType<typeof jobInputBooleanSchema>
>;

export const jobInputEmailSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.EMAIL], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatEmailValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputEmailSchemaType = z.infer<
  ReturnType<typeof jobInputEmailSchema>
>;

export const jobInputPasswordSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.PASSWORD], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputPasswordSchemaType = z.infer<
  ReturnType<typeof jobInputPasswordSchema>
>;

export const jobInputTelSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TEL], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatTelPatternValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputTelSchemaType = z.infer<
  ReturnType<typeof jobInputTelSchema>
>;

export const jobInputUrlSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.URL], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatUrlValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputUrlSchemaType = z.infer<
  ReturnType<typeof jobInputUrlSchema>
>;

export const jobInputDateSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.DATE], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputDateSchemaType = z.infer<
  ReturnType<typeof jobInputDateSchema>
>;

export const jobInputDatetimeSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.DATETIME], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputDatetimeSchemaType = z.infer<
  ReturnType<typeof jobInputDatetimeSchema>
>;

export const jobInputTimeSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TIME], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputTimeSchemaType = z.infer<
  ReturnType<typeof jobInputTimeSchema>
>;

export const jobInputMonthSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { error: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.MONTH], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { error: t?.("Name.required") }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputMonthSchemaType = z.infer<
  ReturnType<typeof jobInputMonthSchema>
>;

export const jobInputWeekSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { error: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.WEEK], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { error: t?.("Name.required") }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputWeekSchemaType = z.infer<
  ReturnType<typeof jobInputWeekSchema>
>;

export const jobInputColorSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.COLOR], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        default: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z.array(optionalValidationSchema(t)).nullish(),
  });

export type JobInputColorSchemaType = z.infer<
  ReturnType<typeof jobInputColorSchema>
>;

export const jobInputRangeSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.RANGE], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z
      .object({
        description: z.string().nullish(),
        step: z.coerce.number().min(0).nullish(),
        default: z.coerce.number().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputRangeSchemaType = z.infer<
  ReturnType<typeof jobInputRangeSchema>
>;

export const jobInputFileSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.FILE], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z.object({
      description: z.string().nullish(),
      outputFormat: z.string().nullish(),
    }),
    validations: z
      .array(
        acceptValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(maxSizeValidationSchema(t)),
      )
      .refine(
        (validations) => {
          for (const validationType of requiredJobInputFileValidationTypes) {
            if (
              validations.find((v) => v.validation === validationType) ===
              undefined
            ) {
              return false;
            }
          }
          return true;
        },
        {
          error: t?.("Validations.fileInvalid"),
        },
      ),
  });

export type JobInputFileSchemaType = z.infer<
  ReturnType<typeof jobInputFileSchema>
>;

export const jobInputHiddenSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { error: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.HIDDEN], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { error: t?.("Name.required") }),
    data: z
      .object({
        value: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z.array(optionalValidationSchema(t)).nullish(),
  });

export type JobInputHiddenSchemaType = z.infer<
  ReturnType<typeof jobInputHiddenSchema>
>;

export const jobInputSearchSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { error: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.SEARCH], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { error: t?.("Name.required") }),
    data: z
      .object({
        placeholder: z.string().nullish(),
        description: z.string().nullish(),
      })
      .nullish(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputSearchSchemaType = z.infer<
  ReturnType<typeof jobInputSearchSchema>
>;

export const jobInputCheckboxSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.CHECKBOX], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z.object({
      label: z.string().nullish(),
      description: z.string().nullish(),
      default: z.boolean().nullish(),
    }),
    validations: z.array(optionalValidationSchema(t)).nullish(),
  });

export type JobInputCheckboxSchemaType = z.infer<
  ReturnType<typeof jobInputCheckboxSchema>
>;

export const jobInputRadioGroupSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.RADIO_GROUP], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            error: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { error: t?.("Data.Values.min") })
        .refine((items) => new Set(items).size === items.length, {
          error: t?.("Data.Values.unique"),
        }),
      description: z.string().nullish(),
    }),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputRadioGroupSchemaType = z.infer<
  ReturnType<typeof jobInputRadioGroupSchema>
>;

export const jobInputOptionSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.OPTION], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            error: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { error: t?.("Data.Values.min") })
        .refine((items) => new Set(items).size === items.length, {
          error: t?.("Data.Values.unique"),
        }),
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    }),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputOptionSchemaType = z.infer<
  ReturnType<typeof jobInputOptionSchema>
>;

export const jobInputMultiselectSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      error: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.MULTISELECT], {
      error: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      error: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            error: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { error: t?.("Data.Values.min") })
        .refine((items) => new Set(items).size === items.length, {
          error: t?.("Data.Values.unique"),
        }),
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    }),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .nullish(),
  });

export type JobInputMultiselectSchemaType = z.infer<
  ReturnType<typeof jobInputMultiselectSchema>
>;
