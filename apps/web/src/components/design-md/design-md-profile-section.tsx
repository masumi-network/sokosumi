"use client";

import { FileText, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { removeDesignMd } from "@/lib/actions/design-md";
import type { PersistedDesignMd } from "@/lib/services/design-md.service";

import { DesignMdAccessButtons } from "./design-md-access-buttons";
import { DesignMdGenerateDialog } from "./design-md-generate-dialog";
import { DesignMdUploadTrigger } from "./design-md-upload-trigger";
import {
  DESIGN_MD_TRANSLATION_NAMESPACE,
  type DesignMdOwner,
  type DesignMdProfileValue,
} from "./types";

interface DesignMdProfileSectionProps {
  canManage?: boolean;
  className?: string;
  onValueChange?: (value?: DesignMdProfileValue) => void;
  owner: DesignMdOwner;
  value?: DesignMdProfileValue;
  websiteUrl?: null | string;
}

function getPreviewUrl(value?: DesignMdProfileValue): null | string {
  if (!value?.extractionId) return null;
  return value.previewUrl ?? null;
}

export function DesignMdProfileSection({
  canManage = true,
  className,
  onValueChange,
  owner,
  value,
  websiteUrl,
}: DesignMdProfileSectionProps) {
  const t = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [designMd, setDesignMd] = useState<DesignMdProfileValue | undefined>(
    value,
  );
  const [prevValue, setPrevValue] = useState(value);

  if (value !== prevValue) {
    setPrevValue(value);
    setDesignMd(value);
  }

  const [isRemoving, setIsRemoving] = useState(false);

  const designMdUrl = designMd?.url ?? null;
  const previewUrl = getPreviewUrl(designMd);
  const hasDesignMd = Boolean(designMdUrl);
  const hasWebsiteUrl = Boolean(websiteUrl);
  const sourceWebsiteUrl = websiteUrl ?? "";
  const description =
    owner.type === "user"
      ? t("descriptionPersonal")
      : t("descriptionOrganization");

  const handlePersisted = useCallback(
    (persisted: PersistedDesignMd) => {
      setDesignMd(persisted);
      onValueChange?.(persisted);
    },
    [onValueChange],
  );

  const handleRemove = useCallback(async () => {
    setIsRemoving(true);
    try {
      const result = await removeDesignMd({ owner });
      if (!result.ok) {
        toast.error(result.error.message ?? t("removeError"));
        return;
      }

      setDesignMd(undefined);
      onValueChange?.(undefined);
      toast.success(t("removeSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("removeError"));
    } finally {
      setIsRemoving(false);
    }
  }, [owner, onValueChange, t]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={hasDesignMd ? "default" : "outline"}>
            {hasDesignMd ? t("statusReady") : t("statusEmpty")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent">
            <FileText className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium text-sm">
              {hasDesignMd ? t("readyTitle") : t("emptyTitle")}
            </p>
            <p className="text-muted-foreground text-sm">
              {hasDesignMd ? t("readyDescription") : t("emptyDescription")}
            </p>
            {hasWebsiteUrl ? (
              <p className="truncate text-muted-foreground text-xs">
                {t("websiteSource", { websiteUrl: sourceWebsiteUrl })}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t("missingWebsiteHint")}
              </p>
            )}
          </div>
        </div>

        {canManage ? (
          <div className="grid gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <DesignMdGenerateDialog
                owner={owner}
                websiteUrl={websiteUrl}
                hasExistingDesignMd={hasDesignMd}
                onGenerated={handlePersisted}
                disabled={!hasWebsiteUrl || isRemoving}
              />
              <DesignMdAccessButtons
                designMdUrl={designMdUrl}
                previewUrl={previewUrl}
                downloadLabel={t("downloadButton")}
                previewLabel={t("previewButton")}
              />
              {designMdUrl ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" disabled={isRemoving}>
                      <Trash2 className="size-4" />
                      {isRemoving ? t("removing") : t("removeButton")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("removeDialogTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("removeDialogDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isRemoving}>
                        {t("cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={isRemoving}
                        onClick={() => {
                          void handleRemove();
                        }}
                      >
                        {isRemoving ? t("removing") : t("confirmRemove")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            <DesignMdUploadTrigger
              owner={owner}
              onSaved={handlePersisted}
              disabled={isRemoving}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <DesignMdAccessButtons
              designMdUrl={designMdUrl}
              previewUrl={previewUrl}
              downloadLabel={t("downloadButton")}
              previewLabel={t("previewButton")}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
