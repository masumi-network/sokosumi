import { z } from "zod";

import { AgentDemoData } from "@/lib/db";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
} from "@/lib/schemas";

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
      string | number | boolean | number[],
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

export const getDemoValues = (
  jobInputSchemas: JobInputSchemaType[],
  demoData: AgentDemoData,
): { input: JobInputData; output: JobStatusResponseSchemaType } | null => {
  const { input, output } = demoData;
  try {
    const inputParsedResult = jobInputsFormSchema(jobInputSchemas).safeParse(
      JSON.parse(input),
    );
    let inputValue;
    if (inputParsedResult.success) {
      inputValue = filterOutNullValues(inputParsedResult.data);
    }

    const outputParsedResult = jobStatusResponseSchema.safeParse(
      JSON.parse(output),
    );
    let outputValue;
    if (outputParsedResult.success) {
      outputValue = outputParsedResult.data;
    }

    if (inputValue && outputValue) {
      return { input: inputValue, output: outputValue };
    } else {
      console.error("Invalid demo data", { input, output });
      return null;
    }
  } catch (error) {
    console.error("Invalid JSON for demo data", error);
    return null;
  }
};
