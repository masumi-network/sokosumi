"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  JobInputPasswordSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function PasswordInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.PASSWORD,
  JobInputPasswordSchemaType
>) {
  const [isVisible, setIsVisible] = React.useState(false);
  const handleToggleVisibility = () => setIsVisible((v) => !v);

  return (
    <div className="relative">
      <Input
        id={id}
        placeholder={jobInputSchema.data?.placeholder ?? undefined}
        type={isVisible ? "text" : "password"}
        className="pr-10"
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
      />
      <button
        type="button"
        onClick={handleToggleVisibility}
        aria-label={isVisible ? "Hide password" : "Show password"}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center pr-3"
        tabIndex={-1}
      >
        {isVisible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
