"use client";

import { Bot, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResultDto } from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors";
import { CommonErrorCode } from "@/lib/actions/errors";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";
import {
  COWORKER_CAPTION_MAX_LENGTH,
  COWORKER_NAME_MIN_LENGTH,
} from "@/lib/constants/coworker-display";
import {
  COWORKER_IMAGE_ACCEPT,
  COWORKER_IMAGE_MAX_SIZE_BYTES,
} from "@/lib/constants/coworker-image";
import type {
  CoworkerImageIntent,
  UpdateCoworkerDisplayResult,
} from "@/lib/services/coworker-display.service";

import {
  buildCoworkerDisplayPatchBody,
  toFieldValue,
  toImageDisplayValue,
} from "./coworker-display-utils";

export type UpdateCoworkerDisplayAction = (input: {
  id: string;
  patchBody?: {
    name?: string;
    caption?: string | null;
    description?: string | null;
  };
  imageIntent?: CoworkerImageIntent;
  imageFile?: File;
}) => Promise<ActionResultDto<UpdateCoworkerDisplayResult, ActionError>>;

interface CoworkerDisplayFormProps {
  coworker: Coworker;
  cancelHref: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  updateAction: UpdateCoworkerDisplayAction;
  onNotFound: () => void;
}

export function CoworkerDisplayForm({
  coworker,
  cancelHref,
  disabled = false,
  onBusyChange,
  updateAction,
  onNotFound,
}: CoworkerDisplayFormProps) {
  const t = useTranslations("App.Coworkers.DisplayForm");
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

  const isFormBusy = isSavingText || isUploadingImage || isRemovingImage;
  const isDisabled = disabled || isFormBusy;

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

  function handleActionError(result: ActionResultDto<unknown, ActionError>) {
    if (result.ok) {
      return false;
    }

    if (result.error.code === CommonErrorCode.NOT_FOUND) {
      onNotFound();
      return true;
    }

    return false;
  }

  async function runDisplayMutation<T>(mutation: () => Promise<T>): Promise<T> {
    onBusyChange?.(true);
    try {
      return await mutation();
    } finally {
      onBusyChange?.(false);
    }
  }

  async function handleImageSelect(files: File[]) {
    const file = files[0];
    if (!file || isDisabled) {
      return;
    }

    setPendingImageFiles(files);
    setIsUploadingImage(true);
    try {
      await runDisplayMutation(async () => {
        const result = await updateAction({
          id: baseline.id,
          imageIntent: "upload",
          imageFile: file,
        });

        if (!result.ok) {
          if (!handleActionError(result)) {
            toast.error(t("errors.imageSaveFailed"));
          }
          return;
        }

        applySavedCoworker(result.value.coworker);
        if (result.value.imageError) {
          toast.error(t("errors.imageSaveFailed"));
        } else {
          toast.success(t("success.imageSaved"));
        }
        router.refresh();
      });
    } finally {
      setPendingImageFiles([]);
      setIsUploadingImage(false);
    }
  }

  async function handleRemoveImage() {
    if (!imageValue || isDisabled) {
      return;
    }

    setIsRemovingImage(true);
    try {
      await runDisplayMutation(async () => {
        const result = await updateAction({
          id: baseline.id,
          imageIntent: "remove",
        });

        if (!result.ok) {
          if (!handleActionError(result)) {
            toast.error(t("errors.imageSaveFailed"));
          }
          return;
        }

        applySavedCoworker(result.value.coworker);
        if (result.value.imageError) {
          toast.error(t("errors.imageSaveFailed"));
        } else {
          toast.success(t("success.imageRemoved"));
        }
        router.refresh();
      });
    } finally {
      setIsRemovingImage(false);
    }
  }

  async function handleDisplaySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDisabled) {
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length < COWORKER_NAME_MIN_LENGTH) {
      toast.error(
        t("validation.nameMinLength", {
          min: COWORKER_NAME_MIN_LENGTH,
        }),
      );
      return;
    }

    if (caption.trim().length > COWORKER_CAPTION_MAX_LENGTH) {
      toast.error(
        t("validation.captionMaxLength", {
          max: COWORKER_CAPTION_MAX_LENGTH,
        }),
      );
      return;
    }

    const patchBody = buildCoworkerDisplayPatchBody(baseline, {
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
      await runDisplayMutation(async () => {
        const result = await updateAction({
          id: baseline.id,
          patchBody,
          imageIntent: "none",
        });

        if (!result.ok) {
          if (!handleActionError(result)) {
            toast.error(t("errors.saveFailed"));
          }
          return;
        }

        applySavedCoworker(result.value.coworker);
        if (result.value.imageError) {
          toast.success(t("success.saved"));
          toast.error(t("errors.imageSaveFailed"));
        } else {
          toast.success(t("success.saved"));
        }
        router.refresh();
      });
    } finally {
      setIsSavingText(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={handleDisplaySubmit}>
          <div className="space-y-2">
            <Label>{t("image.label")}</Label>
            <OrganizationLogoUploadField
              accept={COWORKER_IMAGE_ACCEPT}
              disabled={isDisabled}
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
              <Label htmlFor="coworker-name">{t("fields.name.label")}</Label>
              <Input
                id="coworker-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isDisabled}
                required
                minLength={COWORKER_NAME_MIN_LENGTH}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="coworker-caption">
                {t("fields.caption.label")}
              </Label>
              <Input
                id="coworker-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                disabled={isDisabled}
                maxLength={COWORKER_CAPTION_MAX_LENGTH}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="coworker-description">
                {t("fields.description.label")}
              </Label>
              <Textarea
                id="coworker-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isDisabled}
                rows={4}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isDisabled}>
              {isSavingText ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("saveChanges")
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              asChild
              disabled={isDisabled}
            >
              <Link href={cancelHref}>{t("cancel")}</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
