"use client";

import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { TaskActivitySection } from "@/app/tasks/components/task-activity";
import { isActivityVariant } from "./activity-variant-feed";
import { ActivityVariantPicker } from "./activity-variant-picker";
import { TaskActivityVariantSection } from "./activity-variant-section";

/**
 * Variant harness. Without `?variant=` it is the production section and
 * nothing else; `?variant=current` shows production under the picker.
 */
export function TaskActivityVariantHost(
  props: ComponentProps<typeof TaskActivitySection>,
) {
  const variant = useSearchParams().get("variant");
  if (variant == null) {
    return <TaskActivitySection {...props} />;
  }

  return (
    <>
      <ActivityVariantPicker active={variant} />
      {isActivityVariant(variant) ? (
        <TaskActivityVariantSection
          key={`${props.taskId}-${variant}`}
          variant={variant}
          {...props}
        />
      ) : (
        <TaskActivitySection {...props} />
      )}
    </>
  );
}
