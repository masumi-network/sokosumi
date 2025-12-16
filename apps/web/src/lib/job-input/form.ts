import { InputSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import * as z from "zod";

import { makeZodSchemaFromJobInputSchema } from "./form-schema";
import { JobInputData, JobInputFormIntlPath } from "./type";

export const jobInputsFormSchema = (
  jobInputSchemas: InputSchemaType[],
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
  return Object.fromEntries(
    Object.entries(values).filter(
      ([_, value]) => value !== null && value !== undefined,
    ),
  ) as JobInputData;
}

export const defaultValues = (jobInputSchemas: InputSchemaType[]) => {
  return Object.fromEntries(
    jobInputSchemas.map((jobInputSchema) => {
      return [jobInputSchema.id, getDefaultValue(jobInputSchema)];
    }),
  );
};

const getDefaultValue = (jobInputSchema: InputSchemaType) => {
  const { type } = jobInputSchema;
  switch (type) {
    case InputType.BOOLEAN:
      return false;
    case InputType.COLOR:
      return jobInputSchema.data?.default ?? "#000000";
    case InputType.RANGE:
      return jobInputSchema.data?.default ?? null;
    case InputType.HIDDEN:
      return jobInputSchema.data?.value ?? "";
    case InputType.CHECKBOX:
      return jobInputSchema.data?.default ?? false;
    default:
      return null;
  }
};
