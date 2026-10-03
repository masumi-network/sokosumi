import * as React from "react";

import { cn } from "@/lib/utils";
import { withEditableTextSize } from "@/lib/utils/editable-text-size";

interface InputProps extends React.ComponentProps<"input"> {
  /**
   * Underlined on the auth pages and the re-authentication dialog (ADR
   * 0051): one large, centred value over a two-pixel line. The equal side
   * padding keeps the text centred and clear of a password manager's inline
   * icon or a show/hide control. Boxed everywhere else.
   */
  variant?: "boxed" | "underlined";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, variant = "boxed", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      data-variant={variant}
      className={
        variant === "underlined"
          ? cn(
              "placeholder:text-muted-foreground selection:bg-primary-solid selection:text-primary-solid-foreground border-input flex h-14 w-full min-w-0 border-0 border-b-2 bg-transparent px-12 text-center text-xl font-light transition-colors outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              "focus-visible:border-primary aria-invalid:border-destructive",
              className,
            )
          : withEditableTextSize(
              "file:text-foreground placeholder:text-muted-foreground selection:bg-primary-solid selection:text-primary-solid-foreground border-input flex h-10 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              "focus-visible:border-ring focus-visible:ring-ring-halo focus-visible:ring-[3px]",
              "aria-invalid:ring-destructive-halo aria-invalid:border-destructive",
              className,
            )
      }
      {...props}
    />
  );
});

export { Input };
