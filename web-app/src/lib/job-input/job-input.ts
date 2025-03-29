import { z } from "zod";

import { JobInputSchemaIntlPath, ValidJobInputTypes } from "./type";
import { isTypeAndValidationValid } from "./util";
import { validationSchema } from "./validation";

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  z
    .object({
      id: z.string().nonempty({
        message: t?.("Id.required"),
      }),
      type: z.enum(ValidJobInputTypes, {
        message: t?.("Type.enum", {
          options: ValidJobInputTypes.join(", "),
        }),
      }),
      name: z
        .string()
        .nonempty({
          message: t?.("Name.required"),
        })
        .min(2, { message: t?.("Name.min") })
        .max(128, {
          message: t?.("Name.max"),
        }),
      data: z.object({
        values: z
          .array(
            z.string().min(1, {
              message: t?.("Data.Values.value.required"),
            }),
          )
          .min(1, { message: t?.("Data.Values.min") })
          .optional(),
        placeholder: z
          .string()
          .nonempty({
            message: t?.("Data.Placeholder.required"),
          })
          .min(2, { message: t?.("Data.Placeholder.min") })
          .max(128, {
            message: t?.("Data.Placeholder.max"),
          }),
        description: z
          .string()
          .min(2, { message: t?.("Data.Description.min") })
          .max(128, { message: t?.("Data.Description.max") })
          .optional(),
      }),
      validations: z.array(validationSchema(t)).optional(),
    })
    .superRefine((val, ctx) => {
      const { type, data, validations } = val;
      // check type and validations
      if (validations) {
        const isValidationsValid = validations.every((validation) =>
          isTypeAndValidationValid(type, validation.validation),
        );
        if (!isValidationsValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t?.("invalidValidations", { type }),
            path: ["validations"],
          });
        }
      }
      // check values for option type
      if (type === "option" && !data.values) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("optionValuesRequired"),
          path: ["data", "values"],
        });
      } else if (type !== "option" && !!data.values) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("noDataValues"),
          path: ["data", "values"],
        });
      }
    });

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;
