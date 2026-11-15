"use client";

import {
  type DriveStars,
  getDriveStars,
  putDriveStars,
} from "@sokosumi/core-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import type { DriveWorkspaceStore } from "@/lib/utils/drive-file-list.client";

export type DriveStarTarget = { resourceId: string } | { folderPath: string };

/** The person's starred files and folders in this workspace, and the toggle. */
export function useDriveStars(
  store: DriveWorkspaceStore,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const t = useTranslations("App.Drive.Stars");
  const queryClient = useQueryClient();
  const queryKey = ["drive", "stars", store];

  const { data: stars } = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<DriveStars> =>
      (
        await getDriveStars({
          client: getBrowserCoreClient(),
          query: store,
          throwOnError: true,
        })
      ).data.data,
  });

  const toggle = useMutation({
    mutationFn: async (input: { target: DriveStarTarget; starred: boolean }) =>
      putDriveStars({
        client: getBrowserCoreClient(),
        body: { ...store, ...input.target, starred: input.starred },
        throwOnError: true,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (_error, input) =>
      toast.error(t(input.starred ? "starError" : "unstarError")),
  });

  return {
    stars,
    isFolderStarred: (path: string) =>
      stars?.folders.some((folder) => folder.path === path) ?? false,
    isFileStarred: (resourceId: string) =>
      stars?.files.some((file) => file.id === resourceId) ?? false,
    setStarred: (target: DriveStarTarget, starred: boolean) =>
      toggle.mutate({ target, starred }),
  };
}
