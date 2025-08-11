import { AgentDemoData } from "@/lib/db";
import {
  filterOutNullValues,
  JobInputData,
  JobInputSchemaType,
  jobInputsFormSchema,
} from "@/lib/job-input";
import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
} from "@/lib/schemas";

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
