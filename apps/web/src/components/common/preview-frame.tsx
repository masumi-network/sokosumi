import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function PreviewFrame({
  className,
  ...props
}: ComponentProps<"figure">) {
  return (
    <figure
      className={cn(
        "bg-background text-foreground overflow-hidden rounded-xl border text-sm",
        className,
      )}
      {...props}
    />
  );
}
