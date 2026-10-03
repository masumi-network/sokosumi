"use client"

import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type InputOTPVariant = "boxed" | "underlined"

const InputOTPVariantContext = React.createContext<InputOTPVariant>("boxed")

// The real input sits invisibly on top of the drawn slots; they take focus from
// the active slot and the error from the input's `aria-invalid`. Every slot
// style lives in this file.
//
// - boxed: one box styled like `Input`, the digits spaced inside it.
// - underlined: one underlined slot per digit, for the auth pages (ADR 0051).
//   A refused code shakes the slots once as `aria-invalid` turns on.
function InputOTP({
  className,
  containerClassName,
  variant = "boxed",
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
  variant?: InputOTPVariant
}) {
  return (
    <InputOTPVariantContext.Provider value={variant}>
      <OTPInput
        data-slot="input-otp"
        containerClassName={cn(
          "group/input-otp flex w-full min-w-0 items-center has-disabled:opacity-50",
          variant === "boxed" && [
            "h-10 rounded-md border border-input bg-transparent px-1 transition-[color,box-shadow]",
            "has-[[data-active=true]]:border-ring has-[[data-active=true]]:ring-ring-halo has-[[data-active=true]]:ring-[3px]",
            "has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:has-[[data-active=true]]:ring-destructive-halo",
          ],
          variant === "underlined" &&
            "justify-center has-[input[aria-invalid=true]]:motion-safe:animate-shake",
          containerClassName
        )}
        className={cn("disabled:cursor-not-allowed", className)}
        {...props}
      />
    </InputOTPVariantContext.Provider>
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  const variant = React.useContext(InputOTPVariantContext)

  return (
    <div
      data-slot="input-otp-group"
      className={cn(
        "flex h-full min-w-0 items-center",
        // Underlined slots share the row and shrink when the type grows.
        variant === "boxed" ? "flex-1" : "w-full justify-center gap-3",
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
  const variant = React.useContext(InputOTPVariantContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      data-empty={!char}
      // The input carries the value; the slots only draw it.
      aria-hidden
      className={cn(
        "relative flex min-w-0 items-center justify-center tabular-nums",
        variant === "boxed" && [
          "h-full flex-1 text-base font-medium",
          // A dot marks each place still to fill, except the one being typed.
          "after:text-muted-foreground data-[empty=true]:data-[active=false]:after:content-['·']",
        ],
        variant === "underlined" && [
          "h-14 max-w-11 flex-1 border-b-2 border-input text-3xl font-light transition-colors",
          "data-[active=true]:border-primary",
          "group-has-[input[aria-invalid=true]]/input-otp:border-destructive",
        ],
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cn(
              "motion-safe:animate-caret-blink bg-foreground w-px",
              variant === "boxed" ? "h-4" : "h-8"
            )}
          />
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
