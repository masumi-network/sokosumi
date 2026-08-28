"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import {
  archiveAdminSokoBotVersionAction,
  promoteAdminSokoBotVersionAction,
} from "@/lib/actions/admin-soko-bots/action";
import type { SokoBotVersionDetail } from "@/lib/clients/generated/core";
import { ADMIN_SOKO_BOT_VERSIONS_ROUTE } from "@/lib/soko-bot/constants";

interface SokoBotVersionActionsProps {
  version: SokoBotVersionDetail;
}

export function SokoBotVersionActions({ version }: SokoBotVersionActionsProps) {
  const t = useTranslations("App.Admin.SokoBots.Versions");
  const router = useRouter();
  const [isPromoting, setIsPromoting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  async function handlePromote() {
    setIsPromoting(true);
    try {
      const result = await promoteAdminSokoBotVersionAction({
        slug: version.id,
      });
      if (!result.ok) {
        toast.error(t("Actions.promoteError"));
        return;
      }
      toast.success(t("Actions.promoted"));
      router.refresh();
    } finally {
      setIsPromoting(false);
    }
  }

  async function handleArchive() {
    setIsArchiving(true);
    try {
      const result = await archiveAdminSokoBotVersionAction({
        slug: version.id,
      });
      if (!result.ok) {
        toast.error(t("Actions.archiveError"));
        return;
      }
      toast.success(t("Actions.archived"));
      router.push(ADMIN_SOKO_BOT_VERSIONS_ROUTE);
      router.refresh();
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button asChild size="sm" variant="outline">
        <Link
          href={`/admin/soko-bots/lab?version=${encodeURIComponent(version.id)}`}
        >
          {t("Actions.testInLab")}
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link
          href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/new?from=${encodeURIComponent(version.id)}`}
        >
          {t("Actions.duplicate")}
        </Link>
      </Button>
      {version.authored ? (
        <Button asChild size="sm" variant="outline">
          <Link
            href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(version.id)}?mode=edit`}
          >
            {t("Actions.edit")}
          </Link>
        </Button>
      ) : null}
      {!version.isDefault ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="primary" disabled={isPromoting}>
              {t("Actions.promote")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Actions.promoteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("Actions.promoteConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPromoting}>
                {t("Actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isPromoting}
                onClick={() => {
                  void handlePromote();
                }}
              >
                {isPromoting ? t("Actions.promoting") : t("Actions.promote")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {version.authored ? (
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="destructive"
                disabled={version.isDefault || isArchiving}
              >
                {t("Actions.archive")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Actions.archiveTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("Actions.archiveConfirm")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isArchiving}>
                  {t("Actions.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={isArchiving}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    void handleArchive();
                  }}
                >
                  {isArchiving ? t("Actions.archiving") : t("Actions.archive")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {version.isDefault ? (
            <span className="text-muted-foreground max-w-48 text-xs">
              {t("Actions.archiveDefaultHint")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
