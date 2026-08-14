import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";
import type { AriaAttributes } from "react";
import type { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import type { JobInputsFormSchemaType } from "@/lib/job-input";

/** Accessibility attrs injected by FormControl (Slot) onto the focusable control. */
export type JobInputControlProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid"
> & {
  id?: string;
};

export interface JobInputComponentProps<
  T extends InputType,
  S extends InputFieldSchemaType,
> {
  id: string;
  jobInputSchema: S["type"] extends T ? S : never;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
  controlProps?: JobInputControlProps;
}
