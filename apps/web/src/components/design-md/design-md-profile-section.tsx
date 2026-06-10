"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { removeDesignMd } from "@/lib/actions/design-md";
import type { PersistedDesignMd } from "@/lib/services/design-md.service";

import { DesignMdFileRow } from "./design-md-file-row";
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

  const [isAutoMode, setIsAutoMode] = useState(true);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const designMdUrl = designMd?.url ?? null;
  const previewUrl = getPreviewUrl(designMd);
  const hasDesignMd = Boolean(designMdUrl);
  const hasWebsiteUrl = Boolean(websiteUrl);

  if (!hasDesignMd && isGenerateDialogOpen) {
    setIsGenerateDialogOpen(false);
  }
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

  const autoToggleId =
    owner.type === "user"
      ? "design-md-auto-user"
      : `design-md-auto-${owner.organizationId}`;
  const websiteSource = hasWebsiteUrl
    ? t("websiteSource", { websiteUrl: sourceWebsiteUrl })
    : null;

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
      <CardContent className="space-y-3">
        {canManage ? (
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <label htmlFor={autoToggleId} className="min-w-0 space-y-1">
              <span className="block font-medium text-sm">
                {t("autoLabel")}
              </span>
              <span className="block text-muted-foreground text-sm">
                {t("autoDescription")}
              </span>
            </label>
            <Switch
              id={autoToggleId}
              checked={isAutoMode}
              onCheckedChange={setIsAutoMode}
              disabled={isRemoving}
              aria-label={t("autoLabel")}
            />
          </div>
        ) : null}

        {hasDesignMd && designMdUrl ? (
          <>
            <DesignMdFileRow
              canManage={canManage}
              description={t("readyDescription")}
              designMdUrl={designMdUrl}
              isRemoving={isRemoving}
              labels={{
                actionsMenu: t("actionsMenuLabel"),
                cancel: t("cancel"),
                confirmRemove: t("confirmRemove"),
                download: t("menuDownload"),
                preview: t("menuPreview"),
                regenerate: t("menuRegenerate"),
                remove: t("menuRemove"),
                removeDialogDescription: t("removeDialogDescription"),
                removeDialogTitle: t("removeDialogTitle"),
                removing: t("removing"),
                rowDownload: t("downloadButton"),
              }}
              onRegenerateClick={() => setIsGenerateDialogOpen(true)}
              onRemove={() => {
                void handleRemove();
              }}
              previewUrl={previewUrl}
              title={t("readyTitle")}
              websiteSource={websiteSource}
            />
            {canManage ? (
              <DesignMdGenerateDialog
                hideTrigger
                open={isGenerateDialogOpen}
                onOpenChange={setIsGenerateDialogOpen}
                owner={owner}
                websiteUrl={websiteUrl}
                hasExistingDesignMd={hasDesignMd}
                onGenerated={handlePersisted}
                disabled={!hasWebsiteUrl || isRemoving}
              />
            ) : null}
          </>
        ) : canManage ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <DesignMdGenerateDialog
                owner={owner}
                websiteUrl={websiteUrl}
                hasExistingDesignMd={hasDesignMd}
                onGenerated={handlePersisted}
                disabled={!hasWebsiteUrl || isRemoving}
              />
            </div>
            {!hasWebsiteUrl ? (
              <p className="text-muted-foreground text-sm">
                {t("missingWebsiteHint")}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border px-4 py-3">
            <p className="font-medium text-sm">{t("emptyTitle")}</p>
            <p className="text-muted-foreground text-sm">
              {t("emptyDescription")}
            </p>
          </div>
        )}

        {canManage && !isAutoMode ? (
          <div className="pt-1">
            <DesignMdUploadTrigger
              owner={owner}
              onSaved={handlePersisted}
              disabled={isRemoving}
              variant="compact"
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
