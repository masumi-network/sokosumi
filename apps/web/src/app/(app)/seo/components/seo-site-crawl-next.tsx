"use client";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { seoCheckBlocking } from "./seo-setup-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Starts a crawl of the next pages after the person confirms its price. Core decides where it goes on from. */
export function SeoCrawlNextButton({ model }: { model: SeoWorkspaceModel }) {
  const t = useSeoResultTranslations("App.Seo.siteCrawl.next");
  // One key per confirmation: a second click of the same dialog replays the first request.
  const [key, setKey] = useState<string | null>(null);
  const continues = model.data.availableActions.continueCrawlFrom;
  if (!continues) return null;
  const busy = seoCheckBlocking(model.data, new Date());
  return (
    <AlertDialog
      open={key !== null}
      onOpenChange={(open) => setKey(open ? crypto.randomUUID() : null)}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={model.pending || busy}
          title={busy ? t("busy") : undefined}
        >
          {t("button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm">{t("price")}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!key) return;
              void model.execute(
                { kind: "continue_crawl", continues, idempotencyKey: key },
                t("started"),
              );
            }}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
