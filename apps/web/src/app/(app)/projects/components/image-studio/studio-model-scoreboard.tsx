"use client";

import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getStudioModelScoreboard } from "@/lib/actions/image-studio/action";

import { modelById, resolveModel } from "./catalog";
import {
  STUDIO_TOOLBAR_LABEL_CLASS,
  StudioToolbarTip,
} from "./studio-project-toolbar";
import type { StudioCatalog } from "./types";

export function StudioModelScoreboard({
  projectId,
  catalog,
}: {
  projectId: string;
  catalog: StudioCatalog;
}) {
  const t = useTranslations("App.Studio.Pairwise");
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <StudioToolbarTip label={t("bestModels")}>
        <PopoverTrigger asChild>
          <Button size="sm" type="button" variant="outline">
            <Trophy />
            <span className={STUDIO_TOOLBAR_LABEL_CLASS}>
              {t("bestModels")}
            </span>
          </Button>
        </PopoverTrigger>
      </StudioToolbarTip>
      <PopoverContent
        align="end"
        aria-label={t("bestModels")}
        className="app-scrollbar max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain"
      >
        {open ? <ModelScores catalog={catalog} projectId={projectId} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function ModelScores({
  projectId,
  catalog,
}: {
  projectId: string;
  catalog: StudioCatalog;
}) {
  const t = useTranslations("App.Studio.Pairwise");
  const format = useFormatter();
  const query = useQuery({
    queryKey: ["studio-model-scoreboard", projectId],
    queryFn: async () => {
      const result = await getStudioModelScoreboard({ projectId });
      if (!result.ok) throw new Error(t("scoreboardFailed"));
      return result.value;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{t("bestModels")}</h3>
      <p className="text-muted-foreground text-sm" role="status">
        {query.isPending
          ? t("loadingScores")
          : query.isError
            ? t("scoreboardFailed")
            : query.data.models.length === 0
              ? t("scoreboardEmpty")
              : null}
      </p>
      {query.isError ? (
        <Button
          onClick={() => void query.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("retry")}
        </Button>
      ) : null}
      {query.data?.models.length ? (
        <>
          <ol className="space-y-3">
            {query.data.models.map((model) => (
              <li className="min-w-0" key={model.model}>
                <p className="text-sm font-medium break-words">
                  {modelById(catalog, model.model)?.label ??
                    resolveModel(catalog, model.model).label}
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {t("modelStats", {
                    percent: format.number(model.winRate * 100, {
                      maximumFractionDigits: 0,
                    }),
                    count: model.comparisons,
                  })}
                </p>
              </li>
            ))}
          </ol>
          {query.data.models.some((model) => model.provisional) ? (
            <p className="text-muted-foreground text-xs">
              {t("smallSample", { count: query.data.minimumComparisons })}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
