"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import React, { useRef } from "react";
import { SubmitHandler, useForm } from "react-hook-form";

import { Form } from "@/components/ui/form";
import usePreventEnterSubmit from "@/hooks/use-prevent-enter-submit";
import {
  defaultValues as getDefaultValues,
  jobInputsFormSchema,
  JobInputsFormSchemaType,
} from "@/lib/job-input";
import { JobInputFormIntlPath } from "@/lib/job-input/type";
import { cn } from "@/lib/utils";

import JobInput from "./job-input";

export interface FormFooterProps {
  isSubmitting: boolean;
  isValid: boolean;
  reset: () => void;
}

export interface JobInputsFormBuilderProps {
  inputFields: InputFieldSchemaType[];
  defaultValues?: JobInputsFormSchemaType;
  onSubmit: SubmitHandler<JobInputsFormSchemaType>;
  renderFooter: (props: FormFooterProps) => React.ReactNode;
  className?: string;
  disabled?: boolean;
  isActive?: boolean;
  t?: IntlTranslation<JobInputFormIntlPath>;
  children?: React.ReactNode;
  inputsDisabled?: boolean;
  preventEnterSubmit?: boolean;
}

export function JobInputsFormBuilder({
  inputFields,
  defaultValues,
  onSubmit,
  renderFooter,
  className,
  disabled = false,
  isActive = true,
  t,
  children,
  inputsDisabled = false,
  preventEnterSubmit = false,
}: JobInputsFormBuilderProps) {
  const form = useForm<JobInputsFormSchemaType>({
    resolver: zodResolver(jobInputsFormSchema(inputFields, t)),
    defaultValues: defaultValues ?? getDefaultValues(inputFields),
    mode: "onChange",
  });

  const normalFormRef = useRef<HTMLFormElement | null>(null);
  const {
    formRef: preventEnterFormRef,
    handleSubmit: enterPreventedHandleSubmit,
  } = usePreventEnterSubmit(form, onSubmit, isActive && preventEnterSubmit);

  const formRef = preventEnterSubmit ? preventEnterFormRef : normalFormRef;
  const handleSubmit = preventEnterSubmit
    ? enterPreventedHandleSubmit
    : form.handleSubmit(onSubmit);

  const { isSubmitting, isValid } = form.formState;
  const isDisabled = disabled || isSubmitting;

  return (
    <Form {...form}>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col"
      >
        <fieldset
          disabled={isDisabled}
          className={cn("flex flex-1 flex-col gap-6", className)}
        >
          <div className="flex-1 space-y-6">
            {inputFields.map((jobInputSchema) => (
              <JobInput
                key={jobInputSchema.id}
                form={form}
                jobInputSchema={jobInputSchema}
                disabled={inputsDisabled}
              />
            ))}
          </div>
          {renderFooter({
            isSubmitting,
            isValid,
            reset: form.reset,
          })}
        </fieldset>
      </form>
      {children}
    </Form>
  );
}
