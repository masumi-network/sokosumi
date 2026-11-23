"use client";

import {
  type DriveGoogleSheet,
  getDriveResourcesByIdGoogleSheet,
  postDriveResourcesByIdGoogleSheetRefresh,
} from "@sokosumi/core-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import { cn } from "@/lib/utils";
import type { FileStore } from "@/lib/utils/file-search.client";
import {
  driveQueryKeys,
  invalidateDrive,
  splitDriveQueryKey,
} from "@/queries/drive";
import { useScopedQuery } from "@/queries/scoped-queries";

/**
 * Where a Drive file comes from when it holds Google's PDF of a linked sheet:
 * when it was last read, Refresh, and the sheet itself. Nothing for any other
 * file.
 */
export function GoogleSheetBar({
  resourceId,
  store,
  onRefreshed,
}: {
  resourceId: string;
  store: FileStore;
  onRefreshed?: () => void;
}) {
  const t = useTranslations("App.Drive.GoogleSheet");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const queryClient = useQueryClient();
  const queryKey = driveQueryKeys.googleSheet(store, resourceId);
  const options = {
    client: getBrowserCoreClient(),
    path: { id: resourceId },
    query: store,
    throwOnError: false,
  } as const;

  const { data: link } = useScopedQuery({
    ...splitDriveQueryKey(queryKey),
    // A plain file answers 204: nothing to show.
    queryFn: async ({ signal }): Promise<DriveGoogleSheet | null> =>
      (await getDriveResourcesByIdGoogleSheet({ ...options, signal })).data
        ?.data ?? null,
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const result = await postDriveResourcesByIdGoogleSheetRefresh(options);
      if (!result.data) throw new Error("Refresh failed");
      return result.data.data;
    },
    onSuccess: (next) => {
      void invalidateDrive(queryClient, store);
      if (!next.error) onRefreshed?.();
    },
  });

  if (!link) return null;
  const error = refresh.isError ? "failed" : link.error;

  return (
    <div
      className="bg-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-3 py-2 text-sm"
      data-testid="google-sheet-bar"
    >
      <p className="min-w-0">
        <span className="font-medium">{t("source")}</span>
        <span className="text-muted-foreground">
          {" · "}
          {t("updated", {
            when: format.relativeTime(new Date(link.syncedAt), now),
          })}
        </span>
        {error ? (
          <span className="text-semantic-destructive block" role="status">
            {t(`error.${error}`)}
          </span>
        ) : null}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw
            aria-hidden
            className={cn("size-4", refresh.isPending && "animate-spin")}
          />
          {refresh.isPending ? t("refreshing") : t("refresh")}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={link.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden className="size-4" />
            {t("open")}
          </a>
        </Button>
      </div>
    </div>
  );
}
