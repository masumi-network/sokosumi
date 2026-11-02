import type * as React from "react";

import { cn } from "@/lib/utils";

/** A keyboard shortcut shown beside a label, as the header search shows ⌘K. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "shrink-0 font-sans text-2xs leading-none tracking-widest",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
