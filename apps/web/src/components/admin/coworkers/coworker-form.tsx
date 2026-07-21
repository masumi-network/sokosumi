"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { Bot, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveAdminCoworkerAction,
  unarchiveAdminCoworkerAction,
  updateAdminCoworkerControlsAction,
  updateAdminCoworkerDisplayAction,
  updateAdminCoworkerWhitelistAction,
} from "@/lib/actions/admin-coworkers/action";
import { CommonErrorCode } from "@/lib/actions/errors";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";
import {
  ADMIN_COWORKER_CAPABILITIES,
  ADMIN_COWORKER_CAPTION_MAX_LENGTH,
  ADMIN_COWORKER_NAME_MIN_LENGTH,
  type AdminCoworkerCapability,
} from "@/lib/constants/coworker-display";
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

function isArchived(coworker: Coworker): boolean {
  return coworker.archivedAt != null;
}

function normalizeCapabilities(
  capabilities: Coworker["capabilities"],
): AdminCoworkerCapability[] {
  return ADMIN_COWORKER_CAPABILITIES.filter((capability) =>
    capabilities.includes(capability),
  );
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

function buildControlsPatchBody(
  baseline: Coworker,
  values: {
    capabilities: AdminCoworkerCapability[];
    priority: number;
  },
): { capabilities?: AdminCoworkerCapability[]; priority?: number } | undefined {
  const patchBody: {
    capabilities?: AdminCoworkerCapability[];
    priority?: number;
  } = {};

  const nextCapabilities = [...values.capabilities].toSorted();
  const baselineCapabilities = normalizeCapabilities(
    baseline.capabilities,
  ).toSorted();
  if (nextCapabilities.join(",") !== baselineCapabilities.join(",")) {
    patchBody.capabilities = nextCapabilities;
  }

  if (values.priority !== baseline.priority) {
    patchBody.priority = values.priority;
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
  const [capabilities, setCapabilities] = useState<AdminCoworkerCapability[]>(
    () => normalizeCapabilities(coworker.capabilities),
  );
  const [priority, setPriority] = useState(String(coworker.priority));
  const [isWhitelisted, setIsWhitelisted] = useState(coworker.isWhitelisted);
  const [imageValue, setImageValue] = useState(
    toImageDisplayValue(coworker.image),
  );
  const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);
  const [isSavingText, setIsSavingText] = useState(false);
  const [isSavingControls, setIsSavingControls] = useState(false);
  const [isUpdatingWhitelist, setIsUpdatingWhitelist] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isRemovingImage, setIsRemovingImage] = useState(false);

  const archived = isArchived(baseline);
  const isBusy =
    isSavingText ||
    isSavingControls ||
    isUpdatingWhitelist ||
    isArchiving ||
    isUnarchiving ||
    isUploadingImage ||
    isRemovingImage;

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
    setCapabilities(normalizeCapabilities(saved.capabilities));
    setPriority(String(saved.priority));
    setIsWhitelisted(saved.isWhitelisted);
    setImageValue(toImageDisplayValue(saved.image));
  }

  function handleNotFound() {
    toast.error(t("errors.notFound"));
    router.push("/admin/coworkers");
  }

  function handleCapabilityChange(
    capability: AdminCoworkerCapability,
    checked: boolean,
  ) {
    setCapabilities((current) => {
      if (checked) {
        return current.includes(capability)
          ? current
          : [...current, capability];
      }
      return current.filter((value) => value !== capability);
    });
  }

  async function handleWhitelistChange(checked: boolean) {
    if (isBusy) {
      return;
    }

    const previousValue = isWhitelisted;
    setIsWhitelisted(checked);
    setIsUpdatingWhitelist(true);
    try {
      const result = await updateAdminCoworkerWhitelistAction({
        id: baseline.id,
        isWhitelisted: checked,
      });

      if (!result.ok) {
        setIsWhitelisted(previousValue);
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.whitelistSaveFailed"));
        return;
      }

      applySavedCoworker(result.data.coworker);
      toast.success(t("success.whitelistSaved"));
      router.refresh();
    } finally {
      setIsUpdatingWhitelist(false);
    }
  }

  async function handleArchive() {
    if (isBusy || archived) {
      return;
    }

    setIsArchiving(true);
    try {
      const result = await archiveAdminCoworkerAction({ id: baseline.id });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.archiveFailed"));
        return;
      }

      applySavedCoworker(result.data.coworker);
      toast.success(t("success.archived"));
      router.refresh();
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleUnarchive() {
    if (isBusy || !archived) {
      return;
    }

    setIsUnarchiving(true);
    try {
      const result = await unarchiveAdminCoworkerAction({ id: baseline.id });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.unarchiveFailed"));
        return;
      }

      applySavedCoworker(result.data.coworker);
      toast.success(t("success.unarchived"));
      router.refresh();
    } finally {
      setIsUnarchiving(false);
    }
  }

  async function handleControlsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) {
      return;
    }

    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority)) {
      toast.error(t("validation.priorityInteger"));
      return;
    }

    const patchBody = buildControlsPatchBody(baseline, {
      capabilities,
      priority: parsedPriority,
    });

    if (!patchBody) {
      toast.error(t("validation.noControlChanges"));
      return;
    }

    setIsSavingControls(true);
    try {
      const result = await updateAdminCoworkerControlsAction({
        id: baseline.id,
        ...patchBody,
      });

      if (!result.ok) {
        if (result.error.code === CommonErrorCode.NOT_FOUND) {
          handleNotFound();
          return;
        }
        toast.error(result.error.message ?? t("errors.controlsSaveFailed"));
        return;
      }

      applySavedCoworker(result.data.coworker);
      toast.success(t("success.controlsSaved"));
      router.refresh();
    } finally {
      setIsSavingControls(false);
    }
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
      if (result.data.imageError) {
        toast.error(result.data.imageError);
      } else {
        toast.success(t("success.imageSaved"));
      }
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
      if (result.data.imageError) {
        toast.error(result.data.imageError);
      } else {
        toast.success(t("success.imageRemoved"));
      }
      router.refresh();
    } finally {
      setIsRemovingImage(false);
    }
  }

  async function handleDisplaySubmit(event: FormEvent<HTMLFormElement>) {
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

    if (caption.trim().length > ADMIN_COWORKER_CAPTION_MAX_LENGTH) {
      toast.error(
        t("validation.captionMaxLength", {
          max: ADMIN_COWORKER_CAPTION_MAX_LENGTH,
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
      if (result.data.imageError) {
        toast.success(t("success.saved"));
        toast.error(result.data.imageError);
      } else {
        toast.success(t("success.saved"));
      }
      router.refresh();
    } finally {
      setIsSavingText(false);
    }
  }

  return (
    <div className="space-y-8">
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
          <dt className="text-muted-foreground">{tContext("status")}</dt>
          <dd className="mt-2">
            {archived ? (
              <Badge variant="secondary">{tContext("archived")}</Badge>
            ) : (
              <Badge variant="outline">{tContext("active")}</Badge>
            )}
          </dd>
        </div>
      </dl>

      <form
        className="space-y-6 rounded-md border p-4"
        onSubmit={handleControlsSubmit}
      >
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("controls.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("controls.description")}
          </p>
        </div>

        <div className="space-y-3">
          <Label>{t("controls.capabilities.label")}</Label>
          <div className="flex flex-wrap gap-4">
            {ADMIN_COWORKER_CAPABILITIES.map((capability) => (
              <label
                key={capability}
                className="flex items-center gap-2 text-sm"
                htmlFor={`capability-${capability}`}
              >
                <Checkbox
                  id={`capability-${capability}`}
                  checked={capabilities.includes(capability)}
                  disabled={isBusy}
                  onCheckedChange={(checked) =>
                    handleCapabilityChange(capability, checked === true)
                  }
                />
                {t(`controls.capabilities.${capability}`)}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="coworker-priority">
            {t("controls.priority.label")}
          </Label>
          <Input
            id="coworker-priority"
            type="number"
            inputMode="numeric"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            disabled={isBusy}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div className="space-y-1">
            <Label htmlFor="coworker-whitelist">
              {t("controls.whitelist.label")}
            </Label>
            <p className="text-muted-foreground text-sm">
              {t("controls.whitelist.description")}
            </p>
          </div>
          <Switch
            id="coworker-whitelist"
            checked={isWhitelisted}
            disabled={isBusy}
            onCheckedChange={handleWhitelistChange}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isBusy}>
            {isSavingControls ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t("controls.saving")}
              </>
            ) : (
              t("controls.save")
            )}
          </Button>

          {archived ? (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={handleUnarchive}
            >
              {isUnarchiving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t("controls.unarchiving")}
                </>
              ) : (
                t("controls.unarchive")
              )}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={isBusy}>
                  {t("controls.archive")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("controls.archiveConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("controls.archiveConfirmDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isArchiving}>
                    {t("cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleArchive}
                    disabled={isArchiving}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isArchiving ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t("controls.archiving")}
                      </>
                    ) : (
                      t("controls.archive")
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </form>

      <form className="space-y-8" onSubmit={handleDisplaySubmit}>
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t("display.title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("display.description")}
          </p>
        </div>

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
            <Label htmlFor="coworker-caption">
              {t("Fields.caption.label")}
            </Label>
            <Input
              id="coworker-caption"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              disabled={isBusy}
              maxLength={ADMIN_COWORKER_CAPTION_MAX_LENGTH}
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
    </div>
  );
}
