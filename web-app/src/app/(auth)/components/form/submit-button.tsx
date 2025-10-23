"use client";

import { Loader2 } from "lucide-react";
import { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

interface SubmitButtonProps extends Omit<ButtonProps, "form"> {
  isSubmitting: boolean;
  label: string;
}

export function SubmitButton({
  isSubmitting,
  label,
  className,
  ...props
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      variant="primary"
      className={className}
      disabled={isSubmitting}
      {...props}
    >
      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {label}
    </Button>
  );
}
