"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PasswordInputProps extends React.ComponentProps<"input"> {
  hideLabel: string;
  showLabel: string;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { className, disabled, hideLabel, showLabel, ...props },
    ref,
  ) {
    const [isVisible, setIsVisible] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function handleInputRef(node: HTMLInputElement | null) {
      inputRef.current = node;

      if (typeof ref === "function") {
        ref(node);
        return;
      }

      if (ref) {
        ref.current = node;
      }
    }

    function handleToggleVisibility() {
      const input = inputRef.current;
      const shouldRestoreFocus = document.activeElement === input;
      const selectionStart = input?.selectionStart ?? null;
      const selectionEnd = input?.selectionEnd ?? null;

      setIsVisible((visible) => !visible);

      if (!shouldRestoreFocus) {
        return;
      }

      requestAnimationFrame(() => {
        const nextInput = inputRef.current;

        if (!nextInput) {
          return;
        }

        nextInput.focus({ preventScroll: true });

        if (selectionStart !== null && selectionEnd !== null) {
          nextInput.setSelectionRange(selectionStart, selectionEnd);
        }
      });
    }

    return (
      <div className="relative">
        <Input
          {...props}
          ref={handleInputRef}
          disabled={disabled}
          type={isVisible ? "text" : "password"}
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={isVisible ? hideLabel : showLabel}
          aria-pressed={isVisible}
          onPointerDown={(event) => event.preventDefault()}
          onClick={handleToggleVisibility}
          className="text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
        >
          {isVisible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
    );
  },
);
