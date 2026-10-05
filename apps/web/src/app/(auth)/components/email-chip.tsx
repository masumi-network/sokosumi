"use client";

import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { cn } from "@/lib/utils";

interface EmailChipProps {
  email: string;
  /** Back to the email step; absent when an invitation fixes the address. */
  onChange?: (() => void) | undefined;
  disabled?: boolean | undefined;
}

const CHIP_CLASS =
  "inline-flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-sm";

/**
 * The address a step acts on, as a rounded chip under the step's header.
 * Pressing it goes back to change the address; an invitation's fixed address
 * is a static chip without the pencil. A long address is cut off and shows
 * whole on hover.
 */
export function EmailChip({ email, onChange, disabled }: EmailChipProps) {
  const t = useTranslations("Auth.Email.Form");
  const emailId = useId();
  const content = (
    <>
      <span
        aria-hidden
        className="bg-primary-quaternary text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
      >
        {email.charAt(0).toUpperCase()}
      </span>
      <span id={emailId} className="min-w-0 truncate font-medium" title={email}>
        {email}
      </span>
    </>
  );

  // Its own inline size, so a long address is cut off instead of widening
  // the page.
  return (
    <div className="flex min-w-0 justify-center contain-inline-size">
      {onChange ? (
        <button
          type="button"
          data-testid="auth-email-chip"
          className={cn(
            CHIP_CLASS,
            "hover:bg-quinary focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
          )}
          // Named for what it does; the address it changes describes it.
          aria-label={t("changeEmail")}
          aria-describedby={emailId}
          disabled={disabled}
          onClick={onChange}
        >
          {content}
          <PencilIcon
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0"
          />
        </button>
      ) : (
        <div data-testid="auth-email-chip" className={CHIP_CLASS}>
          {content}
        </div>
      )}
    </div>
  );
}
