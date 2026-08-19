"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = ComponentProps<typeof Button>;

interface SubmitButtonProps extends Omit<ButtonProps, "form"> {
  isSubmitting: boolean;
  label: string;
  spinnerPosition?: "inline" | "start";
}

export function SubmitButton({
  isSubmitting,
  label,
  className,
  spinnerPosition = "inline",
  ...props
}: SubmitButtonProps) {
  const isStart = spinnerPosition === "start";

  return (
    <Button
      type="submit"
      variant="primary"
      className={cn(isStart && "relative", className)}
      disabled={isSubmitting}
      {...props}
    >
      {isSubmitting && (
        <Loader2
          aria-hidden="true"
          className={
            isStart
              ? "absolute top-1/2 left-4 size-4 -translate-y-1/2 animate-spin"
              : "mr-2 h-4 w-4 animate-spin"
          }
        />
      )}
      {isStart ? <span className="w-full text-center">{label}</span> : label}
    </Button>
  );
}
