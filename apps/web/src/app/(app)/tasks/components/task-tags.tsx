"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateTaskTags } from "@/lib/actions/task/action";
import {
  TaskTagId,
  type TaskTags as TaskTagsDto,
} from "@/lib/clients/generated/core";

export function TaskTags({
  tags,
  compact = false,
}: {
  tags?: TaskTagsDto;
  compact?: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const ids = [...(tags?.manual ?? []), ...(tags?.automatic ?? [])];
  const visible = ids.slice(0, compact ? 1 : 2);
  const remaining = ids.length - visible.length;
  if (!ids.length)
    return <p className="text-muted-foreground text-xs">{t("empty")}</p>;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1"
      aria-label={t("label")}
    >
      {visible.map((id) => (
        <Badge
          key={id}
          variant="outline"
          className="text-muted-foreground rounded-sm font-normal"
        >
          {t(`vocabulary.${id}`)}
        </Badge>
      ))}
      {remaining > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="relative z-10 min-h-6 px-1.5 text-xs"
              aria-label={t("showAll", { count: ids.length })}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              +{remaining}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            aria-label={t("label")}
            className="w-64 space-y-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-medium">{t("label")}</p>
            <div className="flex flex-wrap gap-1">
              {ids.map((id) => (
                <Badge key={id} variant="outline">
                  {t(`vocabulary.${id}`)}
                </Badge>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

export function TaskTagEditor({
  taskId,
  tags,
  editable,
}: {
  taskId: string;
  tags?: TaskTagsDto;
  editable: boolean;
}) {
  const t = useTranslations("App.Tasks.Tags");
  const [current, setCurrent] = useState(tags);
  const [selected, setSelected] = useState<TaskTagId[]>([
    ...(tags?.manual ?? []),
    ...(tags?.automatic ?? []),
  ]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const currentIds = [
    ...(current?.manual ?? []),
    ...(current?.automatic ?? []),
  ];
  function handleSave() {
    setError(false);
    startTransition(async () => {
      try {
        const result = await updateTaskTags({
          taskId,
          add: selected,
          remove: currentIds.filter((id) => !selected.includes(id)),
        });
        if (!result.ok) {
          setError(true);
          return;
        }
        setCurrent(result.value);
        setOpen(false);
      } catch {
        setError(true);
      }
    });
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-medium">
          {t("label")}
        </h2>
        {editable ? (
          <Popover
            open={open}
            onOpenChange={(next) => {
              if (pending) return;
              setOpen(next);
              setError(false);
              setSelected(currentIds);
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                {t("edit")}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              aria-label={t("edit")}
              className="max-h-[var(--radix-popover-content-available-height)] w-72 space-y-3 overflow-y-auto"
            >
              <p className="text-sm font-medium">{t("edit")}</p>
              <p className="text-muted-foreground text-xs">{t("hint")}</p>
              <div className="space-y-1">
                {Object.values(TaskTagId).map((id) => (
                  <label
                    key={id}
                    className="flex min-h-8 items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(id)}
                      disabled={
                        pending ||
                        (!selected.includes(id) && selected.length >= 5)
                      }
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked === true
                            ? [...selected, id]
                            : selected.filter((value) => value !== id),
                        )
                      }
                    />
                    {t(`vocabulary.${id}`)}
                  </label>
                ))}
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {t("error")}
                </p>
              ) : null}
              <Button type="button" onClick={handleSave} disabled={pending}>
                {t(pending ? "saving" : "save")}
              </Button>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {currentIds.length ? (
          currentIds.map((id) => (
            <Badge
              key={id}
              variant="outline"
              title={t(current?.manual.includes(id) ? "manual" : "automatic")}
            >
              {t(`vocabulary.${id}`)}
            </Badge>
          ))
        ) : (
          <p className="text-muted-foreground text-xs">{t("empty")}</p>
        )}
      </div>
    </section>
  );
}
