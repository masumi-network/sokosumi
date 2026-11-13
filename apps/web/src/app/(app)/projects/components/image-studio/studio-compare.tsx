"use client";

import type {
  SaveStudioPairwisePick,
  StudioComparePair,
} from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  getStudioComparePair,
  saveStudioPairwisePick,
} from "@/lib/actions/image-studio/action";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

import { resolveModel } from "./catalog";
import { StudioImage } from "./studio-image";
import type { StudioCatalog, StudioLabels } from "./types";

type Outcome = SaveStudioPairwisePick["outcome"];

const CHOICES = [
  { outcome: "A", label: "pickA", shortcut: "← / 1", keys: "ArrowLeft 1" },
  { outcome: "B", label: "pickB", shortcut: "→ / 2", keys: "ArrowRight 2" },
  { outcome: "TIE", label: "tie", shortcut: "↑ / 3", keys: "ArrowUp 3" },
  {
    outcome: "BOTH_BAD",
    label: "bothBad",
    shortcut: "↓ / 4",
    keys: "ArrowDown 4",
  },
] as const;

export function StudioCompare({
  projectId,
  batchId,
  catalog,
  labels,
  onClose,
  onCloseAutoFocus,
}: {
  projectId: string;
  batchId: string;
  catalog: StudioCatalog;
  labels: StudioLabels;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("App.Studio.Pairwise");
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState<Outcome | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const busy = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  useMountEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  });

  const query = useQuery({
    queryKey: ["studio-compare", projectId, batchId],
    queryFn: async () => {
      const result = await getStudioComparePair({ projectId, batchId });
      if (!result.ok) throw new Error(t("loadFailed"));
      return result.value;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const pair = query.data?.pair;

  async function loadNext() {
    const result = await query.refetch();
    if (active.current && !result.isError) setPicked(null);
  }

  async function handlePick(outcome: Outcome) {
    if (!pair || busy.current || picked || query.isFetching) return;
    busy.current = true;
    dialogRef.current?.focus();
    setSaving(outcome);
    setSaveFailed(false);
    try {
      const result = await saveStudioPairwisePick({
        projectId,
        batchId,
        assetId: pair.a.id,
        otherAssetId: pair.b.id,
        outcome,
      });
      if (!active.current) return;
      if (!result.ok) {
        setSaveFailed(true);
        return;
      }
      setPicked(outcome);
      void queryClient.invalidateQueries({
        queryKey: ["studio-model-scoreboard", projectId],
      });
      advanceTimer.current = setTimeout(() => void loadNext(), 1200);
    } catch {
      if (active.current) setSaveFailed(true);
    } finally {
      busy.current = false;
      if (active.current) setSaving(null);
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="flex h-[80dvh] max-h-[calc(100dvh-2rem)] flex-col sm:max-w-5xl"
        ref={dialogRef}
        tabIndex={-1}
        onCloseAutoFocus={onCloseAutoFocus}
        onKeyDown={(event) => {
          if (
            event.repeat ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            isEditableKeyboardTarget(event.target)
          )
            return;
          const choice = CHOICES.find((item) =>
            item.keys.split(" ").includes(event.key),
          );
          if (!choice) return;
          event.preventDefault();
          void handlePick(choice.outcome);
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("hint")}</DialogDescription>
        </DialogHeader>
        {pair ? (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            <CompareImage
              asset={pair.a}
              catalog={catalog}
              label={t("pickA")}
              labels={labels}
              revealed={picked !== null}
            />
            <CompareImage
              asset={pair.b}
              catalog={catalog}
              label={t("pickB")}
              labels={labels}
              revealed={picked !== null}
            />
          </div>
        ) : null}
        <p className="text-muted-foreground text-sm" role="status">
          {query.isPending
            ? t("loading")
            : query.isError
              ? t("loadFailed")
              : picked
                ? t("saved")
                : null}
        </p>
        {query.isError ? (
          <Button
            onClick={() => void loadNext()}
            type="button"
            variant="outline"
          >
            {t("retry")}
          </Button>
        ) : null}
        <p className="text-muted-foreground text-sm" role="alert">
          {saveFailed ? t("saveFailed") : null}
        </p>
        {pair ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CHOICES.map((choice) => (
              <Button
                aria-keyshortcuts={choice.keys}
                disabled={
                  saving !== null ||
                  picked !== null ||
                  query.isFetching ||
                  query.isError
                }
                key={choice.outcome}
                loading={saving === choice.outcome}
                onClick={() => void handlePick(choice.outcome)}
                type="button"
                variant="outline"
              >
                {t(choice.label)}
                <kbd
                  aria-hidden="true"
                  className="text-muted-foreground text-xs"
                >
                  {choice.shortcut}
                </kbd>
              </Button>
            ))}
          </div>
        ) : pair === null ? (
          <Button onClick={onClose} type="button">
            {t("done")}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompareImage({
  asset,
  catalog,
  label,
  labels,
  revealed,
}: {
  asset: StudioComparePair["a"];
  catalog: StudioCatalog;
  label: string;
  labels: StudioLabels;
  revealed: boolean;
}) {
  return (
    <figure className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="bg-muted flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg">
        <StudioImage asset={asset} fit="contain" labels={labels} />
      </div>
      <figcaption className="text-sm break-words">
        <span className="font-medium">{label}</span>
        {revealed ? ` · ${resolveModel(catalog, asset.model).label}` : null}
      </figcaption>
    </figure>
  );
}
