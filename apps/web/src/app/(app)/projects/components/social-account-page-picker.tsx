"use client";

import type {
  ProjectSocialConnection,
  ProjectSocialConnectionPage,
} from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addProjectSocialConnectionPage,
  listProjectSocialConnectionPages,
} from "@/lib/actions/project/action";
import {
  SocialAccountPageList,
  type SocialAccountPageListState,
} from "./social-account-page-list";

interface SocialAccountPagePickerProps {
  projectId: string;
  /** An active personal account; the picker lists the pages it administers. */
  connection: ProjectSocialConnection;
  onOpenChange: (open: boolean) => void;
  onAdded: (account: ProjectSocialConnection) => void;
}

/** Mount only while open: loading the pages calls the provider. */
export function SocialAccountPagePicker({
  projectId,
  connection,
  onOpenChange,
  onAdded,
}: SocialAccountPagePickerProps) {
  const t = useTranslations("App.Projects.ProjectSocialAccounts.linkedInPages");
  const [addingIds, setAddingIds] = useState<ReadonlySet<string>>(new Set());
  const [addedIds, setAddedIds] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const pages = useQuery({
    queryKey: ["social-connection-pages", projectId, connection.id],
    queryFn: async () => {
      const result = await listProjectSocialConnectionPages({
        projectId,
        socialConnectionId: connection.id,
      });
      if (!result.ok) throw new Error(result.error.message ?? undefined);
      return result.value;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const state: SocialAccountPageListState = pages.isPending
    ? { kind: "loading" }
    : pages.isError
      ? { kind: "error" }
      : pages.data.status === "permission_missing"
        ? { kind: "permission_missing" }
        : {
            kind: "available",
            pages: pages.data.pages.map((page) => ({
              ...page,
              socialConnectionId:
                page.socialConnectionId ??
                addedIds.get(page.externalAccountId) ??
                null,
            })),
          };

  async function handleAdd(page: ProjectSocialConnectionPage): Promise<void> {
    const name = page.name?.trim() || page.handle || t("unnamed");
    setAddingIds((ids) => new Set(ids).add(page.externalAccountId));
    try {
      const result = await addProjectSocialConnectionPage({
        projectId,
        socialConnectionId: connection.id,
        externalAccountId: page.externalAccountId,
      });
      if (!result.ok) {
        toast.error(t("addError", { page: name }));
        return;
      }
      setAddedIds((ids) =>
        new Map(ids).set(page.externalAccountId, result.value.id),
      );
      toast.success(t("addSuccess", { page: name }));
      onAdded(result.value);
    } catch {
      toast.error(t("addError", { page: name }));
    } finally {
      setAddingIds((ids) => {
        const next = new Set(ids);
        next.delete(page.externalAccountId);
        return next;
      });
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("connectHint")}</DialogDescription>
        </DialogHeader>
        <SocialAccountPageList
          connection={connection}
          state={state}
          addingIds={addingIds}
          onAdd={(page) => void handleAdd(page)}
          onRetry={() => void pages.refetch()}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
