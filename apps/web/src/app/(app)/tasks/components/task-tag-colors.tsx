"use client";

import { TagColor, type TaskTagId } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import type { ComponentProps, CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
import { cn } from "@/lib/utils";
import { useTaskTagCatalog } from "./task-tag-catalog";
import styles from "./task-tag-colors.module.css";
import { normalizeTagHex } from "./task-tag-wheel-color";

const TAG_COLORS = Object.values(TagColor).filter((color) => color !== null);

interface TagColorFields {
  color?: TagColor;
  customColor?: string | null;
}

export function explicitTaskTagColor(tag: TagColorFields) {
  return normalizeTagHex(tag.customColor) ?? tag.color ?? null;
}

/** Keep the implicit color stable across languages, renames and renders. */
export function resolvedTaskTagColor(
  id: string,
  color?: string | null,
): string {
  const hex = normalizeTagHex(color);
  if (hex) return hex;
  const named = TAG_COLORS.find((candidate) => candidate === color);
  if (named) return named;
  const index =
    Array.from(id).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % TAG_COLORS.length;
  return TAG_COLORS[index] ?? "gray";
}

interface TagColorProps extends TagColorFields {
  id: string;
  taskTopicId?: TaskTagId;
}

function useTagColor({ id, taskTopicId, ...tag }: TagColorProps) {
  const cached = useTaskTagCatalog()?.byId.get(id);
  return resolvedTaskTagColor(
    (cached ? cached.taskTopicId : taskTopicId) ?? id,
    explicitTaskTagColor(cached ?? tag),
  );
}

function accentStyle(
  color: string,
): (CSSProperties & { "--tag-accent": string }) | undefined {
  const hex = normalizeTagHex(color);
  return hex ? { "--tag-accent": hex } : undefined;
}

export function TaskTagDot(props: TagColorProps) {
  return <TagColorSwatch color={useTagColor(props)} />;
}

export function TaskTagBadge({
  id,
  color,
  customColor,
  taskTopicId,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Badge>, "id" | "color"> & TagColorProps) {
  const accent = useTagColor({ id, color, customColor, taskTopicId });
  return (
    <Badge
      {...props}
      variant="outline"
      data-tag-color={accent}
      style={accentStyle(accent)}
      className={cn(
        styles.color,
        styles.badge,
        "max-w-full gap-1 rounded-sm font-normal has-[button]:overflow-visible has-[button]:py-0 has-[button]:pe-0",
        className,
      )}
    >
      <TagColorSwatch color={accent} />
      {children}
    </Badge>
  );
}

export function TagColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      data-tag-color={color}
      style={accentStyle(color)}
      className={cn(styles.color, styles.dot, "size-2.5 shrink-0 rounded-full")}
    />
  );
}

export function TaskTagRemoveButton({
  name,
  onRemove,
  disabled,
}: {
  name: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  return (
    <ChipRemoveButton
      disabled={disabled}
      aria-label={t("remove", { name })}
      onClick={onRemove}
    />
  );
}
