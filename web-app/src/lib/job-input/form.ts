import { z } from "zod";

import { makeZodSchemaFromJobInputSchema } from "./form-schema";
import { JobInputSchemaType } from "./job-input";
import { JobInputFormIntlPath, ValidJobInputTypes } from "./type";

export const jobInputsFormSchema = (
  jobInputSchemas: JobInputSchemaType[],
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

export type JobInputsFormSchemaType = z.infer<
  ReturnType<typeof jobInputsFormSchema>
>;

export const defaultValues = (jobInputSchemas: JobInputSchemaType[]) => {
  return Object.fromEntries(
    jobInputSchemas.map((jobInputSchema) => {
      return [jobInputSchema.id, getDefaultValue(jobInputSchema)];
    }),
  );
};

const getDefaultValue = (jobInputSchema: JobInputSchemaType) => {
  const { type } = jobInputSchema;
  switch (type) {
    case ValidJobInputTypes.STRING:
      return null;
    case ValidJobInputTypes.BOOLEAN:
      return false;
    case ValidJobInputTypes.NUMBER:
      return null;
    case ValidJobInputTypes.OPTION:
      return null;
    case ValidJobInputTypes.NONE:
      return null;
  }
};
