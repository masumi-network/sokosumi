import { z } from "zod";

import {
  InputBooleanSchema,
  InputNoneSchema,
  InputNumberSchema,
  InputOptionSchema,
  InputStringSchema,
  JobInputSchemaIntlPath,
} from "./type";

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  InputStringSchema(t)
    .or(InputNumberSchema(t))
    .or(InputBooleanSchema(t))
    .or(InputOptionSchema(t))
    .or(InputNoneSchema(t));

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;
