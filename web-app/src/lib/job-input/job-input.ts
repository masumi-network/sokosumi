import { z } from "zod";

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

export const jobInputsDataSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    input_data: z.array(jobInputSchema(t)),
  });

export type JobInputsDataSchemaType = z.infer<
  ReturnType<typeof jobInputsDataSchema>
>;

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  jobInputNoneSchema(t)
    .or(jobInputStringSchema(t))
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
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.NONE], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        description: z.string().min(1).optional(),
      })
      .optional(),
  });

export type JobInputNoneSchemaType = z.infer<
  ReturnType<typeof jobInputNoneSchema>
>;

export const jobInputStringSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.STRING], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatUrlValidationSchema(t))
          .or(formatEmailValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputStringSchemaType = z.infer<
  ReturnType<typeof jobInputStringSchema>
>;

export const jobInputTextareaSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TEXTAREA], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputTextareaSchemaType = z.infer<
  ReturnType<typeof jobInputTextareaSchema>
>;

export const jobInputNumberSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.NUMBER], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatIntegerValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputNumberSchemaType = z.infer<
  ReturnType<typeof jobInputNumberSchema>
>;

export const jobInputBooleanSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.BOOLEAN], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z.array(optionalValidationSchema(t)).optional(),
  });

export type JobInputBooleanSchemaType = z.infer<
  ReturnType<typeof jobInputBooleanSchema>
>;

export const jobInputEmailSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.EMAIL], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatEmailValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputEmailSchemaType = z.infer<
  ReturnType<typeof jobInputEmailSchema>
>;

export const jobInputPasswordSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.PASSWORD], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputPasswordSchemaType = z.infer<
  ReturnType<typeof jobInputPasswordSchema>
>;

export const jobInputTelSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TEL], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatTelPatternValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputTelSchemaType = z.infer<
  ReturnType<typeof jobInputTelSchema>
>;

export const jobInputUrlSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.URL], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatUrlValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputUrlSchemaType = z.infer<
  ReturnType<typeof jobInputUrlSchema>
>;

export const jobInputDateSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.DATE], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputDateSchemaType = z.infer<
  ReturnType<typeof jobInputDateSchema>
>;

export const jobInputDatetimeSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.DATETIME], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputDatetimeSchemaType = z.infer<
  ReturnType<typeof jobInputDatetimeSchema>
>;

export const jobInputTimeSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.TIME], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputTimeSchemaType = z.infer<
  ReturnType<typeof jobInputTimeSchema>
>;

export const jobInputMonthSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { message: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.MONTH], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { message: t?.("Name.required") }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputMonthSchemaType = z.infer<
  ReturnType<typeof jobInputMonthSchema>
>;

export const jobInputWeekSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { message: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.WEEK], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { message: t?.("Name.required") }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputWeekSchemaType = z.infer<
  ReturnType<typeof jobInputWeekSchema>
>;

export const jobInputColorSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.COLOR], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        default: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z.array(optionalValidationSchema(t)).optional(),
  });

export type JobInputColorSchemaType = z.infer<
  ReturnType<typeof jobInputColorSchema>
>;

export const jobInputRangeSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.RANGE], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        description: z.string().optional(),
        step: z.coerce.number().min(0).optional(),
        default: z.coerce.number().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputRangeSchemaType = z.infer<
  ReturnType<typeof jobInputRangeSchema>
>;

export const jobInputFileSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.FILE], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z.object({
      description: z.string().optional(),
      outputFormat: z.string().optional(),
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
          message: t?.("Validations.fileInvalid"),
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
    id: z.string().min(1, { message: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.HIDDEN], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { message: t?.("Name.required") }),
    data: z
      .object({
        value: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z.array(optionalValidationSchema(t)).optional(),
  });

export type JobInputHiddenSchemaType = z.infer<
  ReturnType<typeof jobInputHiddenSchema>
>;

export const jobInputSearchSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, { message: t?.("Id.required") }),
    type: z.enum([ValidJobInputTypes.SEARCH], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, { message: t?.("Name.required") }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputSearchSchemaType = z.infer<
  ReturnType<typeof jobInputSearchSchema>
>;

export const jobInputCheckboxSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.CHECKBOX], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z.object({
      label: z.string().optional(),
      description: z.string().optional(),
      default: z.boolean().optional(),
    }),
    validations: z.array(optionalValidationSchema(t)).optional(),
  });

export type JobInputCheckboxSchemaType = z.infer<
  ReturnType<typeof jobInputCheckboxSchema>
>;

export const jobInputRadioGroupSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.RADIO_GROUP], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            message: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { message: t?.("Data.Values.min") })
        .refine((items) => new Set(items).size === items.length, {
          message: t?.("Data.Values.unique"),
        }),
      description: z.string().optional(),
    }),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputRadioGroupSchemaType = z.infer<
  ReturnType<typeof jobInputRadioGroupSchema>
>;

export const jobInputOptionSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.OPTION], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            message: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { message: t?.("Data.Values.min") })
        .refine((items) => new Set(items).size === items.length, {
          message: t?.("Data.Values.unique"),
        }),
      placeholder: z.string().optional(),
      description: z.string().optional(),
    }),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputOptionSchemaType = z.infer<
  ReturnType<typeof jobInputOptionSchema>
>;

export const jobInputMultiselectSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.MULTISELECT], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            message: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { message: t?.("Data.Values.min") })
        .refine((items) => new Set(items).size === items.length, {
          message: t?.("Data.Values.unique"),
        }),
      placeholder: z.string().optional(),
      description: z.string().optional(),
    }),
    validations: z
      .array(
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export type JobInputMultiselectSchemaType = z.infer<
  ReturnType<typeof jobInputMultiselectSchema>
>;
