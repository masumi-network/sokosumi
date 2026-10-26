"use client";

import { NewsletterConsent } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface NewsletterConsentChoiceProps {
  newsletterName: string;
  value: NewsletterConsent | undefined;
  confirmed: boolean;
  onValueChange: (value: NewsletterConsent) => void;
  onConfirmedChange: (confirmed: boolean) => void;
  error?: string;
  disabled?: boolean;
}

export function NewsletterConsentChoice({
  newsletterName,
  value,
  confirmed,
  onValueChange,
  onConfirmedChange,
  error,
  disabled,
}: NewsletterConsentChoiceProps) {
  const t = useTranslations("App.Projects.Newsletter.Subscribers.Consent");
  const id = useId();
  const description = `${id}-note ${id}-error`;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend id={`${id}-label`} className="mb-3 text-sm font-medium">
        {t("question")}
      </legend>
      <RadioGroup
        name="consent"
        required
        disabled={disabled}
        value={value ?? ""}
        aria-labelledby={`${id}-label`}
        aria-describedby={description}
        aria-invalid={!!error}
        onValueChange={(next) => {
          if (
            next === NewsletterConsent.CONFIRMED ||
            next === NewsletterConsent.ASK
          ) {
            onValueChange(next);
            onConfirmedChange(false);
          }
        }}
      >
        {Object.values(NewsletterConsent).map((choice) => (
          <div key={choice} className="flex items-start gap-3">
            <RadioGroupItem
              id={`${id}-${choice}`}
              value={choice}
              className="mt-0.5"
            />
            <Label
              htmlFor={`${id}-${choice}`}
              className="min-h-6 leading-normal"
            >
              {t(choice)}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {value === NewsletterConsent.CONFIRMED ? (
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${id}-confirmed`}
            name="consentConfirmed"
            required
            checked={confirmed}
            onCheckedChange={(checked) => onConfirmedChange(checked === true)}
            aria-describedby={description}
            aria-invalid={!!error}
            className="mt-0.5"
          />
          <Label htmlFor={`${id}-confirmed`} className="min-h-6 leading-normal">
            {t("confirm")}
          </Label>
        </div>
      ) : null}
      <p id={`${id}-note`} className="text-muted-foreground text-sm">
        {t("note", { newsletterName })}
      </p>
      <p id={`${id}-error`} className="text-semantic-destructive-label text-sm">
        {error}
      </p>
    </fieldset>
  );
}
