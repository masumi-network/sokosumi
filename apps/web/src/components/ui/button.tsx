import * as React from "react"
import { Slot as SlotPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none border border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-destructive aria-invalid:ring-offset-2 aria-invalid:ring-offset-background",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        default:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        // No private focus ring. Every variant wears the one shared ring, so
        // the most dangerous button is not the one with the faintest focus
        // mark. Its own ring measured 1.41:1 in light and 1.70:1 in dark,
        // against 7.04 and 5.07 for the shared one.
        //
        // The fill is the solid red, not the text red. A red that carries a
        // near-white label must be darker than a red that reads as text on the
        // page: white on the dark-mode text red measures 3.43, under the 4.5
        // floor, while white on the solid measures 4.91.
        destructive:
          "bg-semantic-destructive-solid text-destructive-foreground hover:bg-destructive-hover",
        outline:
          "border-input hover:bg-accent hover:text-accent-foreground bg-background",
        secondary: "bg-quinary text-foreground hover:bg-quaternary",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        muted: "text-muted-foreground hover:bg-transparent hover:text-muted-foreground",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? SlotPrimitive.Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
