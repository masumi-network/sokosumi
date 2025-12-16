import { InputSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import { JobInputsFormSchemaType } from "@/lib/job-input";

export interface JobInputComponentProps<
  T extends InputType,
  S extends InputSchemaType,
> {
  id: string;
  jobInputSchema: S["type"] extends T ? S : never;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
}
