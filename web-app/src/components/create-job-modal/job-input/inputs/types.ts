import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import {
  JobInputSchemaType,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

export interface JobInputComponentProps<
  T extends ValidJobInputTypes,
  S extends JobInputSchemaType,
> {
  id: string;
  jobInputSchema: S["type"] extends T ? S : never;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
}
