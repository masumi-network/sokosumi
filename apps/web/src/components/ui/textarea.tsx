import * as React from "react"

import { withEditableTextSize } from "@/lib/utils/editable-text-size"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={withEditableTextSize(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive dark:bg-quinary flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 transition-[color] outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
