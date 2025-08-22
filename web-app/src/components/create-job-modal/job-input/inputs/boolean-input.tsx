import { Switch } from "@/components/ui/switch";

import { JobInputComponentProps } from "./types";

export function BooleanInput({ id, field }: JobInputComponentProps) {
  return (
    <Switch
      id={id}
      checked={typeof field.value === "boolean" ? field.value : false}
      onCheckedChange={field.onChange}
      disabled={field.disabled}
    />
  );
}
