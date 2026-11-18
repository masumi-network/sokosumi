"use client";

import { TagColor, type TaskTagId } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
import { cn } from "@/lib/utils";
import { useTaskTagCatalog } from "./task-tag-catalog";
import styles from "./task-tag-colors.module.css";

export const TAG_COLORS = Object.values(TagColor).filter(
  (color) => color !== null,
);

/** Keep the implicit color stable across languages, renames and renders. */
export function resolvedTaskTagColor(
  id: string,
  color?: TagColor | null,
): TagColor {
  if (color && TAG_COLORS.includes(color)) return color;
  const index =
    Array.from(id).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % TAG_COLORS.length;
  return TAG_COLORS[index] ?? "gray";
}

function useTagColor(
  id: string,
  color?: TagColor | null,
  taskTopicId?: TaskTagId,
) {
  const cached = useTaskTagCatalog()?.byId.get(id);
  return resolvedTaskTagColor(
    (cached ? cached.taskTopicId : taskTopicId) ?? id,
    cached ? cached.color : color,
  );
}

export function TaskTagDot({
  id,
  color,
}: {
  id: string;
  color?: TagColor | null;
}) {
  return (
    <span
      aria-hidden
      data-tag-color={useTagColor(id, color)}
      className={cn(styles.color, styles.dot, "size-2.5 shrink-0 rounded-full")}
    />
  );
}

export function TaskTagBadge({
  id,
  color,
  taskTopicId,
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "id" | "color"> & {
  id: string;
  color?: TagColor | null;
  taskTopicId?: TaskTagId;
}) {
  return (
    <Badge
      {...props}
      variant="outline"
      data-tag-color={useTagColor(id, color, taskTopicId)}
      className={cn(
        styles.color,
        styles.badge,
        "max-w-full gap-1 rounded-sm font-normal has-[button]:overflow-visible has-[button]:py-0 has-[button]:pe-0",
        className,
      )}
    />
  );
}

export function TagColorSwatch({ color }: { color: TagColor }) {
  return (
    <span
      aria-hidden
      data-tag-color={color}
      className={cn(styles.color, styles.dot, "size-3 shrink-0 rounded-full")}
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
