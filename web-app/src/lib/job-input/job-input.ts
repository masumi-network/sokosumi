import { z } from "zod";

import { JobInputSchemaIntlPath, ValidJobInputTypes } from "./type";
import {
  formatNumberValidationSchema,
  formatStringValidationSchema,
  maxValidationSchema,
  minValidationSchema,
  requiredValidationSchema,
} from "./validation";

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  z
    .object({
      id: z.string().nonempty({
        message: t?.("Id.required"),
      }),
      type: z.enum([ValidJobInputTypes.String], {
        message: t?.("Type.enum", {
          options: Object.values(ValidJobInputTypes).join(", "),
        }),
      }),
      name: z.string().nonempty({
        message: t?.("Name.required"),
      }),
      data: z.object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      }),
      validations: z
        .array(
          requiredValidationSchema(t)
            .or(minValidationSchema(t))
            .or(maxValidationSchema(t))
            .or(formatStringValidationSchema(t)),
        )
        .optional(),
    })
    .or(
      z.object({
        id: z.string().nonempty({
          message: t?.("Id.required"),
        }),
        type: z.enum([ValidJobInputTypes.Number], {
          message: t?.("Type.enum", {
            options: Object.values(ValidJobInputTypes).join(", "),
          }),
        }),
        name: z.string().nonempty({
          message: t?.("Name.required"),
        }),
        data: z.object({
          placeholder: z.string().optional(),
          description: z.string().optional(),
        }),
        validations: z
          .array(
            requiredValidationSchema(t)
              .or(minValidationSchema(t))
              .or(maxValidationSchema(t))
              .or(formatNumberValidationSchema(t)),
          )
          .optional(),
      }),
    )
    .or(
      z.object({
        id: z.string().nonempty({
          message: t?.("Id.required"),
        }),
        type: z.enum([ValidJobInputTypes.Boolean], {
          message: t?.("Type.enum", {
            options: Object.values(ValidJobInputTypes).join(", "),
          }),
        }),
        name: z.string().nonempty({
          message: t?.("Name.required"),
        }),
        data: z.object({
          placeholder: z.string().optional(),
          description: z.string().optional(),
        }),
        validations: z.array(requiredValidationSchema(t)).optional(),
      }),
    )
    .or(
      z.object({
        id: z.string().nonempty({
          message: t?.("Id.required"),
        }),
        type: z.enum([ValidJobInputTypes.Option], {
          message: t?.("Type.enum", {
            options: Object.values(ValidJobInputTypes).join(", "),
          }),
        }),
        name: z.string().nonempty({
          message: t?.("Name.required"),
        }),
        data: z.object({
          values: z
            .array(
              z.string().min(1, {
                message: t?.("Data.Values.value.required"),
              }),
            )
            .min(1, { message: t?.("Data.Values.min") }),
          placeholder: z.string().optional(),
          description: z.string().optional(),
        }),
        validations: z
          .array(
            requiredValidationSchema(t)
              .or(minValidationSchema(t))
              .or(maxValidationSchema(t)),
          )
          .optional(),
      }),
    )
    .or(
      z.object({
        id: z.string().nonempty({
          message: t?.("Id.required"),
        }),
        type: z.enum([ValidJobInputTypes.None], {
          message: t?.("Type.enum", {
            options: Object.values(ValidJobInputTypes).join(", "),
          }),
        }),
        name: z.string().nonempty({
          message: t?.("Name.required"),
        }),
        data: z.object({
          description: z.string().optional(),
        }),
      }),
    );

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;
