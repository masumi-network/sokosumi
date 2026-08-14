"use client";

import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { useTranslations } from "next-intl";
import type React from "react";
import { useCallback, useMemo } from "react";

import { defaultValues, type JobInputsFormSchemaType } from "@/lib/job-input";
import { cn } from "@/lib/utils";

import {
  type FormFooterProps,
  JobInputsFormBuilder,
} from "./job-inputs-form-builder";

interface JobInputsFlatFormProps {
  flatInputs: InputFieldSchemaType[];
  className?: string;
  customOnSubmit: (values: JobInputsFormSchemaType) => void | Promise<void>;
  customRenderFooter: (props: FormFooterProps) => React.ReactNode;
  customIsSubmitting: boolean;
  customIsActive: boolean;
}

export function JobInputsFlatForm({
  flatInputs,
  className,
  customOnSubmit,
  customRenderFooter,
  customIsSubmitting,
  customIsActive,
}: JobInputsFlatFormProps) {
  const t = useTranslations("Library.JobInput.Form");

  const handleFlatSubmit = useCallback(
    (values: JobInputsFormSchemaType) => {
      customOnSubmit(values);
    },
    [customOnSubmit],
  );

  const flatDefaultValues = useMemo(
    () => defaultValues(flatInputs),
    [flatInputs],
  );

  return (
    <JobInputsFormBuilder
      inputFields={flatInputs}
      defaultValues={flatDefaultValues}
      onSubmit={handleFlatSubmit}
      renderFooter={customRenderFooter}
      className={cn("min-w-0", className)}
      disabled={customIsSubmitting}
      isActive={customIsActive}
      t={t}
      preventEnterSubmit
    />
  );
}
