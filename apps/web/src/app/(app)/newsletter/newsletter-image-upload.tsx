"use client";

import {
  ORGANIZATION_LOGO_ALLOWED_MIME_TYPES,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { OrganizationLogoUploadField } from "@/components/organizations/organization-logo-upload-field";
import { ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS } from "@/lib/constants/organization-logo";
import {
  ClientTimeoutError,
  raceWithTimeout,
} from "@/lib/utils/race-with-timeout";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";

/** Email clients drop SVG, so issue images take raster formats only. */
const IMAGE_TYPES = ORGANIZATION_LOGO_ALLOWED_MIME_TYPES.filter(
  (type) => type !== "image/svg+xml",
);

/**
 * Uploads a newsletter logo or image to the member's Files and hands back its
 * public URL. Saving the form is still what puts the URL in an email.
 */
export function NewsletterImageUpload({
  kind,
  value,
  onChange,
  disabled,
  onUploadingChange,
}: {
  kind: "logo" | "image";
  value: string;
  onChange: (url: string) => void;
  disabled: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const t = useTranslations("App.Projects.Newsletter");
  const ns = kind === "logo" ? "Logo" : "Image";
  const types =
    kind === "logo" ? ORGANIZATION_LOGO_ALLOWED_MIME_TYPES : IMAGE_TYPES;
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  function setUploading(uploading: boolean) {
    setIsUploading(uploading);
    onUploadingChange?.(uploading);
  }

  async function handleUpload(files: File[]) {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await raceWithTimeout(
        uploadUserFileDirect(file, {
          allowedContentTypes: [...types],
          maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
        }),
        ORGANIZATION_LOGO_UPLOAD_CLIENT_TIMEOUT_MS,
      );
      onChange(uploaded.publicUrl);
    } catch (error) {
      toast.error(
        error instanceof ClientTimeoutError
          ? t(`${ns}.uploadError`)
          : getUserFileUploadErrorMessage(error, t(`${ns}.uploadError`)),
      );
    } finally {
      setPendingFiles([]);
      setUploading(false);
    }
  }

  return (
    <OrganizationLogoUploadField
      accept={types.join(",")}
      disabled={disabled || isUploading}
      fallbackIcon={<ImageIcon className="size-8" />}
      isUploading={isUploading}
      labels={{
        fileTooLarge: t(`${ns}.fileTooLarge`),
        fileTypeNotAccepted: t(`${ns}.fileTypeNotAccepted`),
        maxFilesExceeded: t(`${ns}.maxFilesExceeded`),
        previewAlt: t(`${ns}.previewAlt`),
        remove: t(`${ns}.remove`),
        replace: t(`${ns}.replace`),
        upload: t(`${ns}.upload`),
        uploadError: t(`${ns}.uploadError`),
      }}
      logoValue={value}
      onPendingLogoFilesChange={setPendingFiles}
      onRemove={() => onChange("")}
      onUpload={handleUpload}
      pendingLogoFiles={pendingFiles}
    />
  );
}
