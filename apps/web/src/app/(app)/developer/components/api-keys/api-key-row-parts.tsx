"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useFormatter, type useTranslations } from "next-intl";

import {
  useFormatShortTimeAgo,
  useSharedNow,
} from "@/components/short-time-ago";
import { Button } from "@/components/ui/button";

import type { ApiKeyRecord } from "./types";
import { lastUsedAt } from "./utils";

// Shared by the API keys table and the stacked phone list.
type Translate = ReturnType<typeof useTranslations>;

export function ApiKeyStatus({
  apiKey,
  t,
}: {
  apiKey: ApiKeyRecord;
  t: Translate;
}) {
  return (
    <span className="bg-quinary text-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
      {apiKey.enabled ? t("Status.enabled") : t("Status.disabled")}
    </span>
  );
}

/** "Used 2h ago" (or bare "2h ago" under a Last used heading). */
export function ApiKeyLastUsed({
  apiKey,
  t,
  bare = false,
}: {
  apiKey: ApiKeyRecord;
  t: Translate;
  bare?: boolean;
}) {
  const now = useSharedNow();
  const timeAgo = useFormatShortTimeAgo();
  const format = useFormatter();
  const at = lastUsedAt(apiKey);
  if (!at) return <span>{t("LastUsed.none")}</span>;
  const when = timeAgo(at, now);
  return (
    <time
      dateTime={at.toISOString()}
      title={format.dateTime(at, "dateTimeMedium")}
    >
      {bare ? when : t("LastUsed.used", { when })}
    </time>
  );
}

export function ApiKeyActions({
  apiKey,
  t,
  onToggleStatus,
  onDeleteClick,
}: {
  apiKey: ApiKeyRecord;
  t: Translate;
  onToggleStatus: (apiKey: ApiKeyRecord) => Promise<void>;
  onDeleteClick: (apiKey: ApiKeyRecord) => void;
}) {
  return (
    <div className="flex items-center justify-end space-x-1">
      <Button
        size="sm"
        variant="ghost"
        // DESIGN.md touch targets: 40px below md, 32px from md up.
        className="size-10 md:size-8"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStatus(apiKey);
        }}
        title={
          apiKey.enabled
            ? t("Actions.disableTooltip")
            : t("Actions.enableTooltip")
        }
      >
        {apiKey.enabled ? (
          <EyeOff className="size-4" />
        ) : (
          <Eye className="size-4" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="size-10 md:size-8"
        onClick={(e) => {
          e.stopPropagation();
          onDeleteClick(apiKey);
        }}
        title={t("Actions.deleteTooltip")}
      >
        <Trash2 className="text-destructive size-4" />
      </Button>
    </div>
  );
}
