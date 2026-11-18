"use client";

import type { TaskTagId } from "@sokosumi/core-client";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { TaskTagBadge, TaskTagRemoveButton } from "./task-tag-colors";

interface TaskDraftTagsProps {
  tags: TaskTagId[];
  status?: "loading" | null;
  addedByJev?: ReadonlySet<TaskTagId>;
  onRemove: (id: TaskTagId) => void;
  disabled?: boolean;
}

export function JevTagIndicator() {
  const t = useTranslations("App.Tasks.Tags");
  const label = t("appliedByJev");
  return (
    <span title={label} className="inline-flex shrink-0">
      <Sparkles role="img" aria-label={label} className="size-3" />
    </span>
  );
}

/**
 * Jev classifies topics. The composer shows each accepted topic as a removable
 * badge and keeps the loading status available while it waits for suggestions.
 */
export function TaskDraftTags({
  tags,
  status,
  addedByJev,
  onRemove,
  disabled,
}: TaskDraftTagsProps) {
  const t = useTranslations("App.Tasks.Tags");
  return (
    <>
      {tags.map((tag) => (
        <TaskTagBadge id={tag} key={tag}>
          {addedByJev?.has(tag) && <JevTagIndicator />}
          <span className="truncate">{t(`vocabulary.${tag}`)}</span>
          <TaskTagRemoveButton
            name={t(`vocabulary.${tag}`)}
            onRemove={() => onRemove(tag)}
            disabled={disabled}
          />
        </TaskTagBadge>
      ))}
      {!tags.length && status === "loading" && (
        <span role="status" className="text-muted-foreground text-xs">
          {t("suggesting")}
        </span>
      )}
    </>
  );
}
