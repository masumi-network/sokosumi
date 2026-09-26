import type { InputNoneSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import Markdown from "@/components/markdown";

import type { JobInputComponentProps } from "./types";

export function NoneInput({
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<typeof InputType.NONE, InputNoneSchemaType>) {
  const description = jobInputSchema.data?.description;

  if (!description) {
    return null;
  }

  return (
    <div className="">
      <Markdown className="text-foreground">{description}</Markdown>
    </div>
  );
}
