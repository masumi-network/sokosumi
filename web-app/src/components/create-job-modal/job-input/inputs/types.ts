import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import { JobInputSchemaType, JobInputsFormSchemaType } from "@/lib/job-input";

export interface JobInputComponentProps {
  id: string;
  jobInputSchema: JobInputSchemaType;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
}
