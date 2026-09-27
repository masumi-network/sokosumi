"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TaskTagId } from "@/lib/clients/generated/core";

interface TaskDraftTagsProps {
  tags: TaskTagId[];
  toggleTag: (tag: TaskTagId, selected: boolean) => void;
  status: "loading" | "unavailable" | null;
}

export function TaskDraftTags({ tags, toggleTag, status }: TaskDraftTagsProps) {
  const t = useTranslations("App.Tasks.Tags");
  return (
    <section aria-label={t("label")} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="gap-1 font-normal">
            {t(`vocabulary.${tag}`)}
            <button
              type="button"
              className="focus-visible:outline-ring inline-flex size-6 items-center justify-center rounded-sm focus-visible:outline-2"
              aria-label={t("remove", { name: t(`vocabulary.${tag}`) })}
              onClick={() => toggleTag(tag, false)}
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              {t("edit")}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            aria-label={t("edit")}
            className="max-h-[var(--radix-popover-content-available-height)] w-72 space-y-2 overflow-y-auto"
          >
            <p className="text-muted-foreground text-xs">{t("hint")}</p>
            {Object.values(TaskTagId).map((tag) => (
              <label
                key={tag}
                className="flex min-h-8 items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={tags.includes(tag)}
                  disabled={!tags.includes(tag) && tags.length >= 5}
                  onCheckedChange={(checked) =>
                    toggleTag(tag, checked === true)
                  }
                />
                {t(`vocabulary.${tag}`)}
              </label>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      {status ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t(status === "loading" ? "suggesting" : "suggestionsUnavailable")}
        </p>
      ) : null}
    </section>
  );
}
