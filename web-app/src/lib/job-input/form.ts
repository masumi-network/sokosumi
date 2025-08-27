import { z } from "zod";

import { makeZodSchemaFromJobInputSchema } from "./form-schema";
import { JobInputSchemaType } from "./job-input";
import { JobInputData, JobInputFormIntlPath, ValidJobInputTypes } from "./type";

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

export function filterOutNullValues(
  values: JobInputsFormSchemaType,
): JobInputData {
  return new Map(
    Object.entries(values).filter(([_, value]) => value !== null) as [
      string,
      (
        | string
        | string[]
        | number
        | boolean
        | number[]
        | File
        | File[]
        | undefined
      ),
    ][],
  );
}

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
    case ValidJobInputTypes.TEL:
      return null;
    case ValidJobInputTypes.RANGE:
      return jobInputSchema.data?.default ?? null;
    case ValidJobInputTypes.COLOR:
      return jobInputSchema.data?.default ?? "#000000";
    case ValidJobInputTypes.HIDDEN:
      return jobInputSchema.data?.value ?? "";
    case ValidJobInputTypes.BOOLEAN:
      return false;
    case ValidJobInputTypes.CHECKBOX:
      return (
        (jobInputSchema.data as { default?: boolean } | undefined)?.default ??
        false
      );
    case ValidJobInputTypes.NUMBER:
      return null;
    case ValidJobInputTypes.OPTION:
      return null;
    case ValidJobInputTypes.FILE:
      return null;
    case ValidJobInputTypes.MULTISELECT:
      return null;
    // checkbox group removed
    case ValidJobInputTypes.RADIO_GROUP:
      return null;
    case ValidJobInputTypes.DATE:
      return null;
    case ValidJobInputTypes.DATETIME:
      return null;
    case ValidJobInputTypes.TIME:
      return null;
    case ValidJobInputTypes.NONE:
      return null;
  }
};
