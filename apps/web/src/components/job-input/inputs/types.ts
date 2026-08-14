import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";
import type { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import type { JobInputsFormSchemaType } from "@/lib/job-input";

export interface JobInputComponentProps<
  T extends InputType,
  S extends InputFieldSchemaType,
> {
  id: string;
  jobInputSchema: S["type"] extends T ? S : never;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
}
