"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Bot, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateAdminCoworkerDisplayAction } from "@/lib/actions/admin-coworkers/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";
import { ADMIN_COWORKER_NAME_MIN_LENGTH } from "@/lib/constants/coworker-display";
import {
  COWORKER_IMAGE_ACCEPT,
  COWORKER_IMAGE_MAX_SIZE_BYTES,
} from "@/lib/constants/coworker-image";
import type { AdminCoworkerDisplayPatchBody } from "@/lib/services/admin-coworker.service";

interface CoworkerFormProps {
  coworker: Coworker;
}

function toFieldValue(value: string | null | undefined): string {
  return value ?? "";
}

/** Resolve IPFS/CID values for preview only; storage remains the raw Core value. */
function toImageDisplayValue(image: string | null | undefined): string {
  if (!image) {
    return "";
  }
  return resolveIpfsOrHttpUrl(image);
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPatchBody(
  coworker: Coworker,
  values: {
    name: string;
    caption: string;
    description: string;
  },
): AdminCoworkerDisplayPatchBody | undefined {
  const patchBody: AdminCoworkerDisplayPatchBody = {};

  const nextName = values.name.trim();
  if (nextName !== coworker.name) {
    patchBody.name = nextName;
  }

  const nextCaption = normalizeOptionalText(values.caption);
  if (nextCaption !== (coworker.caption ?? null)) {
    patchBody.caption = nextCaption;
  }

  const nextDescription = normalizeOptionalText(values.description);
  if (nextDescription !== (coworker.description ?? null)) {
    patchBody.description = nextDescription;
  }

  return Object.keys(patchBody).length > 0 ? patchBody : undefined;
}

export function CoworkerForm({ coworker }: CoworkerFormProps) {
  const t = useTranslations("App.Admin.Coworkers.Form");
  const tContext = useTranslations("App.Admin.Coworkers.Context");
  const router = useRouter();

  const [baseline, setBaseline] = useState(coworker);
  const [name, setName] = useState(coworker.name);
  const [caption, setCaption] = useState(toFieldValue(coworker.caption));
  const [description, setDescription] = useState(
    toFieldValue(coworker.description),
  );
  const [imageValue, setImageValue] = useState(
    toImageDisplayValue(coworker.image),
  );
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

  function applySavedCoworker(saved: Coworker) {
    setBaseline(saved);
    setName(saved.name);
    setCaption(toFieldValue(saved.caption));
    setDescription(toFieldValue(saved.description));
    setImageValue(toImageDisplayValue(saved.image));
  }

  function handleNotFound() {
    toast.error(t("errors.notFound"));
    router.push("/admin/coworkers");
  }

  async function handleImageSelect(files: File[]) {
    const file = files[0];
    if (!file || isBusy) {
      return;
    }

    setPendingImageFiles(files);
    setIsUploadingImage(true);
    try {
      const result = await updateAdminCoworkerDisplayAction({
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

      applySavedCoworker(result.data.coworker);
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
      const result = await updateAdminCoworkerDisplayAction({
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

      applySavedCoworker(result.data.coworker);
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
    if (trimmedName.length < ADMIN_COWORKER_NAME_MIN_LENGTH) {
      toast.error(
        t("validation.nameMinLength", {
          min: ADMIN_COWORKER_NAME_MIN_LENGTH,
        }),
      );
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
      const result = await updateAdminCoworkerDisplayAction({
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

      applySavedCoworker(result.data.coworker);
      toast.success(t("success.saved"));
      router.refresh();
    } finally {
      setIsSavingText(false);
    }
  }

  return (
    <form className="space-y-8" onSubmit={handleSubmit}>
      <dl className="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{tContext("id")}</dt>
          <dd className="mt-1 font-mono text-xs">{baseline.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tContext("slug")}</dt>
          <dd className="mt-1">{baseline.slug}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tContext("vendor")}</dt>
          <dd className="mt-1">{baseline.vendor.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tContext("priority")}</dt>
          <dd className="mt-1 tabular-nums">{baseline.priority}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{tContext("whitelist")}</dt>
          <dd className="mt-2">
            <Badge variant={baseline.isWhitelisted ? "default" : "secondary"}>
              {baseline.isWhitelisted
                ? tContext("whitelisted")
                : tContext("notWhitelisted")}
            </Badge>
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <Label>{t("image.label")}</Label>
        <OrganizationLogoUploadField
          accept={COWORKER_IMAGE_ACCEPT}
          disabled={isBusy}
          fallbackIcon={<Bot className="size-8" />}
          isRemoving={isRemovingImage}
          isUploading={isUploadingImage}
          labels={imageLabels}
          logoValue={imageValue}
          maxSize={COWORKER_IMAGE_MAX_SIZE_BYTES}
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

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="coworker-name">{t("Fields.name.label")}</Label>
          <Input
            id="coworker-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isBusy}
            required
            minLength={ADMIN_COWORKER_NAME_MIN_LENGTH}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="coworker-caption">{t("Fields.caption.label")}</Label>
          <Input
            id="coworker-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            disabled={isBusy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="coworker-description">
            {t("Fields.description.label")}
          </Label>
          <Textarea
            id="coworker-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={isBusy}
            rows={4}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isBusy}>
          {isSavingText ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t("saving")}
            </>
          ) : (
            t("saveChanges")
          )}
        </Button>
        <Button type="button" variant="outline" asChild disabled={isBusy}>
          <Link href="/admin/coworkers">{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
