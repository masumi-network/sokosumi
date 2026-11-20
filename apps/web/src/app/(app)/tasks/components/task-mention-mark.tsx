"use client";

import { AtSign } from "lucide-react";
import { useTranslations } from "next-intl";

/** Says that a comment on the Task mentions the reader and waits for them. */
export function TaskMentionMark({ show }: { show?: boolean }) {
  const t = useTranslations("App.Tasks");

  if (!show) {
    return null;
  }

  const label = t("unansweredMention");
  return (
    <span title={label} className="flex shrink-0">
      <AtSign className="text-foreground size-3.5" aria-label={label} />
    </span>
  );
}
