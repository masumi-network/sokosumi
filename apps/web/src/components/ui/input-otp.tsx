"use client"

import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// One box styled like `Input`, the digits spaced inside it. The real input sits
// invisibly on top; the box takes its focus from the active slot and its error
// from the input's `aria-invalid`. Every slot style lives in this file.
function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-transparent px-1 transition-[color] has-disabled:opacity-50",
        "has-[[data-active=true]]:border-ring has-[[data-active=true]]:ring-ring-halo has-[[data-active=true]]:ring-[3px]",
        "has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:has-[[data-active=true]]:ring-destructive-halo",
        containerClassName
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn("flex h-full min-w-0 flex-1 items-center", className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  index: number
}) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      data-empty={!char}
      // The input carries the value; the slots only draw it.
      aria-hidden
      className={cn(
        "relative flex h-full min-w-0 flex-1 items-center justify-center text-base font-medium tabular-nums",
        // A dot marks each place still to fill, except the one being typed.
        "after:text-muted-foreground data-[empty=true]:data-[active=false]:after:content-['·']",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="motion-safe:animate-caret-blink bg-foreground h-4 w-px" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-separator" role="separator" {...props}>
      <MinusIcon />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
