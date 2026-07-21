"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateAdminOrchestratorDisplayAction } from "@/lib/actions/admin-orchestrators/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import {
  ORCHESTRATOR_IMAGE_ACCEPT,
  ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES,
} from "@/lib/constants/orchestrator-image";
import type {
  AdminOrchestratorItem,
  AdminOrchestratorPatchBody,
} from "@/lib/services/admin-orchestrator.service";

const MIN_NAME_LENGTH = 3;
const MAX_CAPTION_LENGTH = 255;

interface OrchestratorEditFormProps {
  orchestrator: AdminOrchestratorItem;
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPatchBody(
  orchestrator: AdminOrchestratorItem,
  values: {
    name: string;
    caption: string;
    description: string;
  },
): AdminOrchestratorPatchBody | undefined {
  const patchBody: AdminOrchestratorPatchBody = {};

  const nextName = values.name.trim();
  if (nextName !== orchestrator.name) {
    patchBody.name = nextName;
  }

  const nextCaption = normalizeOptionalText(values.caption);
  if (nextCaption !== orchestrator.caption) {
    patchBody.caption = nextCaption;
  }

  const nextDescription = normalizeOptionalText(values.description);
  if (nextDescription !== orchestrator.description) {
    patchBody.description = nextDescription;
  }

  return Object.keys(patchBody).length > 0 ? patchBody : undefined;
}

export function OrchestratorEditForm({
  orchestrator,
}: OrchestratorEditFormProps) {
  const t = useTranslations("App.Admin.Orchestrators.EditForm");
  const router = useRouter();

  const [baseline, setBaseline] = useState(orchestrator);
  const [name, setName] = useState(orchestrator.name);
  const [caption, setCaption] = useState(orchestrator.caption ?? "");
  const [description, setDescription] = useState(
    orchestrator.description ?? "",
  );
  const [imageValue, setImageValue] = useState(orchestrator.image ?? "");
  const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);
  const [isSavingText, setIsSavingText] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isRemovingImage, setIsRemovingImage] = useState(false);

  const isBusy = isSavingText || isUploadingImage || isRemovingImage;

  const imageLabels = {
    fileTooLarge: t("image.fileTooLarge"),
    fileTypeNotAccepted: t("image.fileTypeNotAccepted"),
    maxFilesExceeded: t("image.maxFilesExceeded"),
    previewAlt: t("image.previewAlt"),
    remove: t("image.remove"),
    replace: t("image.replace"),
    upload: t("image.upload"),
    uploadError: t("image.uploadError"),
  };

  function applySavedOrchestrator(saved: AdminOrchestratorItem) {
    setBaseline(saved);
    setName(saved.name);
    setCaption(saved.caption ?? "");
    setDescription(saved.description ?? "");
    setImageValue(saved.image ?? "");
  }

  function handleNotFound() {
    toast.error(t("errors.notFound"));
    router.push("/admin/orchestrators");
  }

  async function handleImageSelect(files: File[]) {
    const file = files[0];
    if (!file || isBusy) {
      return;
    }

    setPendingImageFiles(files);
    setIsUploadingImage(true);
    try {
      const result = await updateAdminOrchestratorDisplayAction({
        id: baseline.id,
        imageIntent: "upload",
        imageFile: file,
      });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.imageSaveFailed"));
        return;
      }

      applySavedOrchestrator(result.data.orchestrator);
      toast.success(t("success.imageSaved"));
      router.refresh();
    } finally {
      setPendingImageFiles([]);
      setIsUploadingImage(false);
    }
  }

  async function handleRemoveImage() {
    if (!imageValue || isBusy) {
      return;
    }

    setIsRemovingImage(true);
    try {
      const result = await updateAdminOrchestratorDisplayAction({
        id: baseline.id,
        imageIntent: "remove",
      });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.imageSaveFailed"));
        return;
      }

      applySavedOrchestrator(result.data.orchestrator);
      toast.success(t("success.imageRemoved"));
      router.refresh();
    } finally {
      setIsRemovingImage(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) {
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length < MIN_NAME_LENGTH) {
      toast.error(t("validation.nameMinLength", { min: MIN_NAME_LENGTH }));
      return;
    }

    const patchBody = buildPatchBody(baseline, {
      name,
      caption,
      description,
    });

    if (!patchBody) {
      toast.error(t("validation.noChanges"));
      return;
    }

    setIsSavingText(true);
    try {
      const result = await updateAdminOrchestratorDisplayAction({
        id: baseline.id,
        patchBody,
        imageIntent: "none",
      });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }

        toast.error(result.error.message ?? t("errors.saveFailed"));
        return;
      }

      applySavedOrchestrator(result.data.orchestrator);
      toast.success(t("success.saved"));
      router.refresh();
    } finally {
      setIsSavingText(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-2">
        <Label>{t("image.label")}</Label>
        <OrganizationLogoUploadField
          accept={ORCHESTRATOR_IMAGE_ACCEPT}
          disabled={isBusy}
          isRemoving={isRemovingImage}
          isUploading={isUploadingImage}
          labels={imageLabels}
          logoValue={imageValue}
          maxSize={ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES}
          onPendingLogoFilesChange={setPendingImageFiles}
          onRemove={handleRemoveImage}
          onUpload={handleImageSelect}
          pendingLogoFiles={pendingImageFiles}
          showRemoveButton={Boolean(imageValue)}
        />
        <p className="text-muted-foreground text-sm">
          {t("image.description")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="orchestrator-name">{t("fields.name.label")}</Label>
          <Input
            id="orchestrator-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isBusy}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-sm">
            {t("fields.name.description")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="orchestrator-slug">{t("fields.slug.label")}</Label>
          <Input
            id="orchestrator-slug"
            value={baseline.slug}
            disabled
            readOnly
          />
          <p className="text-muted-foreground text-sm">
            {t("fields.slug.description")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="orchestrator-caption">
          {t("fields.caption.label")}
        </Label>
        <Input
          id="orchestrator-caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          disabled={isBusy}
          autoComplete="off"
          maxLength={MAX_CAPTION_LENGTH}
        />
        <p className="text-muted-foreground text-sm">
          {t("fields.caption.description")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="orchestrator-description">
          {t("fields.description.label")}
        </Label>
        <Textarea
          id="orchestrator-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={isBusy}
          rows={5}
        />
        <p className="text-muted-foreground text-sm">
          {t("fields.description.description")}
        </p>
      </div>

      <Button type="submit" disabled={isBusy}>
        {isSavingText ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t("submitting")}
          </>
        ) : (
          t("submit")
        )}
      </Button>
    </form>
  );
}
