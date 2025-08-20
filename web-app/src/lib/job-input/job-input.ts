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
  jobInputStringSchema(t)
    .or(jobInputTextareaSchema(t))
    .or(jobInputNumberSchema(t))
    .or(jobInputBooleanSchema(t))
    .or(jobInputOptionSchema(t))
    .or(jobInputFileSchema(t))
    .or(jobInputNoneSchema(t));

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;

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
