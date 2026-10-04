"use client"

import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// The real input sits invisibly on top of the drawn slots; they take focus from
// the active slot and the error from the input's `aria-invalid`. Every slot
// style lives in this file: one underlined slot per digit, for the auth pages
// (ADR 0051). A refused code shakes the slots once as `aria-invalid` turns on.
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
        "group/input-otp flex w-full min-w-0 items-center justify-center has-disabled:opacity-50",
        "has-[input[aria-invalid=true]]:motion-safe:animate-shake",
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
      className={cn(
        // The slots share the row and shrink when the type grows.
        "flex h-full w-full min-w-0 items-center justify-center gap-3",
        className
      )}
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
        "relative flex h-14 max-w-11 min-w-0 flex-1 items-center justify-center border-b-2 border-input text-3xl font-light tabular-nums transition-colors",
        "data-[active=true]:border-primary",
        "group-has-[input[aria-invalid=true]]/input-otp:border-destructive",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="motion-safe:animate-caret-blink bg-foreground h-8 w-px" />
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
