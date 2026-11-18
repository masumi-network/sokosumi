"use client";

import type { TagColor } from "@sokosumi/core-client";
import { Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  resolvedTaskTagColor,
  TAG_COLORS,
  TagColorSwatch,
} from "./task-tag-colors";

export function TaskTagColorSelect({
  id,
  name,
  color,
  onChange,
  disabled,
}: {
  id?: string;
  name: string;
  color?: TagColor | null;
  onChange: (color: TagColor | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const swatch = color ?? (id ? resolvedTaskTagColor(id) : null);
  return (
    <label
      title={t("changeColor", { name })}
      className="border-control-border focus-within:ring-ring relative inline-flex size-8 shrink-0 items-center justify-center rounded-md border focus-within:ring-2"
    >
      {swatch ? (
        <TagColorSwatch color={swatch} />
      ) : (
        <Palette aria-hidden className="text-muted-foreground size-3.5" />
      )}
      <select
        aria-label={t("changeColor", { name })}
        value={color ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            TAG_COLORS.find((color) => color === event.target.value) ?? null,
          )
        }
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        <option value="">{t("colors.auto")}</option>
        {TAG_COLORS.map((color) => (
          <option key={color} value={color}>
            {t(`colors.${color}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
