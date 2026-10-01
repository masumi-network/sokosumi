"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Button } from "@/components/ui/button";

interface ConfirmedEmailProps {
  email: string;
  /** Back to the email step; absent when an invitation fixes the address. */
  onChange: (() => void) | undefined;
  changeDisabled: boolean;
}

/**
 * The email from the first step, now fixed: it keeps that field's label and
 * shape so it reads as part of the form, with a way back to edit it.
 */
export function ConfirmedEmail({
  email,
  onChange,
  changeDisabled,
}: ConfirmedEmailProps) {
  const t = useTranslations("Auth.Email.Form");
  const labelId = useId();
  const at = email.lastIndexOf("@");

  return (
    <div className="grid gap-2">
      <span id={labelId} className="text-sm leading-none font-medium">
        {t("label")}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        data-testid="confirmed-email"
        className="flex min-h-10 items-center gap-2 rounded-md border border-input bg-quinary py-1 pr-1 pl-3"
      >
        {/* Never cut off. Each half stays whole while it fits, so a long
            address breaks before the "@" rather than inside the domain. */}
        <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
          {at > 0 ? (
            <>
              <span className="inline-block max-w-full">
                {email.slice(0, at)}
              </span>
              <span className="inline-block max-w-full">{email.slice(at)}</span>
            </>
          ) : (
            email
          )}
        </span>
        {onChange ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-label={t("changeEmail")}
            disabled={changeDisabled}
            onClick={onChange}
          >
            {t("change")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
