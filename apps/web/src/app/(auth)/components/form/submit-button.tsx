"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

interface SubmitButtonProps extends Omit<ButtonProps, "form"> {
  isSubmitting: boolean;
  label: string;
}

export function SubmitButton({
  isSubmitting,
  label,
  ...props
}: SubmitButtonProps) {
  return (
    <Button {...props} type="submit" variant="primary" loading={isSubmitting}>
      {label}
    </Button>
  );
}
