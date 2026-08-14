import type { InputNoneSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import Markdown from "@/components/markdown";

import type { JobInputComponentProps } from "./types";

export function NoneInput({
  jobInputSchema,
}: JobInputComponentProps<InputType.NONE, InputNoneSchemaType>) {
  const description = jobInputSchema.data?.description;

  if (!description) {
    return null;
  }

  return (
    <div className="">
      <Markdown className="text-foreground/80">{description}</Markdown>
    </div>
  );
}
