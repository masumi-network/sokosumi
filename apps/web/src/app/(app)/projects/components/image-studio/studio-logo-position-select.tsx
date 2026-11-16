import { StudioLogoPosition } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { Label } from "@/components/ui/label";

const LOGO_POSITIONS = Object.values(StudioLogoPosition);

export function StudioLogoPositionSelect({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (position: StudioLogoPosition | undefined) => void;
  value?: StudioLogoPosition;
}) {
  const t = useTranslations("App.Studio.LogoPositions");
  const id = useId();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        className="border-input bg-background focus-visible:ring-ring h-8 rounded-md border px-2 text-sm focus-visible:ring-2"
        disabled={disabled}
        id={id}
        onChange={(event) =>
          onChange(
            LOGO_POSITIONS.find(
              (position) => position === event.currentTarget.value,
            ),
          )
        }
        value={value ?? ""}
      >
        <option value="">{t("none")}</option>
        {LOGO_POSITIONS.map((position) => (
          <option key={position} value={position}>
            {t(position)}
          </option>
        ))}
      </select>
    </div>
  );
}
