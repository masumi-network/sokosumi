"use client";

import { Loader2 } from "lucide-react";
import { ComponentProps } from "react";
import { FieldValues, UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

interface SubmitButtonProps<T extends FieldValues>
  extends Omit<ButtonProps, "form"> {
  form: UseFormReturn<T>;
  label: string;
}

export function SubmitButton<T extends FieldValues>({
  form,
  label,
  className,
  ...props
}: SubmitButtonProps<T>) {
  return (
    <Button
      type="submit"
      className={className}
      disabled={form.formState.isSubmitting}
      {...props}
    >
      {form.formState.isSubmitting && (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      )}
      {label}
    </Button>
  );
}
