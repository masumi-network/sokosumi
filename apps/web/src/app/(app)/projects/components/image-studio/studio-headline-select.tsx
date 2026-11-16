import { useTranslations } from "next-intl";
import { useId } from "react";

import { Label } from "@/components/ui/label";

export function StudioHeadlineSelect({
  disabled,
  headline,
  onChange,
  options,
}: {
  disabled?: boolean;
  headline: string;
  onChange: (headline: string) => void;
  options: string[];
}) {
  const t = useTranslations("App.Studio");
  const id = useId();
  const unavailable = headline && !options.includes(headline);

  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{t("approvedHeadline")}</Label>
      <select
        className="border-input bg-background focus-visible:ring-ring h-8 w-full min-w-0 rounded-md border px-2 text-sm focus-visible:ring-2"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={headline}
      >
        <option value="">{t("noHeadline")}</option>
        {unavailable ? (
          <option disabled value={headline}>
            {t("headlineNoLongerApproved")}
          </option>
        ) : null}
        {options.map((line) => (
          <option key={line} value={line}>
            {line}
          </option>
        ))}
      </select>
    </div>
  );
}
