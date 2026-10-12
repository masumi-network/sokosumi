"use client";

import type { DriveFile } from "@sokosumi/core-client";
import { ImagePlus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { DriveFilePicker } from "@/components/drive/drive-file-picker";
import { Button } from "@/components/ui/button";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import type { ImageSize } from "@/hooks/use-remembered-image-size";
import type { GoogleDisplayFormValues } from "@/lib/ads/google-display";
import {
  addDisplayImage,
  checkDisplayImageFile,
  checkDisplayImageFileByName,
  DISPLAY_IMAGE_MAX_MB,
  DISPLAY_IMAGE_MIME_TYPES,
  DISPLAY_IMAGE_RULES,
  type DisplayImageRole,
  type DisplayImageSizeIssue,
  type DisplayImageSlot,
  displayImageCounts,
  hasRoomForDisplayImage,
  imageRoleForSize,
  imagesInSlot,
  type MinSize,
  missingDisplayImages,
} from "@/lib/ads/google-display-images";
import { readFileImageSize, readImageSize } from "@/lib/ads/image-size.client";
import { useSession } from "@/lib/auth/auth.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";

function sizeText(min: MinSize): string {
  return `${min.minWidth} × ${min.minHeight}`;
}

/** What the refusal texts quote: the rules, not copies of them. */
const RULE_PARAMS = {
  landscape: sizeText(DISPLAY_IMAGE_RULES.landscape),
  square: sizeText(DISPLAY_IMAGE_RULES.square),
  logo: sizeText(DISPLAY_IMAGE_RULES.logo),
  maxMb: DISPLAY_IMAGE_MAX_MB,
  maxImages: DISPLAY_IMAGE_RULES.maxMarketing,
  maxLogos: DISPLAY_IMAGE_RULES.maxLogos,
};

type Problem = "unreadable" | "type" | "tooLarge" | "duplicate" | "full";

/** The text a slot says when it is full. */
const FULL_PROBLEM = { images: "full", logo: "fullLogo" } as const;

interface ImageUploadState {
  /** A picture is being read or uploaded, in either slot. */
  uploading: boolean;
  setUploading: (uploading: boolean) => void;
}

/**
 * Shared by both slots and the form around them: only one picture is added at
 * a time, and the form cannot be submitted until it is in.
 */
export const ImageUploadContext = createContext<ImageUploadState>({
  uploading: false,
  setUploading: () => undefined,
});

interface ImageSlotProps {
  slot: DisplayImageSlot;
}

/**
 * One place to add pictures: upload from the computer or choose from Drive,
 * then the thumbnails. A picture is checked before it is uploaded, and its
 * role comes from its own size, never from the reader.
 */
function ImageSlot({ slot }: ImageSlotProps) {
  const t = useTranslations("App.Ads.newCampaign.ad.images");
  const form = useFormContext<GoogleDisplayFormValues>();
  const { data: session } = useSession();
  const driveStore = driveStoreForActiveWorkspace(
    session?.session.activeOrganizationId ?? null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploading, setUploading } = useContext(ImageUploadContext);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const images = imagesInSlot(form.watch("images"), slot);

  function refuse(
    reason: Problem | DisplayImageSizeIssue,
    name: string,
    problemsOut: string[],
  ): void {
    const key = reason === "full" ? FULL_PROBLEM[slot] : reason;
    problemsOut.push(t(`errors.${key}`, { name, ...RULE_PARAMS }));
  }

  function attach(
    image: Parameters<typeof addDisplayImage>[1],
    out: string[],
  ): void {
    const added = addDisplayImage(form.getValues("images"), image);
    if (!added.ok) {
      refuse(added.reason, image.name, out);
      return;
    }
    form.setValue("images", added.images, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  }

  /** The role the picture takes, or why it cannot be used; nothing is uploaded yet. */
  async function roleFor(
    reading: Promise<ImageSize>,
    name: string,
    out: string[],
  ): Promise<DisplayImageRole | null> {
    let size: ImageSize;
    try {
      size = await reading;
    } catch {
      refuse("unreadable", name, out);
      return null;
    }
    const role = imageRoleForSize(size.width, size.height, slot);
    if (!role.ok) {
      refuse(role.reason, name, out);
      return null;
    }
    if (!hasRoomForDisplayImage(form.getValues("images"), role.role)) {
      refuse("full", name, out);
      return null;
    }
    return role.role;
  }

  async function addUpload(file: File, out: string[]): Promise<void> {
    const checked = checkDisplayImageFile(file);
    if (!checked.ok) {
      refuse(checked.reason, file.name, out);
      return;
    }
    const role = await roleFor(readFileImageSize(file), file.name, out);
    if (!role) return;
    try {
      const uploaded = await uploadDriveFile(file, driveStore);
      if (!uploaded.fileUrl) throw new Error("Upload returned no URL");
      attach(
        {
          pathname: uploaded.pathname,
          fileUrl: uploaded.fileUrl,
          name: file.name,
          size: file.size,
          mimeType: checked.mimeType,
          role,
        },
        out,
      );
    } catch (error) {
      toast.error(
        isDriveFileUploadDuplicate(error)
          ? t("uploadDuplicate")
          : t("uploadFailed"),
      );
    }
  }

  async function addDriveFile(file: DriveFile, out: string[]): Promise<void> {
    const checked = checkDisplayImageFileByName(file);
    if (!checked.ok) {
      refuse(checked.reason, file.name, out);
      return;
    }
    const role = await roleFor(readImageSize(file.fileUrl), file.name, out);
    if (!role) return;
    attach(
      {
        pathname: file.pathname,
        fileUrl: file.fileUrl,
        name: file.name,
        size: file.size,
        mimeType: checked.mimeType,
        role,
      },
      out,
    );
  }

  /** One at a time: a second choice while one is being read waits for the next click. */
  async function run(add: (out: string[]) => Promise<void>): Promise<void> {
    if (uploading) return;
    setUploading(true);
    const out: string[] = [];
    try {
      await add(out);
    } finally {
      setUploading(false);
      setProblems(out);
    }
  }

  function handleRemove(pathname: string): void {
    form.setValue(
      "images",
      form.getValues("images").filter((image) => image.pathname !== pathname),
      { shouldDirty: true, shouldValidate: form.formState.isSubmitted },
    );
  }

  return (
    <div className="grid gap-3">
      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {images.map((image) => (
            <li
              className="flex w-20 flex-col items-center gap-1"
              key={image.pathname}
            >
              <FileChipMiniPreview
                fileName={image.name}
                mediaType={image.mimeType}
                onRemove={() => handleRemove(image.pathname)}
                removeLabel={t("remove", { name: image.name })}
                size={image.size}
                url={image.fileUrl}
              />
              <span className="text-muted-foreground text-xs">
                {t(`roles.${image.role}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          <Upload />
          {t("upload")}
        </Button>
        <Button
          disabled={uploading}
          onClick={() => setPickerOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <ImagePlus />
          {t("choose")}
        </Button>
        <input
          accept={DISPLAY_IMAGE_MIME_TYPES.join(",")}
          aria-label={t(`slots.${slot}.files`)}
          className="hidden"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void run(async (out) => {
              for (const file of files) await addUpload(file, out);
            });
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>
      {/* Always there, so the first refusal is announced too. */}
      <div role="status">
        {problems.length > 0 ? (
          <ul className="text-destructive grid gap-1 text-sm">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <DriveFilePicker
        onOpenChange={setPickerOpen}
        onSelect={(file) => void run((out) => addDriveFile(file, out))}
        open={pickerOpen}
      />
    </div>
  );
}

/**
 * The Display ad's pictures: the marketing images (landscape and square) and,
 * apart, the logos. All of them are Drive files in one form field, `images`.
 */
export function AdsDisplayImages() {
  const t = useTranslations("App.Ads.newCampaign.ad.images");
  const form = useFormContext<GoogleDisplayFormValues>();
  const images = form.watch("images");
  const counts = displayImageCounts(images);
  const missing = missingDisplayImages(images);

  return (
    <>
      <FormField
        control={form.control}
        name="images"
        render={() => (
          <FormItem>
            {/* The group carries the refusal: its id, invalid state and description. */}
            <FormControl>
              <fieldset className="grid gap-3">
                <legend className="text-sm font-medium">{t("label")}</legend>
                <FormDescription>{t("help", RULE_PARAMS)}</FormDescription>
                <ImageSlot slot="images" />
                <p className="text-muted-foreground text-sm" aria-live="polite">
                  {t("counts", {
                    landscape: counts.landscape,
                    square: counts.square,
                    total: counts.marketing,
                    max: DISPLAY_IMAGE_RULES.maxMarketing,
                  })}
                </p>
                {/* The reason a refused submit gives replaces the hint. */}
                {form.formState.errors.images ? (
                  <FormMessage />
                ) : missing ? (
                  <p className="text-muted-foreground text-sm">
                    {t(`missing.${missing}`)}
                  </p>
                ) : null}
              </fieldset>
            </FormControl>
          </FormItem>
        )}
      />
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">{t("logoLabel")}</legend>
        <p className="text-muted-foreground text-sm">
          {t("logoHelp", RULE_PARAMS)}
        </p>
        <ImageSlot slot="logo" />
        <p className="text-muted-foreground text-sm">
          {t("logoCounts", {
            count: counts.logo,
            max: DISPLAY_IMAGE_RULES.maxLogos,
          })}
        </p>
      </fieldset>
    </>
  );
}
