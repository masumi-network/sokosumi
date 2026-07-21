"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateAdminOrchestratorDisplayAction } from "@/lib/actions/admin-orchestrators/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import type {
  AdminOrchestratorItem,
  AdminOrchestratorPatchBody,
} from "@/lib/services/admin-orchestrator.service";

const MIN_NAME_LENGTH = 3;

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

  const [name, setName] = useState(orchestrator.name);
  const [caption, setCaption] = useState(orchestrator.caption ?? "");
  const [description, setDescription] = useState(
    orchestrator.description ?? "",
  );
  const [imageValue, setImageValue] = useState(orchestrator.image ?? "");
  const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pendingPreviewUrl = useMemo(() => {
    if (!pendingImageFile) {
      return null;
    }
    return URL.createObjectURL(pendingImageFile);
  }, [pendingImageFile]);

  useEffect(() => {
    return () => {
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
      }
    };
  }, [pendingPreviewUrl]);

  const displayImageValue = removeImage
    ? ""
    : (pendingPreviewUrl ?? imageValue);

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

  function handleImageSelect(files: File[]) {
    const file = files[0];
    if (!file) {
      return;
    }

    setPendingImageFile(file);
    setPendingImageFiles(files);
    setRemoveImage(false);
  }

  function handleRemoveImage() {
    setPendingImageFile(null);
    setPendingImageFiles([]);
    setRemoveImage(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length < MIN_NAME_LENGTH) {
      toast.error(t("validation.nameMinLength", { min: MIN_NAME_LENGTH }));
      return;
    }

    const patchBody = buildPatchBody(orchestrator, {
      name,
      caption,
      description,
    });
    const imageIntent = removeImage
      ? "remove"
      : pendingImageFile
        ? "upload"
        : "none";

    if (!patchBody && imageIntent === "none") {
      toast.error(t("validation.noChanges"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await updateAdminOrchestratorDisplayAction({
        id: orchestrator.id,
        patchBody,
        imageIntent,
        imageFile: pendingImageFile ?? undefined,
      });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          toast.error(t("errors.notFound"));
          router.push("/admin/orchestrators");
          return;
        }

        toast.error(result.error.message ?? t("errors.saveFailed"));
        return;
      }

      setName(result.data.orchestrator.name);
      setCaption(result.data.orchestrator.caption ?? "");
      setDescription(result.data.orchestrator.description ?? "");
      setImageValue(result.data.orchestrator.image ?? "");
      setPendingImageFile(null);
      setPendingImageFiles([]);
      setRemoveImage(false);

      if (result.data.imageError) {
        toast.error(result.data.imageError);
        toast.message(t("success.textSavedImageFailed"));
      } else {
        toast.success(t("success.saved"));
      }

      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-2">
        <Label>{t("image.label")}</Label>
        <OrganizationLogoUploadField
          disabled={isSubmitting}
          isUploading={false}
          labels={imageLabels}
          logoValue={displayImageValue}
          onPendingLogoFilesChange={setPendingImageFiles}
          onRemove={handleRemoveImage}
          onUpload={handleImageSelect}
          pendingLogoFiles={pendingImageFiles}
          showRemoveButton={Boolean(displayImageValue) || removeImage}
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
            disabled={isSubmitting}
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
            value={orchestrator.slug}
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
          disabled={isSubmitting}
          autoComplete="off"
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
          disabled={isSubmitting}
          rows={5}
        />
        <p className="text-muted-foreground text-sm">
          {t("fields.description.description")}
        </p>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
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
