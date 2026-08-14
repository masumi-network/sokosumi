"use client";

import type { InputPasswordSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function PasswordInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.PASSWORD, InputPasswordSchemaType>) {
  const t = useTranslations("Library.JobInput.Form.Password");
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
        {...controlProps}
        value={typeof field.value === "string" ? field.value : ""}
      />
      <button
        type="button"
        onClick={handleToggleVisibility}
        aria-label={isVisible ? t("hide") : t("show")}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center pr-3"
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
